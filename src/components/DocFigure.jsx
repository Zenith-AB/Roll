import { memo } from 'react';
import Paragraph from './Paragraph';

/**
 * An illustration lifted out of the PDF.
 *
 * It is a real `<figure>`/`<figcaption>` pair, so the caption stays bound to
 * the picture it describes when the document is copied, read aloud or printed
 * — and the `data-idx` lives on the caption, which is the only searchable and
 * highlightable text a figure has.
 *
 * Figures are drawn for white paper, so each one keeps its own white sheet:
 * black line art on a dark theme would otherwise be invisible.
 */
const DocFigure = memo(function DocFigure({
  idx,
  para,
  highlights,
  searchQuery,
  onHighlightClick,
  onOpen,
  style,
}) {
  const { image, caption } = para;
  if (!image?.url) return null;

  return (
    <figure className="doc-figure">
      <button
        type="button"
        className="doc-figure-frame"
        onClick={() => onOpen(para)}
        aria-label={caption ? `Ampliar figura: ${caption}` : 'Ampliar figura'}
      >
        <img
          className="doc-figure-img"
          src={image.url}
          alt={caption || 'Figura del documento'}
          width={image.width}
          height={image.height}
          /* Reserving the box up front keeps the page from jumping as figures
             decode — the difference between a readable scroll and text that
             slides out from under the reader's thumb. */
          style={{ aspectRatio: `${image.width} / ${image.height}` }}
          loading="lazy"
          decoding="async"
          draggable="false"
        />
        <span className="doc-figure-hint" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M11 8v6M8 11h6M20 20l-4.3-4.3" />
          </svg>
        </span>
      </button>

      {caption && (
        <Paragraph
          idx={idx}
          para={para}
          highlights={highlights}
          searchQuery={searchQuery}
          isSearchActive={false}
          onHighlightClick={onHighlightClick}
          style={style}
          tag="figcaption"
          extraClass="doc-figcaption"
        />
      )}
    </figure>
  );
});

export default DocFigure;
