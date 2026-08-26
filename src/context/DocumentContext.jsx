import { createContext, useContext, useState, useCallback } from 'react';
import { loadPdfFromFile } from '../services/pdfExtractor';

const DocumentContext = createContext(null);

export function DocumentProvider({ children }) {
  const [docContent, setDocContent] = useState(null);
  const [fileName, setFileName] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState(null);

  const loadPdf = useCallback(async (file) => {
    if (!file) return;

    // iOS hands over files from Files/iCloud/Drive with an empty or generic
    // MIME type, so a strict `type === 'application/pdf'` check silently threw
    // the file away and nothing happened on screen. Accept by extension too,
    // and let pdf.js be the real judge of whether it can parse it.
    const looksLikePdf =
      /pdf/i.test(file.type || '') || /\.pdf$/i.test(file.name || '');

    setError(null);
    setFileName(file.name || 'documento.pdf');
    setIsExtracting(true);
    try {
      if (!looksLikePdf && file.type) {
        throw new Error(`El archivo no parece un PDF (${file.type}).`);
      }
      const doc = await loadPdfFromFile(file);
      if (!doc.length) {
        throw new Error(
          'No se encontró texto en este PDF. Si es un documento escaneado, ' +
            'las páginas son imágenes y no contienen texto seleccionable.'
        );
      }
      setDocContent(doc);
      setTotalPages(doc.reduce((max, p) => Math.max(max, p.page), 0));
    } catch (err) {
      console.error('Error al extraer texto del PDF:', err);
      setDocContent(null);
      setTotalPages(0);
      setError(err?.message || String(err));
    } finally {
      setIsExtracting(false);
    }
  }, []);

  const reset = useCallback(() => {
    setDocContent(null);
    setFileName('');
    setIsExtracting(false);
    setTotalPages(0);
    setError(null);
  }, []);

  const headings = docContent
    ? docContent
        .map((p, idx) => ({ ...p, idx }))
        .filter((p) => p.type === 'heading' || p.type === 'subheading' || p.type === 'subheading2')
    : [];

  const wordCount = docContent
    ? docContent.reduce((sum, p) => sum + p.text.split(/\s+/).length, 0)
    : 0;

  const estimatedReadingTime = Math.max(1, Math.ceil(wordCount / 230));

  return (
    <DocumentContext.Provider
      value={{
        docContent,
        fileName,
        isExtracting,
        totalPages,
        headings,
        wordCount,
        estimatedReadingTime,
        error,
        loadPdf,
        reset,
      }}
    >
      {children}
    </DocumentContext.Provider>
  );
}

export function useDocument() {
  const ctx = useContext(DocumentContext);
  if (!ctx) throw new Error('useDocument must be used within DocumentProvider');
  return ctx;
}
