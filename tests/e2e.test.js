import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {MCP, submitBatch} from '../core.js';
import {makePending} from '../capture.js';

test('real authenticated Noesis HTTP capture, replay, batches, context, and exclusions', {skip: !process.env.NOESIS_TEST_PYTHON, timeout: 60000}, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'noesis-capture-e2e-'));
  const portServer = createServer(); await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
  const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
  const token = crypto.randomUUID() + crypto.randomUUID();
  await writeFile(join(dir, 'callers.json'), JSON.stringify({[token]: {client_id: 'capture-test', scopes: ['knowledge:intake:read', 'knowledge:intake:write', 'namespace:capture-tests:read', 'namespace:capture-tests:write']}}), {mode: 0o600});
  const child = spawn(process.env.NOESIS_TEST_PYTHON, [fileURLToPath(new URL('./live-server.py', import.meta.url))], {env: {...process.env,
    NOESIS_DB_PATH: join(dir, 'warehouse.duckdb'), NOESIS_MCP_TRANSPORT: 'http', NOESIS_MCP_HTTP_HOST: '127.0.0.1', NOESIS_MCP_HTTP_PORT: String(port), NOESIS_MCP_AUTH_TOKEN: '', NOESIS_MCP_AUTH_TOKENS_FILE: join(dir, 'callers.json')}});
  let logs = ''; child.stdout.on('data', chunk => {logs += chunk;}); child.stderr.on('data', chunk => {logs += chunk;});
  t.after(async () => { child.kill('SIGTERM'); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)); await rm(dir, {recursive: true, force: true}); });
  const settings = {url: `http://127.0.0.1:${port}/mcp`, namespace: 'capture-tests', token};
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try { const response = await fetch(settings.url); await response.body?.cancel(); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  assert.ok(ready, `Server did not start: ${logs}`);
  const capture = {action: 'save', question: '', note: 'e2e fixture', private: false, confirmedPublic: true,
    context: {kind: 'task', id: 'BROWSE-CAPTURE-07', version: 1, returnURL: 'https://modulo.example/workspace'},
    sources: [{unit: 'page', url: 'https://example.org/article', title: 'Public fixture', content: 'Public article fixture text'}]};
  const pending = makePending(settings, capture);
  const first = await submitBatch(settings, pending);
  const replay = await submitBatch(settings, pending);
  assert.equal(first.session_id, replay.session_id); assert.equal(replay.revision, 2);
  const reader = new MCP(settings); await reader.initialize();
  const state = await reader.call('inspect_intake_mode', {namespace: settings.namespace, session_id: first.session_id});
  assert.equal(state.workspace_links[0].id, 'BROWSE-CAPTURE-07');
  assert.equal(state.inputs.capture.context.returnURL, capture.context.returnURL);
  assert.equal(state.revision, 2);
  for (const unit of ['selection', 'pdf', 'tab']) {
    const fixture = structuredClone(capture);
    fixture.sources[0].unit = unit;
    if (unit === 'pdf') {fixture.sources[0].url = 'https://example.org/document.pdf'; fixture.sources[0].content = null;}
    if (unit === 'tab') fixture.sources.push({unit: 'tab', url: 'https://example.org/second', title: 'Second tab', content: null});
    const item = makePending(settings, fixture);
    const result = await submitBatch(settings, item);
    assert.equal(result.source_count, unit === 'tab' ? 2 : 1);
    assert.equal((await submitBatch(settings, item)).session_id, result.session_id);
  }
  const wrongAuth = new MCP({...settings, token: 'invalid'});
  await assert.rejects(wrongAuth.initialize(), /HTTP 401/);
  await assert.rejects(submitBatch({...settings, url: 'http://127.0.0.1:1/mcp'}, pending), /original endpoint/);
  assert.throws(() => makePending(settings, {...capture, private: true}), /public content/);
  assert.throws(() => makePending(settings, {...capture, confirmedPublic: false}), /public content/);
  const privateNetwork = structuredClone(capture); privateNetwork.sources[0].url = 'https://127.0.0.1/secret';
  assert.throws(() => makePending(settings, privateNetwork), /excluded/);
});
