"""Real Firefox event-page/queue smoke test in a fresh disposable profile.

Requires selenium, Firefox and the same Python dependencies as live-server.py.
Only synthetic public data and a temporary Noesis database are used.
"""
import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.firefox.options import Options

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='capture-firefox-') as directory:
    work = Path(directory)
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    token = secrets.token_urlsafe(48)
    callers = work / 'callers.json'
    callers.write_text(json.dumps({token: {'client_id': 'firefox-smoke', 'scopes': ['knowledge:intake:read', 'knowledge:intake:write', 'namespace:browser-tests:read', 'namespace:browser-tests:write']}}))
    callers.chmod(0o600)
    env = {**os.environ, 'NOESIS_DB_PATH': str(work / 'test.duckdb'), 'NOESIS_MCP_TRANSPORT': 'http', 'NOESIS_MCP_HTTP_HOST': '127.0.0.1', 'NOESIS_MCP_HTTP_PORT': str(port), 'NOESIS_MCP_AUTH_TOKEN': '', 'NOESIS_MCP_AUTH_TOKENS_FILE': str(callers)}
    log = (work / 'server.log').open('w+')
    server = subprocess.Popen([sys.executable, str(ROOT / 'tests/live-server.py')], env=env, stdout=log, stderr=log)
    driver = None
    try:
        for _ in range(150):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/mcp', timeout=1)
                break
            except urllib.error.HTTPError:
                break
            except OSError:
                if server.poll() is not None:
                    log.seek(0)
                    raise RuntimeError(log.read())
                time.sleep(.2)
        # Fixture permission equals the optional localhost grant normally made in settings.
        manifest = json.loads((ROOT / 'manifest.json').read_text())
        manifest['host_permissions'] = ['http://127.0.0.1/*', 'https://example.org/*']
        manifest['permissions'].append('tabs')
        package = work / 'capture.xpi'
        with zipfile.ZipFile(package, 'w') as archive:
            for path in ROOT.iterdir():
                if path.suffix in {'.js', '.html', '.css'}:
                    archive.write(path, path.name)
            archive.writestr('manifest.json', json.dumps(manifest))
        options = Options()
        options.binary_location = os.environ.get('FIREFOX_BINARY', '/snap/firefox/current/usr/lib/firefox/firefox')
        options.add_argument('-headless')
        options.add_argument('-remote-allow-system-access')
        driver = webdriver.Firefox(options=options)
        driver.set_script_timeout(40)
        driver.install_addon(str(package), temporary=True)
        driver.set_context('chrome')
        uuids = driver.execute_script('return Services.prefs.getStringPref("extensions.webextensions.uuids");')
        uuid = json.loads(uuids)['capture@noesis.local']
        driver.set_context('content')
        driver.get(f'moz-extension://{uuid}/options.html')
        settings = {'url': f'http://127.0.0.1:{port}/mcp', 'namespace': 'browser-tests', 'token': token}
        driver.execute_async_script('browser.storage.local.set({settings: arguments[0]}).then(() => arguments[arguments.length-1](true));', settings)
        capture = {'action': 'save', 'question': '', 'note': 'Synthetic browser smoke test', 'private': False, 'confirmedPublic': True, 'context': {}, 'sources': [{'unit': 'page', 'url': 'https://example.org/article', 'title': 'Browser smoke test', 'content': 'Public fixture'}]}
        def message(value):
            return driver.execute_async_script('browser.runtime.sendMessage(arguments[0]).then(arguments[arguments.length-1], e => arguments[arguments.length-1]({ok:false,error:e.message}));', value)
        queued = message({'type': 'enqueue', 'capture': capture})
        assert queued['ok'], queued
        result = message({'type': 'send', 'key': queued['value']['key']})
        assert result['ok'], result
        assert result['value']['revision'] == 2, result
        listing = message({'type': 'list'})
        assert not listing['value']['queue'], listing
        assert len(listing['value']['receipts']) == 1, listing
        extracted = driver.execute_async_script('''
          const done = arguments[arguments.length-1];
          (async () => {
            const {readArticle, readSelection} = await import(browser.runtime.getURL('extraction.js'));
            const tab = await browser.tabs.create({url:'https://example.org/',active:false});
            try {
              for (let i=0;i<100;i++) {
                if ((await browser.tabs.get(tab.id)).status === 'complete') break;
                await new Promise(resolve=>setTimeout(resolve,100));
              }
              await browser.scripting.executeScript({target:{tabId:tab.id},func:()=>{
                document.body.innerHTML='<article><p>Visible public paragraph</p><span hidden>HIDDEN</span><form>FORM <input value="SECRET"></form><div contenteditable>EDITABLE</div></article>';
                const range=document.createRange();range.selectNodeContents(document.querySelector('p'));
                window.getSelection().removeAllRanges();window.getSelection().addRange(range);
              }});
              const [article] = await browser.scripting.executeScript({target:{tabId:tab.id},func:readArticle});
              const [selection] = await browser.scripting.executeScript({target:{tabId:tab.id},func:readSelection});
              await browser.scripting.executeScript({target:{tabId:tab.id},func:()=>{const input=document.createElement('input');input.type='password';document.body.append(input);}});
              let blocked = false;
              try {
                const [value] = await browser.scripting.executeScript({target:{tabId:tab.id},func:readArticle});
                blocked = !!value.error;
              } catch {blocked = true;}
              return {article:article.result,selection:selection.result,blocked};
            } finally {await browser.tabs.remove(tab.id);}
          })().then(done,error=>done({error:error.message}));
        ''')
        assert extracted['article']['text'].strip() == 'Visible public paragraph', extracted
        assert extracted['selection']['text'] == 'Visible public paragraph', extracted
        assert extracted['blocked'], extracted
        # Exercise Firefox's real native group API in this disposable profile.
        grouped = driver.execute_async_script('''
          const done = arguments[arguments.length-1];
          (async () => {
            const a = await browser.tabs.create({url:'https://example.org/first',active:false});
            const b = await browser.tabs.create({url:'https://example.org/second',active:false});
            const groupId = await browser.tabs.group({tabIds:[a.id,b.id]});
            let members;
            for (let i=0;i<100;i++) {
              members = await browser.tabs.query({groupId});
              if (members.every(tab => tab.url?.startsWith('https://'))) break;
              await new Promise(resolve=>setTimeout(resolve,100));
            }
            await browser.tabs.remove([a.id,b.id]);
            return members.map(tab => ({unit:'tab',url:tab.url,title:tab.url,content:null}));
          })().then(done, error => done({error:error.message}));
        ''')
        assert isinstance(grouped, list) and len(grouped) == 2, grouped
        for unit in ('selection', 'pdf', 'group'):
            fixture = json.loads(json.dumps(capture))
            if unit == 'group':
                fixture['sources'] = grouped
            else:
                fixture['sources'][0]['unit'] = unit
                if unit == 'pdf':
                    fixture['sources'][0]['url'] = 'https://example.org/public.pdf'
                    fixture['sources'][0]['content'] = None
            queued_unit = message({'type':'enqueue','capture':fixture})
            assert queued_unit['ok'], queued_unit
            result_unit = message({'type':'send','key':queued_unit['value']['key']})
            assert result_unit['ok'], result_unit
            assert result_unit['value']['source_count'] == (2 if unit == 'group' else 1)
        private_capture = {**capture, 'private': True}
        assert not message({'type': 'enqueue', 'capture': private_capture})['ok']
        auth_capture = {**capture, 'confirmedPublic': False}
        assert not message({'type': 'enqueue', 'capture': auth_capture})['ok']
        assert manifest['incognito'] == 'not_allowed'
        server.terminate()
        server.wait(timeout=10)
        queued = message({'type': 'enqueue', 'capture': capture})
        result = message({'type': 'send', 'key': queued['value']['key']})
        assert not result['ok'], result
        listing = message({'type': 'list'})
        assert listing['value']['queue'][0]['key'] == queued['value']['key']
        server = subprocess.Popen([sys.executable, str(ROOT / 'tests/live-server.py')], env=env, stdout=log, stderr=log)
        for _ in range(150):
            try:
                urllib.request.urlopen(f'http://127.0.0.1:{port}/mcp', timeout=1)
                break
            except urllib.error.HTTPError:
                break
            except OSError:
                time.sleep(.2)
        result = message({'type': 'send', 'key': queued['value']['key']})
        assert result['ok'], result
        assert not message({'type': 'list'})['value']['queue']
        print('PASS: Firefox installed; page/selection/PDF-link/native-group capture; receipt; privacy rejection; outage retained; restart/retry saved.')
    finally:
        if driver:
            driver.quit()
        if server.poll() is None:
            server.terminate()
            server.wait(timeout=10)
        log.close()
