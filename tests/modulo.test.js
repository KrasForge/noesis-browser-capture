import test from 'node:test';
import assert from 'node:assert/strict';
import {Modulo, listContexts, routeReceipt, moduloOrigin} from '../modulo.js';
const settings = {moduloURL: 'https://modulo.example', moduloToken: 'test-token'};
const pending = {key: 'stable', moduloURL: settings.moduloURL, capture: {
  context: {kind: 'task', id: 'task-1', version: 4}, question: 'Why?', sources: [{title: 'Source', content: 'DO NOT COPY'}]}};
const receipt = {session_id: 'intake:1', namespace: 'research', revision: 2, action: 'explain', execution: 'research_request_only'};
const record = () => ({schemaId: 'modulo.workspace.para', schemaVersion: 1, version: 7,
  value: {resources: [], tasks: [{id: 'task-1', title: 'Task', projectId: 'project-1', areaId: 'area-1'}], projects: [], areas: [], unknown: 'preserve'}});
test('Modulo contexts use the actual workspace-para namespace', async () => {
  let url;
  const client = new Modulo(settings, async request => {url = request; return new Response(JSON.stringify(record()));});
  const contexts = await listContexts(settings, client);
  assert.equal(url, 'https://modulo.example/api/workspaces/personal/plugin-state/workspace-para/data');
  assert.equal(contexts[0].returnURL, 'https://modulo.example/app/para-tasks?record=task-1');
  assert.throws(() => moduloOrigin('https://modulo.example/path'));
});
test('routing preserves unrelated state, sends a pointer only, and replays without duplicates', async () => {
  let current = record(), writes = 0;
  const client = {origin: settings.moduloURL, para: async () => structuredClone(current), request: async (_path, method, body) => {
    assert.equal(method, 'PUT'); assert.equal(body.expectedVersion, current.version);
    assert.equal(body.value.unknown, 'preserve');
    current = {...body, version: current.version + 1}; writes++; return current;
  }};
  const result = await routeReceipt(settings, pending, receipt, client);
  assert.equal(result.resourceId, 'noesis-capture-stable');
  assert.equal(current.value.resources[0].projectIds[0], 'project-1');
  assert.equal(current.value.resources[0].areaIds[0], 'area-1');
  assert.ok(!JSON.stringify(current).includes('DO NOT COPY'));
  assert.ok((await routeReceipt(settings, pending, receipt, client)).replayed);
  assert.equal(writes, 1);
});
test('routing cannot silently redirect to another server or missing target', async () => {
  const client = {origin: 'https://other.example', para: async () => record()};
  await assert.rejects(routeReceipt(settings, pending, receipt, client), /original Modulo/);
  client.origin = settings.moduloURL;
  await assert.rejects(routeReceipt(settings, {...pending, capture: {...pending.capture, context: {kind: 'task', id: 'missing'}}}, receipt, client), /missing or archived/);
});
