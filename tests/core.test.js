import test from 'node:test';
import assert from 'node:assert/strict';
import {MCP, endpoint, sourceURL, submitCapture} from '../core.js';
test('restricts credential endpoints and page URLs', () => {
  for (const url of ['http://example.org/mcp', 'https://user:secret@example.org/mcp', 'https://example.org/mcp#x']) assert.throws(() => endpoint(url));
  assert.equal(endpoint('http://127.0.0.1:8129/mcp'), 'http://127.0.0.1:8129/mcp');
  for (const url of ['file:///secret', 'about:config', 'http://example.org']) assert.throws(() => sourceURL(url));
});
test('retries preserve mutation keys and original revision', async () => {
  const calls = [];
  const client = {initialize: async () => {}, call: async (name, args) => {
    calls.push({name, args}); return {session_id: 'intake:123', revision: 2};
  }};
  const settings = {url: 'https://noesis.example/mcp', namespace: 'research'};
  const pending = {endpoint: settings.url, namespace: 'research', key: 'stable-key', url: 'https://example.org/', title: 'Example', note: 'note', content: 'selected'};
  await submitCapture(settings, pending, client);
  await submitCapture(settings, pending, client);
  assert.deepEqual(calls.slice(0, 2), calls.slice(2));
  assert.equal(calls[1].args.expected_revision, 1);
  assert.equal(calls[1].args.content, 'selected');
  await assert.rejects(submitCapture({...settings, namespace: 'other'}, pending, client), /original endpoint/);
  assert.equal(calls.length, 4);
});
test('MCP handshake, session headers, and streamed tool response', async () => {
  const requests = [];
  const client = new MCP({url: 'https://noesis.example/mcp', token: 'secret'}, async (url, options) => {
    const request = JSON.parse(options.body); requests.push({request, options});
    if (request.method === 'initialize') return new Response(JSON.stringify({id: request.id, result: {protocolVersion: '2025-03-26'}}), {headers: {'Mcp-Session-Id': 'session'}});
    if (request.method === 'notifications/initialized') return new Response(null, {status: 202});
    const data = `event: message\r\ndata: ${JSON.stringify({id: request.id, result: {content: [{type: 'text', text: JSON.stringify({session_id: 'saved'})}]}})}\r\n\r\n`;
    return new Response(data, {headers: {'content-type': 'text/event-stream'}});
  });
  await client.initialize();
  assert.deepEqual(await client.call('capture', {}), {session_id: 'saved'});
  assert.equal(requests[1].request.id, undefined);
  assert.equal(requests[2].options.headers['Mcp-Session-Id'], 'session');
  assert.equal(requests[2].options.headers['MCP-Protocol-Version'], '2025-03-26');
  assert.equal(requests[2].options.redirect, 'error');
  assert.equal(requests[2].options.credentials, 'omit');
});
test('HTTP, RPC, tool, and domain failures are not success', async () => {
  for (const response of [
    new Response('', {status: 401}),
    new Response(JSON.stringify({id: 1, error: {message: 'rpc failed'}})),
    new Response(JSON.stringify({id: 1, result: {isError: true, content: [{type: 'text', text: 'tool failed'}]}})),
    new Response(JSON.stringify({id: 1, result: {structuredContent: {ok: false, error: {message: 'scope denied'}}}}))
  ]) {
    const client = new MCP({url: 'https://example.org/mcp'}, async () => response);
    await assert.rejects(client.call('capture', {}));
  }
});
