import { useDocument } from '../context/DocumentContext';

export default function Header({
  onToggleToc,
  onToggleSearch,
  onToggleNotes,
  onToggleSettings,
  showSearch,
  showToc,
  showNotes,
  showSettings,
}) {
  const { docContent, fileName, estimatedReadingTime, reset } = useDocument();

  return (
    <header className="header">
      <span className="header-brand">Rollo</span>
      {docContent && (
        <>
          <span className="header-file" title={fileName}>
            {fileName}
          </span>
          <span className="header-info">
            ~{estimatedReadingTime} min lectura
          </span>
          <div className="header-actions">
            <button
              className={`header-tool-btn ${showToc ? 'active' : ''}`}
              onClick={onToggleToc}
              title="Índice"
              aria-label="Índice"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 6h16M4 12h10M4 18h14" />
              </svg>
            </button>
            <button
              className={`header-tool-btn ${showSearch ? 'active' : ''}`}
              onClick={onToggleSearch}
              title="Buscar"
              aria-label="Buscar"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
            </button>
            <button
              className={`header-tool-btn ${showNotes ? 'active' : ''}`}
              onClick={onToggleNotes}
              title="Notas y subrayados"
              aria-label="Notas y subrayados"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            </button>
            <button
              className={`header-tool-btn ${showSettings ? 'active' : ''}`}
              onClick={onToggleSettings}
              title="Ajustes de lectura"
              aria-label="Ajustes de lectura"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
            <button className="header-new" onClick={reset}>
              Nuevo
            </button>
          </div>
        </>
      )}
    </header>
  );
}
