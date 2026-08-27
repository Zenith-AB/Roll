import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { loadPdfFromFile } from '../services/pdfExtractor';

const DocumentContext = createContext(null);

// Figures live as blob URLs, which the browser keeps alive until they are
// explicitly released — a document swapped out without this leaks every one of
// its images for the lifetime of the tab, and on a phone a couple of documents
// is enough to get the tab discarded mid-read.
function releaseFigures(blocks) {
  if (!blocks) return;
  for (const block of blocks) {
    const url = block?.image?.url;
    if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  }
}

export function DocumentProvider({ children }) {
  const [docContent, setDocContent] = useState(null);
  const [fileName, setFileName] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [totalPages, setTotalPages] = useState(0);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null);

  // The state value is not readable from the cleanup of an unrelated effect,
  // so the current blocks are mirrored here purely to be able to free them.
  const liveContent = useRef(null);
  liveContent.current = docContent;

  useEffect(() => () => releaseFigures(liveContent.current), []);

  const loadPdf = useCallback(async (file) => {
    if (!file) return;

    // iOS hands over files from Files/iCloud/Drive with an empty or generic
    // MIME type, so a strict `type === 'application/pdf'` check silently threw
    // the file away and nothing happened on screen. Accept by extension too,
    // and let pdf.js be the real judge of whether it can parse it.
    const looksLikePdf =
      /pdf/i.test(file.type || '') || /\.pdf$/i.test(file.name || '');

    releaseFigures(liveContent.current);
    setError(null);
    setFileName(file.name || 'documento.pdf');
    setIsExtracting(true);
    setProgress(null);

    try {
      if (!looksLikePdf && file.type) {
        throw new Error(`El archivo no parece un PDF (${file.type}).`);
      }

      const doc = await loadPdfFromFile(file, setProgress);
      if (!doc.length) {
        throw new Error(
          'No se encontró texto ni imágenes en este PDF. Si es un documento ' +
            'escaneado protegido, es posible que no permita extraer su contenido.'
        );
      }
      setDocContent(doc);
      setTotalPages(doc.reduce((max, p) => Math.max(max, p.page), 0));
    } catch (err) {
      console.error('Error al extraer texto del PDF:', err);
      setDocContent(null);
      setTotalPages(0);
      // Include where it broke: on a phone there is no console, so the first
      // stack frame is the only clue about which call actually failed.
      const frame = (err?.stack || '').split('\n')[1]?.trim().slice(0, 120);
      setError((err?.message || String(err)) + (frame ? ` [${frame}]` : ''));
    } finally {
      setIsExtracting(false);
      setProgress(null);
    }
  }, []);

  const reset = useCallback(() => {
    releaseFigures(liveContent.current);
    setDocContent(null);
    setFileName('');
    setIsExtracting(false);
    setTotalPages(0);
    setError(null);
    setProgress(null);
  }, []);

  const headings = docContent
    ? docContent
        .map((p, idx) => ({ ...p, idx }))
        .filter((p) => p.type === 'heading' || p.type === 'subheading' || p.type === 'subheading2')
    : [];

  const wordCount = docContent
    ? docContent.reduce((sum, p) => {
        const words = p.text ? p.text.trim().split(/\s+/).filter(Boolean).length : 0;
        return sum + words;
      }, 0)
    : 0;

  const figureCount = docContent ? docContent.filter((p) => p.type === 'figure').length : 0;
  const tableCount = docContent ? docContent.filter((p) => p.type === 'table').length : 0;
  const commentCount = docContent ? docContent.filter((p) => p.type === 'annotation').length : 0;

  const estimatedReadingTime = Math.max(1, Math.ceil(wordCount / 230));

  return (
    <DocumentContext.Provider
      value={{
        docContent,
        fileName,
        isExtracting,
        progress,
        totalPages,
        headings,
        wordCount,
        figureCount,
        tableCount,
        commentCount,
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
