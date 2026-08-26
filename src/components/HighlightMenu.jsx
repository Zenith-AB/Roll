import { useCallback } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';
import { COLORS } from '../utils/constants';

export default function HighlightMenu({ position, onSelectColor, onDismiss }) {
  const isMobile = useIsMobile();

  const handleSelect = useCallback(
    (color) => {
      onSelectColor(color);
    },
    [onSelectColor]
  );

  if (!position) return null;

  return (
    <>
      <div className="menu-backdrop" onClick={onDismiss} />
      <div
        className={`highlight-menu ${isMobile ? 'highlight-menu--sheet' : ''}`}
        style={
          isMobile
            ? undefined
            : {
                position: 'fixed',
                top: position.y,
                left: Math.min(
                  Math.max(12, position.x - 100),
                  window.innerWidth - 220
                ),
                transform: position.preferBelow ? 'none' : 'translateY(-100%)',
                zIndex: 9999,
              }
        }
      >
        {COLORS.map((c) => (
          <button
            key={c.name}
            className="color-btn"
            style={{ background: c.bg, borderColor: c.border }}
            title={c.name}
            aria-label={`Subrayar en ${c.name}`}
            onClick={() => handleSelect(c)}
          />
        ))}
        <button className="cancel-btn" onClick={onDismiss}>
          ✕
        </button>
      </div>
    </>
  );
}
