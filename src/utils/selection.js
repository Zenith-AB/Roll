export function getSelectionOffsets(containerEl) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);

  if (!containerEl.contains(range.startContainer) || !containerEl.contains(range.endContainer)) {
    return null;
  }

  if (range.startContainer === range.endContainer && range.startOffset === range.endOffset) {
    return null;
  }

  const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT);
  let charIndex = 0;
  let startOffset = null;
  let endOffset = null;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const nodeLen = node.textContent.length;

    if (node === range.startContainer) {
      startOffset = charIndex + range.startOffset;
    }
    if (node === range.endContainer) {
      endOffset = charIndex + range.endOffset;
    }

    charIndex += nodeLen;

    if (startOffset !== null && endOffset !== null) break;
  }

  if (startOffset === null || endOffset === null) return null;
  if (startOffset === endOffset) return null;

  return { start: startOffset, end: endOffset };
}

export function getSelectedParagraphIndex(articleEl) {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.toString().trim()) return null;

  const range = sel.getRangeAt(0);
  if (!articleEl?.contains(range.startContainer)) return null;

  let node = range.startContainer;
  while (node && node !== articleEl) {
    if (node.dataset?.idx !== undefined) break;
    node = node.parentNode;
  }
  if (!node || node.dataset?.idx === undefined) return null;

  return parseInt(node.dataset.idx);
}
