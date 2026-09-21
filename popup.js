import {ACTIONS, cleanURL} from './capture.js';
import {readArticle, readSelection} from './extraction.js';
const $ = id => document.getElementById(id);
let tab, rawURL, selectedTabs = [], receipt;
let busy = false;
let configured = false;
let contexts = [];
async function message(payload) {
  const result = await browser.runtime.sendMessage(payload);
  if (!result?.ok) throw new Error(result?.error || 'The capture service did not respond. Reopen this popup to retry.');
  return result.value;
}
function status(text) { $('status').textContent = text; }
async function refresh() {
  const state = await message({type: 'list'});
  $('queue').replaceChildren();
  for (const item of state.queue) {
    const row = document.createElement('p');
    const title = document.createElement('span'); title.textContent = `${item.title} (${item.count} source${item.count === 1 ? '' : 's'}) `;
    row.append(title);
    for (const [label, type] of [['Retry', 'send'], ['Discard', 'discard']]) {
      const button = document.createElement('button'); button.textContent = label; button.disabled = busy;
      button.addEventListener('click', () => run(async () => {
        const result = await message({type, key: item.key});
        if (type === 'send') showReceipt(result);
        else status('Local request discarded. Existing server data remains.');
      })); row.append(button);
    }
    $('queue').append(row);
  }
  if (!state.queue.length) $('queue').textContent = 'No pending captures.';
  if (state.legacyPending) {
    const retry = document.createElement('button'); retry.textContent = 'Retry version 0.1 capture';
    retry.addEventListener('click', () => run(async () => showReceipt(await message({type: 'send-legacy'}))));
    $('queue').append(retry);
  }
  if (state.receipts[0]) showReceipt(state.receipts[0], false);
}
function showReceipt(value, announce = true) {
  receipt = value;
  $('result').textContent = `${value.execution === 'source_capture' ? 'Source saved' : 'Research request saved; research has not run'}. Session ${value.session_id}, revision ${value.revision}.`;
  $('receipt').hidden = false;
  $('return').hidden = !value.context?.returnURL;
  if (value.context?.returnURL) $('return').href = value.context.returnURL;
  if (announce) status('Saved. The pending source content has been removed from this device.');
}
async function run(operation) {
  if (busy) return;
  busy = true; $('fields').disabled = true;
  status('Working… The capture continues if this popup closes.');
  try { await operation(); } catch (error) { status(`${error.message}\nPending captures can be retried from this list.`); }
  finally { busy = false; $('fields').disabled = !tab || !configured; await refresh().catch(error => status(error.message)); }
}
for (const [value, [label]] of Object.entries(ACTIONS)) {
  const option = document.createElement('option'); option.value = value; option.textContent = label; $('action').append(option);
}
$('action').addEventListener('change', () => {
  $('action-help').textContent = ACTIONS[$('action').value][1] + ($('action').value === 'save' ? '' : ' This saves a structured request; it does not execute research or start a monitor.');
  $('question').required = $('action').value !== 'save';
});
$('action').dispatchEvent(new Event('change'));
$('load-contexts').addEventListener('click', () => run(async () => {
  contexts = await message({type: 'contexts'});
  $('contexts').replaceChildren(new Option('Enter manually below', ''));
  contexts.forEach((context, index) => $('contexts').append(new Option(`${context.kind}: ${context.title}`, String(index))));
  status('Choose the Modulo object to attach.');
}));
$('contexts').addEventListener('change', () => {
  if ($('contexts').value === '') return;
  const context = contexts[Number($('contexts').value)];
  $('kind').value = context.kind; $('object-id').value = context.id;
  $('object-version').value = context.version; $('return-url').value = context.returnURL;
  $('route-modulo').checked = true;
});
$('options').addEventListener('click', () => browser.runtime.openOptionsPage());
$('clear').addEventListener('click', () => run(async () => { await message({type: 'clear'}); receipt = null; $('result').textContent = ''; $('receipt').hidden = $('return').hidden = true; status('Local captures and receipts cleared.'); }));
$('query').addEventListener('change', () => { try { $('url').value = cleanURL(rawURL, $('query').checked); } catch (error) { status(error.message); } });
$('unit').addEventListener('change', () => {
  if (['pdf', 'tab'].includes($('unit').value)) $('text').value = '';
  $('text').disabled = ['pdf', 'tab'].includes($('unit').value);
  $('article').disabled = $('unit').value !== 'page';
});
$('article').addEventListener('click', () => run(async () => {
  const [result] = await browser.scripting.executeScript({target: {tabId: tab.id}, func: readArticle});
  if (result.error || !result.result) throw new Error('Could not read this page. Select text instead.');
  $('text').value = result.result.text;
  $('text-status').textContent = result.result.truncated ? 'Text truncated at 100,000 characters. Review before sending.' : 'Review or redact the text before sending.';
}));
async function loadTabs(mode) {
  try {
    // Must be requested directly from a user gesture.
    if (!await browser.permissions.request({permissions: ['tabs']})) throw new Error('Tab access was not granted.');
    const active = await browser.tabs.get(tab.id);
    if (mode === 'group' && (active.groupId === undefined || active.groupId < 0)) throw new Error('The current tab is not in a Firefox tab group.');
    const query = mode === 'group' ? {groupId: active.groupId, windowId: active.windowId} : {highlighted: true, windowId: active.windowId};
    selectedTabs = (await browser.tabs.query(query)).filter(item => !item.incognito);
    if (selectedTabs.length > 20) throw new Error('Select at most 20 tabs.');
    $('tab-list').replaceChildren();
    selectedTabs = selectedTabs.flatMap(item => { try { return [{url: cleanURL(item.url), title: (item.title || item.url).slice(0, 1024), unit: 'tab', content: null}]; } catch { return []; } });
    for (const source of selectedTabs) {
      const label = document.createElement('label'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true;
      checkbox.addEventListener('change', () => { source.excluded = !checkbox.checked; });
      label.append(checkbox, document.createTextNode(`${source.title} — ${source.url}`)); $('tab-list').append(label);
    }
    $('unit').value = 'tab'; $('unit').dispatchEvent(new Event('change'));
    status('Only checked tabs in this preview will be sent. Private and non-public URLs are excluded.');
  } catch (error) { status(error.message); }
}
$('tabs').addEventListener('click', () => loadTabs('highlighted'));
$('group').addEventListener('click', () => loadTabs('group'));
$('capture').addEventListener('submit', event => {
  event.preventDefault();
  run(async () => {
    const unit = $('unit').value;
    const capture = {action: $('action').value, question: $('question').value, note: $('note').value,
      private: !!tab.incognito, confirmedPublic: $('public').checked,
      context: {routeToModulo: $('route-modulo').checked, kind: $('kind').value, id: $('object-id').value.trim(), version: Number($('object-version').value), returnURL: $('return-url').value.trim()},
      sources: unit === 'tab' ? selectedTabs.filter(source => !source.excluded).map(({excluded, ...source}) => source) : [{
        unit, url: cleanURL($('url').value, $('query').checked), title: $('title').value.trim(),
        content: unit === 'pdf' ? null : ($('text').value || null)}]};
    const {key} = await message({type: 'enqueue', capture});
    showReceipt(await message({type: 'send', key}));
    $('public').checked = false;
  });
});
$('receipt').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({contract: 'noesis-browser-capture-receipt-v1', ...receipt}, null, 2)], {type: 'application/json'}));
  const link = document.createElement('a'); link.href = url; link.download = 'noesis-capture-receipt.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
