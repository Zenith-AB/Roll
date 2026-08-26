import { memo, useMemo } from 'react';

const Paragraph = memo(function Paragraph({ idx, para, highlights, searchQuery, isSearchActive, onHighlightClick, style }) {
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

  const Tag =
    para.type === 'heading'
      ? 'h2'
      : para.type === 'subheading'
        ? 'h3'
        : para.type === 'subheading2'
          ? 'h4'
          : 'p';

  const classNames = [
    'doc-paragraph',
    para.type === 'heading' ? 'doc-heading' : '',
    para.type === 'subheading' ? 'doc-subheading' : '',
    para.type === 'subheading2' ? 'doc-subheading2' : '',
    para.type === 'verse' ? 'doc-verse' : '',
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
