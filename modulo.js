import {endpoint} from './core.js';

export function moduloOrigin(value) {
  const url = new URL(endpoint(value));
  if (url.pathname !== '/') throw new Error('Modulo URL must be an origin without a path.');
  return url.origin;
}

export class Modulo {
  constructor(settings, fetcher = globalThis.fetch.bind(globalThis)) {
    this.origin = moduloOrigin(settings.moduloURL);
    this.token = settings.moduloToken;
    this.fetcher = fetcher;
    if (!this.token) throw new Error('Configure a Modulo caller token for result routing.');
  }
  async request(path, method = 'GET', body) {
    const response = await this.fetcher(this.origin + path, {method, redirect: 'error', credentials: 'omit',
      signal: AbortSignal.timeout(15000), headers: {Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}`},
      body: body === undefined ? undefined : JSON.stringify(body)});
    if (!response.ok) throw new Error(`Modulo returned HTTP ${response.status}. The Noesis capture remains safe to retry.`);
    return response.json();
  }
  para() { return this.request('/api/workspaces/personal/plugin-state/workspace-para/data'); }
}

export async function listContexts(settings, client = new Modulo(settings)) {
  const record = await client.para();
  return ['project', 'area', 'task'].flatMap(kind => (record.value[`${kind}s`] || [])
    .filter(item => !item.archivedAt).map(item => ({kind, id: item.id, title: item.title || item.name,
      version: record.version, returnURL: `${client.origin}/app/para-${kind}s?record=${encodeURIComponent(item.id)}`})));
}

export async function routeReceipt(settings, pending, receipt, client = new Modulo(settings)) {
  if (pending.moduloURL !== client.origin) throw new Error('Restore the original Modulo origin before retrying.');
  const context = pending.capture.context;
  const record = await client.para();
  if (record.schemaId !== 'modulo.workspace.para' || !Array.isArray(record.value.resources)) throw new Error('Unexpected Modulo PARA record; no data was changed.');
  let target;
  if (context.kind === 'note') {
    if (!/^\d+$/.test(context.id)) throw new Error('Modulo note IDs must be numeric.');
    target = await client.request(`/api/notes/${encodeURIComponent(context.id)}`);
  } else {
    target = (record.value[`${context.kind}s`] || []).find(item => item.id === context.id && !item.archivedAt);
  }
  if (!target) throw new Error('The Modulo target is missing or archived. Restore it or discard the pending request.');
  const id = `noesis-capture-${pending.key}`;
  const existing = record.value.resources.find(item => item.id === id);
  if (existing) {
    if (existing.sourceId !== receipt.session_id) throw new Error('Modulo receipt ID conflicts with another source.');
    return {resourceId: id, replayed: true};
  }
  const content = [
    '# Noesis browser capture',
    `Session: ${receipt.session_id}`, `Namespace: ${receipt.namespace}`, `Revision: ${receipt.revision}`,
    `Action: ${receipt.action}`, `Execution: ${receipt.execution}`,
    `Target: ${context.kind} ${context.id} (captured version ${context.version})`,
    `Question: ${pending.capture.question || '(source capture)'}`,
    'This is a source/session pointer. Research has not been executed by the browser extension.'
  ].join('\n\n');
  const resource = {id, title: `Noesis: ${pending.capture.sources[0].title}`,
    type: 'Reference', status: 'Queued', content, sourceId: receipt.session_id,
    projectIds: context.kind === 'project' ? [context.id] : target.projectId ? [target.projectId] : [],
    areaIds: context.kind === 'area' ? [context.id] : target.areaId ? [target.areaId] : target.areaIds || [],
    ...(context.kind === 'note' ? {noteId: Number(context.id)} : {}),
    externalRefs: [{pluginId: 'noesis', entityType: 'intake-session', entityId: receipt.session_id},
      {pluginId: context.kind === 'note' ? 'notes-editor' : 'para-core', entityType: context.kind, entityId: context.id}]};
  await client.request('/api/workspaces/personal/plugin-state/workspace-para/data', 'PUT', {
    expectedVersion: record.version, schemaId: record.schemaId, schemaVersion: record.schemaVersion,
    value: {...record.value, resources: [...record.value.resources, resource]}
  });
  return {resourceId: id, replayed: false};
}
