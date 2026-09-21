// These functions are serialized by scripting.executeScript: keep them
// self-contained, with no imported helpers or access to extension credentials.
export function readSelection() {
  if (document.querySelector('input[type="password"]')) throw new Error('Password-entry pages are excluded.');
  const selection = window.getSelection().toString();
  return {text: selection.slice(0, 100000), truncated: selection.length > 100000};
}

export function readArticle() {
  if (document.querySelector('input[type="password"]')) throw new Error('Password-entry pages are excluded.');
  const root = document.querySelector('article') || document.querySelector('main');
  if (!root) throw new Error('No article or main section found. Select the exact text instead.');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '', node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest('script,style,noscript,form,input,textarea,select,[contenteditable],[hidden],[aria-hidden="true"]')) continue;
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || !parent.getClientRects().length) continue;
    text += node.textContent + ' ';
    if (text.length > 100000) return {text: text.slice(0, 100000), truncated: true};
  }
  return {text, truncated: false};
}
