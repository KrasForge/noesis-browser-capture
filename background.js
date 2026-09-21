// Register listeners synchronously so Firefox can wake the event page.
let chain = Promise.resolve();
function serialize(operation) {
  const next = chain.then(operation, operation);
  chain = next.catch(() => {});
  return next;
}
browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL(''))) return;
  return serialize(async () => {
    try {
      const {handle} = await import('./queue.js');
      return {ok: true, value: await handle(message)};
    } catch (error) {
      // Do not echo server text, URL query strings, or credentials into receipts.
      return {ok: false, error: error.message};
    }
  });
});
browser.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'capture-retention') serialize(async () => (await import('./queue.js')).handle({type: 'prune'}));
});
browser.runtime.onInstalled.addListener(() => {
  browser.alarms.create('capture-retention', {periodInMinutes: 60});
});
browser.runtime.onStartup.addListener(() => {
  browser.alarms.create('capture-retention', {periodInMinutes: 60});
  serialize(async () => (await import('./queue.js')).handle({type: 'prune'}));
});