try {
  const {settings} = await browser.storage.local.get('settings');
  configured = !!settings;
  [tab] = await browser.tabs.query({active: true, currentWindow: true});
  if (tab.incognito) throw new Error('Private browsing capture is disabled.');
  rawURL = tab.url; $('url').value = cleanURL(tab.url);
  $('title').value = (tab.title || tab.url).slice(0, 1024);
  if (/\.pdf$/i.test(new URL(tab.url).pathname)) { $('unit').value = 'pdf'; $('unit').dispatchEvent(new Event('change')); }
  // Selected text is read only on explicit selection mode/article clicks, not on popup open.
  $('unit').addEventListener('change', async () => {
    if ($('unit').value !== 'selection') return;
    try {
      const [result] = await browser.scripting.executeScript({target: {tabId: tab.id}, func: readSelection});
      if (result.error || !result.result) throw new Error('Selection is unavailable on this page.');
      $('text').value = result.result.text;
      $('text-status').textContent = result.result.truncated ? 'Selection truncated at 100,000 characters.' : 'Review or redact the selection before sending.';
    } catch (error) { status(error.message); }
  });
  $('fields').disabled = !settings;
  if (!settings) status('Open Connection settings to connect Noesis.');
} catch (error) { tab = null; status(error.message); }
await refresh().catch(error => status(error.message));
