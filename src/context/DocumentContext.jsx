import { createContext, useContext, useState, useCallback } from 'react';
import { loadPdfFromFile } from '../services/pdfExtractor';

const DocumentContext = createContext(null);

export function DocumentProvider({ children }) {
  const [docContent, setDocContent] = useState(null);
  const [fileName, setFileName] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [totalPages, setTotalPages] = useState(0);

  const loadPdf = useCallback(async (file) => {
    if (!file || file.type !== 'application/pdf') return;
    setFileName(file.name);
    setIsExtracting(true);
    try {
      const doc = await loadPdfFromFile(file);
      setDocContent(doc);
      const maxPage = doc.reduce((max, p) => Math.max(max, p.page), 0);
      setTotalPages(maxPage);
    } catch (err) {
      console.error('Error al extraer texto del PDF:', err);
    } finally {
      setIsExtracting(false);
    }
  }, []);

  const reset = useCallback(() => {
    setDocContent(null);
    setFileName('');
    setIsExtracting(false);
    setTotalPages(0);
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
