import {endpoint} from './core.js';
import {moduloOrigin} from './modulo.js';
const $ = id => document.getElementById(id);
const {settings} = await browser.storage.local.get('settings');
if (settings) {
  $('endpoint').value = settings.url;
  $('namespace').value = settings.namespace;
  $('token').value = settings.token;
  $('modulo-url').value = settings.moduloURL || '';
  $('modulo-token').value = settings.moduloToken || '';
}
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const url = endpoint($('endpoint').value.trim());
    const namespace = $('namespace').value.trim();
    const token = $('token').value.trim();
    if (!namespace || !token) throw new Error('Namespace and token are required.');
    const parsed = new URL(url);
    const moduloURL = $('modulo-url').value.trim() ? moduloOrigin($('modulo-url').value.trim()) : '';
    const moduloToken = $('modulo-token').value.trim();
    if (!!moduloURL !== !!moduloToken) throw new Error('Provide both Modulo origin and token, or leave both blank.');
    const origins = [`${parsed.protocol}//${parsed.hostname}/*`];
    if (moduloURL) { const target = new URL(moduloURL); origins.push(`${target.protocol}//${target.hostname}/*`); }
    const granted = await browser.permissions.request({origins});
    if (!granted) throw new Error('Endpoint access was not granted.');
    await browser.storage.local.set({settings: {url, namespace, token, moduloURL, moduloToken}});
    $('status').textContent = 'Connection saved.';
  } catch (error) { $('status').textContent = error.message; }
});
$('forget').addEventListener('click', async () => {
  await browser.storage.local.remove('settings');
  const permissions = await browser.permissions.getAll();
  if (permissions.origins?.length) await browser.permissions.remove({origins: permissions.origins});
  if (permissions.permissions?.includes('tabs')) await browser.permissions.remove({permissions: ['tabs']});
  $('settings').reset();
  $('status').textContent = 'Connection and token removed.';
});

$('connection-file').addEventListener('change', async () => {
  try {
    const file = $('connection-file').files[0];
    if (!file || file.size > 16384) throw new Error('Choose a connection JSON file smaller than 16 KB.');
    const value = JSON.parse(await file.text());
    if (typeof value.url !== 'string' || typeof value.namespace !== 'string' || typeof value.token !== 'string') throw new Error('Connection file must contain url, namespace, and token.');
    $('endpoint').value = endpoint(value.url);
    $('namespace').value = value.namespace;
    $('token').value = value.token;
    $('status').textContent = 'Connection loaded locally. Click Save connection to grant server access.';
  } catch (error) { $('status').textContent = error.message; }
});
