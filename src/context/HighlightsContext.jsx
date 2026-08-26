import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { useDocument } from './DocumentContext';

const HighlightsContext = createContext(null);

function getStorageKey(fileName) {
  return fileName ? `rollo-hl-${fileName}` : null;
}

export function HighlightsProvider({ children }) {
  const { fileName, docContent } = useDocument();
  const [highlights, setHighlights] = useState([]);
  const idCounter = useRef(0);

  // Load highlights from localStorage when file changes
  useEffect(() => {
    const key = getStorageKey(fileName);
    if (!key || !docContent) {
      setHighlights([]);
      idCounter.current = 0;
      return;
    }
    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        const parsed = JSON.parse(stored);
        setHighlights(parsed);
        idCounter.current = parsed.reduce((max, h) => Math.max(max, h.id), 0);
      } else {
        setHighlights([]);
        idCounter.current = 0;
      }
    } catch {
      setHighlights([]);
      idCounter.current = 0;
    }
  }, [fileName, docContent]);

  // Save highlights to localStorage when they change
  useEffect(() => {
    const key = getStorageKey(fileName);
    if (!key || !docContent) return;
    try {
      localStorage.setItem(key, JSON.stringify(highlights));
    } catch { /* ignore */ }
  }, [highlights, fileName, docContent]);

  const addHighlight = useCallback(({ paragraphIndex, startOffset, endOffset, colorObj }) => {
    setHighlights((prev) => [
      ...prev,
      {
        id: ++idCounter.current,
        paragraphIndex,
        startOffset,
        endOffset,
        colorObj,
        note: '',
        createdAt: Date.now(),
      },
    ]);
  }, []);

  const deleteHighlight = useCallback((id) => {
    setHighlights((prev) => prev.filter((h) => h.id !== id));
  }, []);

  const updateNote = useCallback((id, note) => {
    setHighlights((prev) => prev.map((h) => (h.id === id ? { ...h, note } : h)));
  }, []);

  const changeColor = useCallback((id, colorObj) => {
    setHighlights((prev) => prev.map((h) => (h.id === id ? { ...h, colorObj } : h)));
  }, []);

  const highlightsWithNotes = highlights.filter((h) => h.note);

  return (
    <HighlightsContext.Provider
      value={{
        highlights,
        addHighlight,
        deleteHighlight,
        updateNote,
        changeColor,
        highlightsWithNotes,
      }}
    >
      {children}
    </HighlightsContext.Provider>
  );
}

export function useHighlights() {
  const ctx = useContext(HighlightsContext);
  if (!ctx) throw new Error('useHighlights must be used within HighlightsProvider');
  return ctx;
}
