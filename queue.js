import {makePending, pruneQueue, MAX_QUEUE} from './capture.js';
import {submitBatch, submitCapture} from './core.js';
import {listContexts, routeReceipt} from './modulo.js';

export async function handle(message, storage = browser.storage.local, submit = submitBatch) {
  const state = await storage.get(['queue', 'settings', 'receipts', 'pending', 'legacyExpiresAt']);
  let queue = pruneQueue(state.queue);
  state.receipts = (state.receipts || []).filter(item => item.savedAt > Date.now() - 7 * 86400000);
  await storage.set({queue, receipts: state.receipts});
  if (state.pending && !state.legacyExpiresAt) await storage.set({legacyExpiresAt: Date.now() + 7 * 86400000});
  if (state.pending && state.legacyExpiresAt <= Date.now()) { await storage.remove(['pending', 'legacyExpiresAt']); state.pending = null; }
  if (message.type === 'prune') return;
  if (message.type === 'list') return {queue: queue.map(({key, capture, expiresAt}) => ({key, title: capture.sources[0].title, count: capture.sources.length, expiresAt})), receipts: state.receipts || [], legacyPending: !!state.pending};
  if (message.type === 'discard') {
    queue = queue.filter(item => item.key !== message.key);
    await storage.set({queue}); return;
  }
  if (message.type === 'clear') {
    await storage.remove(['queue', 'pending', 'legacyExpiresAt', 'receipts', 'lastCapture']); return;
  }
  if (!state.settings) throw new Error('Configure a Noesis connection first.');
  if (message.type === 'send-legacy') {
    if (!state.pending) throw new Error('No legacy pending capture remains.');
    const result = await submitCapture(state.settings, state.pending);
    const receipt = {session_id: result.session_id, revision: result.revision, namespace: state.pending.namespace, action: 'save', execution: 'source_capture', savedAt: Date.now()};
    await storage.set({receipts: [receipt, ...state.receipts].slice(0, 20)});
    await storage.remove(['pending', 'legacyExpiresAt']);
    return receipt;
  }
  if (message.type === 'contexts') return listContexts(state.settings);
  let item;
  if (message.type === 'enqueue') {
    if (queue.length >= MAX_QUEUE) throw new Error('The queue is full. Retry or discard a capture first.');
    item = makePending(state.settings, message.capture);
    item.credentialHash = await credentialHash(state.settings);
    queue.push(item);
    if (new TextEncoder().encode(JSON.stringify(queue)).byteLength > 4_000_000) throw new Error('The local queue has reached its 4 MB limit. Retry or discard existing captures first.');
    await storage.set({queue});
    return {key: item.key};
  }
  if (message.type !== 'send') throw new Error('Unknown capture operation.');
  item = queue.find(entry => entry.key === message.key);
  if (!item) throw new Error('Capture was already saved, discarded, or expired.');
  // Pin the credential identity without persisting a bearer token in queue data.
  const tokenHash = await credentialHash(state.settings);
  if (item.credentialHash && item.credentialHash !== tokenHash) throw new Error('The caller token changed. Restore the original token to retry, or discard this capture.');
  item.credentialHash = tokenHash;
  await storage.set({queue});
  const receipt = await submit(state.settings, item);
  if (item.capture.context?.routeToModulo) receipt.modulo = await routeReceipt(state.settings, item, receipt);
  // Receipt and queue removal commit together. Lost responses replay the same keys.
  await storage.set({queue: queue.filter(entry => entry.key !== item.key),
    receipts: [{...receipt, savedAt: Date.now()}, ...(state.receipts || [])].slice(0, 20)});
  return receipt;
}

async function credentialHash(settings) {
  const bytes = new TextEncoder().encode(JSON.stringify([settings.token, settings.moduloToken || '']));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(x => x.toString(16).padStart(2, '0')).join('');
}
