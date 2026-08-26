import { useState, useCallback } from 'react';
import { useHighlights } from '../context/HighlightsContext';
import { useDocument } from '../context/DocumentContext';

export default function NotesPanel({ onClose, onEditHighlight }) {
  const { highlights } = useHighlights();
  const { docContent } = useDocument();
  const [filter, setFilter] = useState('all');

  const filtered = filter === 'all'
    ? highlights
    : filter === 'notes'
      ? highlights.filter((h) => h.note)
      : highlights.filter((h) => h.colorObj.name === filter);

  const sorted = [...filtered].sort((a, b) => a.paragraphIndex - b.paragraphIndex || a.startOffset - b.startOffset);

  const scrollToHighlight = useCallback(
    (hl) => {
      const el = document.querySelector(`[data-idx="${hl.paragraphIndex}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('search-active');
        setTimeout(() => el.classList.remove('search-active'), 1500);
      }
      onEditHighlight(hl.id);
      onClose();
    },
    [onClose, onEditHighlight]
  );

  const colorFilters = [...new Set(highlights.map((h) => h.colorObj.name))];

  return (
    <>
      <div className="panel-backdrop" onClick={onClose} />
      <div className="slide-panel slide-panel--right">
        <div className="panel-header">
          <span className="panel-title">
            Subrayados ({highlights.length})
          </span>
          <button className="panel-close" onClick={onClose}>
            ×
          </button>
        </div>

        {highlights.length > 0 && (
          <div className="notes-filter">
            <button
              className={`notes-filter-btn ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              Todos
            </button>
            <button
              className={`notes-filter-btn ${filter === 'notes' ? 'active' : ''}`}
              onClick={() => setFilter('notes')}
            >
              Con notas
            </button>
            {colorFilters.map((name) => (
              <button
                key={name}
                className={`notes-filter-btn ${filter === name ? 'active' : ''}`}
                onClick={() => setFilter(name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        <div className="panel-body">
          {sorted.length === 0 ? (
            <div className="notes-empty">
              {highlights.length === 0
                ? 'Selecciona texto en el documento para crear subrayados y notas'
                : 'No hay resultados para este filtro'}
            </div>
          ) : (
            sorted.map((hl) => {
              const paraText = docContent?.[hl.paragraphIndex]?.text || '';
              const hlText = paraText.slice(hl.startOffset, hl.endOffset);
              const page = docContent?.[hl.paragraphIndex]?.page || '?';

              return (
                <div
                  key={hl.id}
                  className="notes-item"
                  onClick={() => scrollToHighlight(hl)}
                >
                  <div className="notes-item-header">
                    <span
                      className="notes-item-dot"
                      style={{ background: hl.colorObj.solid || hl.colorObj.border }}
                    />
                    <span className="notes-item-page">Página {page}</span>
                  </div>
                  <div className="notes-item-text">{hlText}</div>
                  {hl.note && <div className="notes-item-note">{hl.note}</div>}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
