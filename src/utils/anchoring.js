// Re-finding a highlight in a document that has been re-extracted.
//
// A highlight used to be stored as "block 47, characters 12 to 58". That is a
// coordinate into a particular run of the extractor, and the extractor is the
// part of this program that changes most: improve the reading order, merge a
// table across a page break, stop treating a title page as tabular data, and
// every one of those numbers now points somewhere else. The reader reopens a
// document they had annotated and finds their marks scattered over unrelated
// sentences — silently, with no error and no way back.
//
// So a highlight also records what it was actually placed on: the quoted text,
// and a little of what surrounded it. The numbers stay as a fast path, and when
// they no longer hold, the quote is searched for instead. This is the same
// approach as the W3C's text quote selector, for the same reason.

export const CONTEXT_CHARS = 48;

export function describeSelection(text, startOffset, endOffset) {
  return {
    quote: text.slice(startOffset, endOffset),
    prefix: text.slice(Math.max(0, startOffset - CONTEXT_CHARS), startOffset),
    suffix: text.slice(endOffset, endOffset + CONTEXT_CHARS),
  };
}

function commonSuffixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a, b) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Finds where a stored highlight belongs in the current document.
 *
 * Returns `{ paragraphIndex, startOffset, endOffset }`, or null when the quoted
 * text is nowhere to be found — which happens legitimately, for instance when
 * the highlight sat on a running header that is now stripped.
 */
export function locateHighlight(blocks, highlight) {
  const { quote, prefix = '', suffix = '', paragraphIndex = 0 } = highlight;
  if (!quote) return null;

  let best = null;

  for (let index = 0; index < blocks.length; index++) {
    const text = blocks[index]?.text || '';
    if (!text) continue;

    let from = 0;
    for (;;) {
      const at = text.indexOf(quote, from);
      if (at < 0) break;

      const before = text.slice(Math.max(0, at - prefix.length), at);
      const after = text.slice(at + quote.length, at + quote.length + suffix.length);
      // How much of the original surroundings still line up, minus a small
      // penalty for having moved a long way: the same sentence quoted twice in
      // a document should resolve to the copy nearest where it used to be.
      const score =
        commonSuffixLength(before, prefix) +
        commonPrefixLength(after, suffix) -
        Math.min(40, Math.abs(index - paragraphIndex)) * 0.25;

      if (!best || score > best.score) {
        best = {
          score,
          paragraphIndex: index,
          startOffset: at,
          endOffset: at + quote.length,
        };
      }
      from = at + 1;
    }
  }

  if (!best) return null;
  return {
    paragraphIndex: best.paragraphIndex,
    startOffset: best.startOffset,
    endOffset: best.endOffset,
  };
}

/**
 * Brings a document's stored highlights back onto its current text.
 *
 * A highlight whose quote cannot be found is kept but marked `orphan`: it is
 * not drawn, and it is not thrown away either, because the next improvement to
 * the extractor may well bring its sentence back.
 */
export function reanchorHighlights(stored, blocks) {
  if (!Array.isArray(stored) || !blocks?.length) return stored || [];

  return stored.map((highlight) => {
    const block = blocks[highlight.paragraphIndex];
    const stillThere =
      block &&
      typeof block.text === 'string' &&
      block.text.slice(highlight.startOffset, highlight.endOffset) === highlight.quote;

    if (stillThere) return highlight.orphan ? { ...highlight, orphan: false } : highlight;

    // Records written before highlights carried their quote cannot be checked
    // or moved; they are left exactly as they are.
    if (!highlight.quote) return highlight;

    const found = locateHighlight(blocks, highlight);
    return found ? { ...highlight, ...found, orphan: false } : { ...highlight, orphan: true };
  });
}
