import { useCallback } from 'react';
import { useDocument } from '../context/DocumentContext';

export default function TableOfContents({ onClose }) {
  const { headings } = useDocument();

  const scrollToHeading = useCallback(
    (idx) => {
      const el = document.querySelector(`[data-idx="${idx}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Brief flash effect
        el.classList.add('search-active');
        setTimeout(() => el.classList.remove('search-active'), 1500);
      }
      onClose();
    },
    [onClose]
  );

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <div className="slide-panel slide-panel--left">
        <div className="panel-header">
          <span className="panel-title">Índice</span>
          <button className="panel-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="panel-body">
          {headings.length === 0 ? (
            <div className="toc-empty">
              No se encontraron encabezados en este documento
            </div>
          ) : (
            headings.map((h) => (
              <button
                key={h.idx}
                className={`toc-item ${
                  h.type === 'heading'
                    ? 'toc-item--heading'
                    : h.type === 'subheading2'
                      ? 'toc-item--subheading2'
                      : 'toc-item--subheading'
                }`}
                onClick={() => scrollToHeading(h.idx)}
              >
                <span>{h.text}</span>
                <span className="toc-page">p.{h.page}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
