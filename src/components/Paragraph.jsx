import { memo, useMemo } from 'react';

// Every block keeps the tag that says what it *is*, not just how it looks: a
// screen reader announces a heading as a heading and a note as a note, the
// browser's own find-in-page and reader modes understand the document, and
// copying a section out of it keeps its structure.
const TAG_BY_TYPE = {
  heading: 'h2',
  subheading: 'h3',
  subheading2: 'h4',
  note: 'aside',
  caption: 'p',
  annotation: 'p',
};

const CLASS_BY_TYPE = {
  heading: 'doc-heading',
  subheading: 'doc-subheading',
  subheading2: 'doc-subheading2',
  verse: 'doc-verse',
  table: 'doc-table',
  caption: 'doc-caption',
  note: 'doc-note',
  annotation: 'doc-comment-body',
};

const Paragraph = memo(function Paragraph({
  idx,
  para,
  highlights,
  searchQuery,
  isSearchActive,
  onHighlightClick,
  style,
  tag,
  extraClass,
}) {
  const text = para.text;

  const segments = useMemo(() => {
    if (!highlights.length) return [{ text, highlight: null }];

    const sorted = [...highlights].sort((a, b) => a.startOffset - b.startOffset);
    const segs = [];
    let lastEnd = 0;

    for (const hl of sorted) {
      const s = Math.max(hl.startOffset, lastEnd);
      const e = Math.min(hl.endOffset, text.length);
      if (s >= e) continue;

      if (s > lastEnd) {
        segs.push({ text: text.slice(lastEnd, s), highlight: null });
      }
      segs.push({ text: text.slice(s, e), highlight: hl });
      lastEnd = e;
    }

    if (lastEnd < text.length) {
      segs.push({ text: text.slice(lastEnd), highlight: null });
    }

    return segs;
  }, [text, highlights]);

  const isSearchMatch = searchQuery && text.toLowerCase().includes(searchQuery.toLowerCase());

  // Justification needs a full measure to look like anything. A block only a
  // line or two long — a title, an author's name, an affiliation — comes out
  // with rivers of white between its words instead, so those stay ragged-right
  // whatever the reader's alignment setting says.
  const isShort = text.length < 120;

  const Tag = tag || TAG_BY_TYPE[para.type] || 'p';

  const classNames = [
    'doc-paragraph',
    CLASS_BY_TYPE[para.type] || '',
    extraClass || '',
    isShort ? 'doc-paragraph--short' : '',
    para.aside ? 'doc-aside' : '',
    isSearchMatch ? 'search-match' : '',
    isSearchActive ? 'search-active' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Tag className={classNames} data-idx={idx} style={style}>
      {segments.map((seg, i) =>
        seg.highlight ? (
          <mark
            key={seg.highlight.id}
            className="doc-highlight"
            style={{
              background: seg.highlight.colorObj.bg,
              borderBottomColor: seg.highlight.colorObj.border,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onHighlightClick(seg.highlight.id);
            }}
          >
            {seg.text}
            {seg.highlight.note && (
              <span className="note-indicator" title={seg.highlight.note}>
                ✎
              </span>
            )}
          </mark>
        ) : (
          <span key={`t${i}`}>{seg.text}</span>
        )
      )}
    </Tag>
  );
});

export default Paragraph;
