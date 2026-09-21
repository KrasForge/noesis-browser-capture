export function endpoint(value) {
  const url = new URL(value);
  if (url.username || url.password || url.hash || url.search ||
      !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('Use an HTTPS MCP URL (HTTP is allowed only on localhost).');
  }
  return url.href;
}

export function sourceURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Noesis captures public HTTPS pages only.');
  }
  return url.href;
}

// Streamable HTTP can return JSON or an SSE stream. Stop at our response,
// rather than waiting for a persistent event stream to close.
async function rpcBody(response, id) {
  if (!(response.headers.get('content-type') || '').includes('text/event-stream')) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const {value, done} = await reader.read();
      buffer += decoder.decode(value, {stream: !done});
      buffer = buffer.replace(/\r\n/g, '\n');
      if (buffer.length > 2_000_000) throw new Error('Noesis response is too large.');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        const message = JSON.parse(data);
        if (message.id === id) return message;
      }
      if (done) throw new Error('Noesis closed the stream before replying.');
    }
  } finally { await reader.cancel(); }
}

export class MCP {
  constructor(settings, fetcher = globalThis.fetch.bind(globalThis)) {
    this.url = endpoint(settings.url);
    this.token = settings.token;
    this.fetcher = fetcher;
    this.counter = 0;
  }
  async request(method, params, notification = false) {
    const id = ++this.counter;
    const headers = {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    if (this.protocol) headers['MCP-Protocol-Version'] = this.protocol;
    const response = await this.fetcher(this.url, {
      method: 'POST', headers, credentials: 'omit', redirect: 'error',
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({jsonrpc: '2.0', ...(notification ? {} : {id}), method, params})
    });
    if (!response.ok) throw new Error(`Noesis returned HTTP ${response.status}. Check the endpoint, token, and scopes.`);
    this.session = response.headers.get('Mcp-Session-Id') || this.session;
    if (notification) { await response.body?.cancel(); return; }
    const message = await rpcBody(response, id);
    if (message.id !== id || message.error) throw new Error(message.error?.message || 'Invalid Noesis response.');
    return message.result;
  }
  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: '2025-03-26', capabilities: {}, clientInfo: {name: 'capture-to-noesis-firefox', version: '0.1.0'}
    });
    this.protocol = result.protocolVersion;
    await this.request('notifications/initialized', {}, true);
  }
  async call(name, args) {
    const result = await this.request('tools/call', {name, arguments: args});
    if (result.isError) throw new Error(result.content?.find(item => item.type === 'text')?.text || 'Noesis tool failed.');
    const data = result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);
    if (data.ok === false) throw new Error(data.error?.message || 'Noesis rejected the capture.');
    return data;
  }
}

export async function submitCapture(settings, pending, client = new MCP(settings)) {
  if (pending.endpoint !== endpoint(settings.url) || pending.namespace !== settings.namespace) {
    throw new Error('Restore the original endpoint and namespace to retry this capture, or discard it.');
  }
  await client.initialize();
  const session = await client.call('start_intake_mode', {
    namespace: pending.namespace, mode: 'Exploration', request_key: pending.key,
    intent: 'Capture from Firefox'
  });
  return client.call('capture_exploration_page', {
    namespace: pending.namespace, session_id: session.session_id,
    command_key: pending.key, expected_revision: 1,
    url: sourceURL(pending.url), title: pending.title, note: pending.note,
    content: pending.content, saved: true, fetch_readable: false
  });
}


export async function submitBatch(settings, pending, client = new MCP(settings), progress = () => {}) {
  const {validateCapture, workspaceLinks} = await import('./capture.js');
  validateCapture(pending.capture);
  if (pending.endpoint !== endpoint(settings.url) || pending.namespace !== settings.namespace) {
    throw new Error('Restore the original endpoint and namespace before retrying.');
  }
  if (pending.expiresAt <= Date.now()) throw new Error('Capture expired after seven days.');
  const capture = pending.capture;
  await client.initialize();
  const session = await client.call('start_intake_mode', {
    namespace: pending.namespace, mode: 'Exploration', request_key: pending.key,
    intent: capture.action === 'save' ? 'Capture from Firefox' : capture.question,
    inputs: {capture: {contract: 'noesis-browser-capture-v1', action: capture.action,
      captured_at: new Date(pending.createdAt).toISOString(), question: capture.question,
      context: capture.context, source_count: capture.sources.length, units: capture.sources.map(source => source.unit),
      execution: capture.action === 'save' ? 'source_capture' : 'research_request_only'}},
    workspace_links: workspaceLinks(capture.context)
  });
  let result;
  for (let i = 0; i < capture.sources.length; i++) {
    const source = capture.sources[i];
    progress(`Saving source ${i + 1} of ${capture.sources.length}`);
    result = await client.call('capture_exploration_page', {
      namespace: pending.namespace, session_id: session.session_id,
      command_key: `${pending.key}:${i}`, expected_revision: i + 1,
      url: source.url, title: source.title, note: capture.note,
      content: source.content, saved: true, fetch_readable: false
    });
  }
  return {session_id: result.session_id, revision: result.revision, namespace: pending.namespace,
    request_key: pending.key, action: capture.action, source_count: capture.sources.length,
    context: capture.context, workspace_links: workspaceLinks(capture.context),
    execution: capture.action === 'save' ? 'source_capture' : 'research_request_only'};
}
