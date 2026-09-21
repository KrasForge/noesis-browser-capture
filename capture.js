import {endpoint, sourceURL} from './core.js';

export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_QUEUE = 20;
export const ACTIONS = {
  save: ['Save source', 'Store a source snapshot.'],
  research: ['Research page', 'Queue a research question grounded in this source.'],
  verify: ['Verify claim', 'Queue a claim check with the exact selected claim.'],
  original: ['Find original', 'Queue a primary-source provenance investigation.'],
  related: ['Find related work', 'Queue a related-literature search.'],
  counterarguments: ['Find counterarguments', 'Queue a search for independent contradictory evidence.'],
  explain: ['Explain', 'Queue an explanation with audience and question context.'],
  deep: ['Deep research', 'Queue a scoped research brief; execution requires a budget.'],
  monitor: ['Monitor topic', 'Queue a monitoring proposal; no recurring job starts automatically.']
};

// A deliberate, public source URL is the only URL sent. Fragments and query
// parameters are removed by default; the user may explicitly retain a query.
export function cleanURL(value, keepQuery = false) {
  if (typeof value !== 'string' || value.length > 8192) throw new Error('Source URL is too long.');
  const url = new URL(sourceURL(value));
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') ||
      host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host) || !host.includes('.')) {
    throw new Error('Local, private-network, and IP-literal pages are excluded.');
  }
  url.hash = '';
  if (!keepQuery) url.search = '';
  return url.href;
}

export function validateCapture(value) {
  if (!value || !ACTIONS[value.action]) throw new Error('Choose a supported capture action.');
  if (value.private || !value.confirmedPublic) throw new Error('Only explicitly confirmed public content can be captured.');
  if (!Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > MAX_QUEUE) throw new Error('Choose between 1 and 20 sources.');
  if (typeof value.question !== 'string' || value.question.length > 10000 || typeof value.note !== 'string' || value.note.length > 10000) throw new Error('Question and note must be at most 10,000 characters.');
  if (value.action !== 'save' && !value.question.trim()) throw new Error('Enter a question for this action.');
  for (const source of value.sources) {
    cleanURL(source.url, true);
    if (!['page', 'selection', 'pdf', 'tab'].includes(source.unit) || typeof source.title !== 'string' || !source.title.trim() || source.title.length > 1024) throw new Error('Invalid source title or capture unit.');
    if (source.content !== null && (typeof source.content !== 'string' || source.content.length > 100000)) throw new Error('Text is limited to 100,000 characters per source.');
    if (source.unit === 'selection' && !source.content?.trim()) throw new Error('Select text before capturing a selection.');
    if (source.unit === 'pdf' && source.content !== null) throw new Error('PDF capture sends the public URL only, not PDF viewer content.');
  }
  if (value.action === 'verify' && !value.sources.some(s => s.unit === 'selection' && s.content?.trim())) throw new Error('Verify claim requires an explicit text selection.');
  const context = value.context || {};
  if (context.routeToModulo && !context.kind) throw new Error('Choose a Modulo target before enabling routing.');
  if (!['', 'project', 'area', 'note', 'task'].includes(context.kind || '')) throw new Error('Invalid Modulo object type.');
  if (context.kind && (!context.id || context.id.length > 128 || !Number.isInteger(context.version) || context.version < 1)) throw new Error('Modulo context requires an object ID and a positive version.');
  if (context.returnURL) {
    const target = new URL(context.returnURL);
    if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Use an HTTPS Modulo return URL without credentials.');
  }
  return value;
}

export function makePending(settings, capture, now = Date.now(), key = crypto.randomUUID()) {
  validateCapture(capture);
  return {key, endpoint: endpoint(settings.url), namespace: settings.namespace,
    createdAt: now, expiresAt: now + RETENTION_MS,
    moduloURL: capture.context?.routeToModulo ? new URL(endpoint(settings.moduloURL)).origin : null, capture};
}

export function pruneQueue(queue, now = Date.now()) {
  return (Array.isArray(queue) ? queue : []).filter(item => Number.isFinite(item.expiresAt) && item.expiresAt > now);
}

export function workspaceLinks(context = {}) {
  // Areas are preserved in inputs.capture.context: the current Noesis handoff
  // contract only supports projects, notes and tasks as direct workspace links.
  return context.kind && context.kind !== 'area' ? [{system: 'modulo', workspace_id: 'personal',
    kind: context.kind, id: context.id, version: context.version}] : [];
}
