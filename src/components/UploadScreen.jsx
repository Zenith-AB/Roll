import { useState, useCallback } from 'react';
import { useDocument } from '../context/DocumentContext';

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
        <p className="upload-error" role="alert">
          {error}
        </p>
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
