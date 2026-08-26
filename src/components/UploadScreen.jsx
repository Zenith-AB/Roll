import { useState, useCallback } from 'react';
import { useDocument } from '../context/DocumentContext';

function describeEnvironment() {
  const ua = navigator.userAgent || '';
  const ios = ua.match(/OS (\d+)[._](\d+)/);
  const has = (label, ok) => `${label}:${ok ? 'ok' : 'NO'}`;
  let moduleWorker = false;
  try {
    // Feature-detect module workers without actually spawning one.
    new Worker('data:text/javascript,', {
      get type() {
        moduleWorker = true;
        return 'module';
      },
    }).terminate();
  } catch {
    /* detection failed; leave as false */
  }
  return [
    ios ? `iOS ${ios[1]}.${ios[2]}` : 'iOS ?',
    has('withResolvers', typeof Promise.withResolvers === 'function'),
    has('structuredClone', typeof structuredClone === 'function'),
    has('moduleWorker', moduleWorker),
  ].join(' · ');
}

export default function UploadScreen() {
  const { loadPdf, error } = useDocument();
  const [isDragging, setIsDragging] = useState(false);

  const handleFileUpload = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file) loadPdf(file);
      // Let the same file be picked again after an error.
      e.target.value = '';
    },
    [loadPdf]
  );

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) loadPdf(file);
    },
    [loadPdf]
  );

  return (
    <div className="upload-section">
      <div className="upload-icon">📄</div>
      <h1>Rollo</h1>
      <p className="subtitle">
        Convierte tu PDF en un documento interactivo con subrayados, notas y herramientas de lectura
      </p>

      {error && (
        <div className="upload-error" role="alert">
          <p>{error}</p>
          {/* Shown only on failure: on a phone there is no console, so this is
              the only way to find out which capability the device is missing. */}
          <p className="upload-diag">{describeEnvironment()}</p>
        </div>
      )}

      <label className="upload-button">
        Seleccionar PDF
        {/* Include the `.pdf` extension, not just the MIME type: iOS matches
            document-provider files (iCloud/Drive) by extension, and a
            MIME-only filter can grey them out in the picker. */}
        <input type="file" accept=".pdf,application/pdf" onChange={handleFileUpload} />
      </label>

      <div
        className={`dropzone ${isDragging ? 'dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="dropzone-content">
          <p>o arrastra y suelta aquí</p>
        </div>
      </div>
    </div>
  );
}
