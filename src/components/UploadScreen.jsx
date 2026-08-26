import { useState, useCallback } from 'react';
import { useDocument } from '../context/DocumentContext';

export default function UploadScreen() {
  const { loadPdf } = useDocument();
  const [isDragging, setIsDragging] = useState(false);

  const handleFileUpload = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file) loadPdf(file);
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

      <label className="upload-button">
        Seleccionar PDF
        <input type="file" accept="application/pdf" onChange={handleFileUpload} />
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
