import { memo } from 'react';
import Paragraph from './Paragraph';

/**
 * A comment the author left inside the PDF itself — a sticky note, a callout, a
 * margin remark. These are not part of the page's text at all; they live in the
 * annotation dictionary, and every reader that ignores them drops something the
 * author deliberately wrote.
 *
 * It is marked up as an `<aside>` with a `<cite>` for who wrote it and a
 * `<time>` for when, so the comment stays attributable instead of dissolving
 * into the body text.
 */
const DocComment = memo(function DocComment({
  idx,
  para,
  highlights,
  searchQuery,
  onHighlightClick,
  style,
}) {
  return (
    <aside className="doc-comment">
      <p className="doc-comment-head">
        <span className="doc-comment-kind">{para.label}</span>
        {para.author && <cite className="doc-comment-author">{para.author}</cite>}
        {para.date && <time className="doc-comment-date">{para.date}</time>}
      </p>
      <Paragraph
        idx={idx}
        para={para}
        highlights={highlights}
        searchQuery={searchQuery}
        isSearchActive={false}
        onHighlightClick={onHighlightClick}
        style={style}
      />
    </aside>
  );
});

export default DocComment;
