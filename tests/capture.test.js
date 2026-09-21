import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanURL, makePending, pruneQueue, RETENTION_MS, validateCapture, workspaceLinks} from '../capture.js';
import {submitBatch} from '../core.js';
import {handle} from '../queue.js';
const settings = {url: 'https://noesis.example/mcp', namespace: 'research', token: 'caller-one'};
const capture = () => ({action: 'save', question: '', note: '', private: false, confirmedPublic: true,
  context: {kind: 'project', id: 'project-1', version: 4, returnURL: 'https://modulo.example/workspace'},
  sources: [{unit: 'page', url: 'https://example.org/article', title: 'Article', content: null}]});
function storage(initial) {
  let state = structuredClone(initial);
  return {get: async () => structuredClone(state), set: async value => { state = {...state, ...structuredClone(value)}; },
    remove: async keys => { for (const key of keys) delete state[key]; }, state: () => structuredClone(state)};
}
test('URL minimization excludes private/local URLs and credentials', () => {
  assert.equal(cleanURL('https://example.org/a?token=secret#private'), 'https://example.org/a');
  assert.equal(cleanURL('https://example.org/a?q=public#frag', true), 'https://example.org/a?q=public');
  for (const url of ['https://localhost/a', 'https://127.0.0.1/a', 'https://[::1]/a', 'https://router.local/a', 'https://host/a', 'https://u:p@example.org/', 'file:///tmp/a.pdf']) assert.throws(() => cleanURL(url));
});
test('privacy and capture units are explicit and bounded', () => {
  assert.throws(() => validateCapture({...capture(), private: true}));
  assert.throws(() => validateCapture({...capture(), confirmedPublic: false}));
  assert.throws(() => validateCapture({...capture(), sources: []}));
  assert.throws(() => validateCapture({...capture(), action: 'verify', question: 'Is this true?'}));
  const value = capture(); value.action = 'verify'; value.question = 'Is it true?';
  value.sources[0] = {...value.sources[0], unit: 'selection', content: 'A selected claim'};
  assert.equal(validateCapture(value), value);
  value.sources[0].unit = 'pdf'; assert.throws(() => validateCapture(value));
  value.sources[0].content = null; value.action = 'save'; assert.equal(validateCapture(value), value);
});
test('outage retains exact payload and keys; replay atomically removes content', async () => {
  const store = storage({settings});
  const queued = await handle({type: 'enqueue', capture: capture()}, store);
  const before = store.state().queue[0];
  await assert.rejects(handle({type: 'send', key: queued.key}, store, async () => {throw new Error('offline');}), /offline/);
  assert.equal(store.state().queue[0].key, before.key);
  assert.deepEqual(store.state().queue[0].capture, before.capture);
  await handle({type: 'send', key: queued.key}, store, async (_settings, item) => ({session_id: 's', request_key: item.key}));
  assert.deepEqual(store.state().queue, []);
  assert.equal(store.state().receipts[0].request_key, before.key);
});
test('queue size, expiration, and caller changes fail safely', async () => {
  const item = makePending(settings, capture(), 1000, 'key');
  assert.equal(pruneQueue([item], 1000 + RETENTION_MS).length, 0);
  const store = storage({settings, queue: Array.from({length: 20}, (_, i) => makePending(settings, capture(), Date.now(), String(i)))});
  await assert.rejects(handle({type: 'enqueue', capture: capture()}, store), /full/);
  await assert.rejects(handle({type: 'send', key: '0'}, store, async () => {throw new Error('offline');}));
  await store.set({settings: {...settings, token: 'different-caller'}});
  await assert.rejects(handle({type: 'send', key: '0'}, store), /caller token changed/);
  await handle({type: 'clear'}, store);
  assert.equal(store.state().queue, undefined);
});
test('batch partial replay uses source-index keys and fixed revision sequence', async () => {
  const value = capture(); value.sources.push({...value.sources[0], unit: 'tab', url: 'https://example.org/second'});
  const pending = makePending(settings, value);
  const calls = [];
  const client = {initialize: async () => {}, call: async (name, args) => {
    calls.push({name, args}); return {session_id: 's', revision: args.expected_revision + 1 || 3};
  }};
  const receipt = await submitBatch(settings, pending, client);
  await submitBatch(settings, pending, client);
  assert.deepEqual(calls.slice(0, 3), calls.slice(3));
  assert.equal(calls[1].args.expected_revision, 1);
  assert.equal(calls[2].args.expected_revision, 2);
  assert.equal(calls[0].args.workspace_links[0].id, 'project-1');
  assert.deepEqual(receipt.context, value.context);
  assert.equal(receipt.source_count, 2);
  assert.equal(workspaceLinks({kind: 'area', id: 'area-1', version: 1}).length, 0);
});

test('queue byte limit refuses a new capture without losing existing requests', async () => {
  const large = capture(); large.sources = Array.from({length: 20}, () => ({...large.sources[0], content: 'x'.repeat(100000)}));
  const store = storage({settings});
  await handle({type: 'enqueue', capture: large}, store);
  await assert.rejects(handle({type: 'enqueue', capture: large}, store), /4 MB/);
  assert.equal(store.state().queue.length, 1);
});
