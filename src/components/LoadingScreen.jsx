import { useDocument } from '../context/DocumentContext';

const PHASE_LABEL = {
  text: 'Leyendo el texto',
  figures: 'Recuperando figuras y comentarios',
};

// Rebuilding a document now involves re-rendering its illustrations, which on a
// long PDF takes real time. A spinner with no numbers reads as "frozen" on a
// phone, so the page being worked on is shown as it goes.
export default function LoadingScreen() {
  const { progress } = useDocument();
  const percent =
    progress?.total ? Math.min(100, Math.round((progress.page / progress.total) * 100)) : null;

  return (
    <div className="loading">
      <div className="spinner" />
      <p>{PHASE_LABEL[progress?.phase] || 'Extrayendo el documento'}…</p>
      {percent != null && (
        <>
          <div
            className="loading-bar"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="loading-bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="loading-detail">
            Página {progress.page} de {progress.total}
          </p>
        </>
      )}
    </div>
  );
}
