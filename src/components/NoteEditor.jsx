import { useCallback } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
import { useHighlights } from '../context/HighlightsContext';
import { COLORS } from '../utils/constants';

export default function NoteEditor({ highlightId, articleRef, docContent, onClose }) {
  const isMobile = useIsMobile();
  const { highlights, updateNote, deleteHighlight, changeColor } = useHighlights();

  const hl = highlights.find((h) => h.id === highlightId);
  if (!hl) return null;

  const highlightedText = docContent?.[hl.paragraphIndex]?.text?.slice(
    hl.startOffset,
    hl.endOffset
  ) || '';

  const handleDelete = () => {
    deleteHighlight(hl.id);
    onClose();
  };

  // Position calculation for desktop
  let style = {};
  if (!isMobile && articleRef?.current) {
    const paraEl = articleRef.current.querySelector(
      `[data-idx="${hl.paragraphIndex}"]`
    );
    if (paraEl) {
      const rect = paraEl.getBoundingClientRect();
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      style = {
        position: 'absolute',
        top: scrollTop + rect.bottom + 8,
        left: Math.min(
          Math.max(16, rect.left + (rect.width - 320) / 2),
          window.innerWidth - 340
        ),
      };
    }
  }

  return (
    <>
      <div className="note-editor-backdrop" onClick={onClose} />
      <div className="note-editor" style={isMobile ? undefined : style}>
        <div className="note-editor-header">
          <span
            className="note-editor-color-dot"
            style={{ background: hl.colorObj.bg, borderColor: hl.colorObj.border }}
          />
          <span className="note-editor-color-name">{hl.colorObj.name}</span>
          <button className="note-editor-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="note-editor-colors">
          {COLORS.map((c) => (
            <button
              key={c.name}
              className="color-btn"
              style={{
                background: c.bg,
                borderColor: c.border,
                opacity: c.name === hl.colorObj.name ? 1 : 0.5,
              }}
              title={c.name}
              onClick={() => changeColor(hl.id, c)}
            />
          ))}
        </div>

        {highlightedText && (
          <div className="note-editor-preview">
            "{highlightedText.length > 120 ? highlightedText.slice(0, 120) + '…' : highlightedText}"
          </div>
        )}

        <textarea
          className="note-input"
          placeholder="Escribe una nota..."
          value={hl.note}
          onChange={(e) => updateNote(hl.id, e.target.value)}
          autoFocus
        />

        <button className="delete-btn" onClick={handleDelete}>
          Eliminar subrayado
        </button>
      </div>
    </>
  );
}
