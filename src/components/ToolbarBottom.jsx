import { useReadingProgress } from '../hooks/useReadingProgress';

export default function ToolbarBottom({
  onToggleToc,
  onToggleSearch,
  onToggleNotes,
  onToggleSettings,
}) {
  const progress = useReadingProgress();

  const circumference = 2 * Math.PI * 8;
  const dashOffset = circumference - (progress / 100) * circumference;

  return (
    <div className="toolbar-bottom">
      <button className="toolbar-btn" onClick={onToggleToc} aria-label="Índice">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6h16M4 12h10M4 18h14" />
        </svg>
        <span className="toolbar-btn-label">Índice</span>
      </button>

      <button className="toolbar-btn" onClick={onToggleSearch} aria-label="Buscar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <span className="toolbar-btn-label">Buscar</span>
      </button>

      <div className="toolbar-progress">
        <svg className="toolbar-progress-ring" viewBox="0 0 22 22">
          <circle
            cx="11"
            cy="11"
            r="8"
            fill="none"
            stroke="var(--border)"
            strokeWidth="2.5"
          />
          <circle
            cx="11"
            cy="11"
            r="8"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            transform="rotate(-90 11 11)"
            style={{ transition: 'stroke-dashoffset 0.3s ease' }}
          />
        </svg>
        <span className="toolbar-progress-label">{progress}%</span>
      </div>

      <button className="toolbar-btn" onClick={onToggleNotes} aria-label="Notas">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
        <span className="toolbar-btn-label">Notas</span>
      </button>

      <button className="toolbar-btn" onClick={onToggleSettings} aria-label="Ajustes">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span className="toolbar-btn-label">Ajustes</span>
      </button>
    </div>
  );
}
