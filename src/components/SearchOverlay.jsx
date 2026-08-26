import { useState, useCallback, useEffect, useRef } from 'react';
import { useDocument } from '../context/DocumentContext';

export default function SearchOverlay({ onClose }) {
  const { docContent } = useDocument();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState([]);
  const [currentMatch, setCurrentMatch] = useState(-1);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim() || !docContent) {
      setMatches([]);
      setCurrentMatch(-1);
      // Clear all search highlights
      document.querySelectorAll('.search-match, .search-active').forEach((el) => {
        el.classList.remove('search-match', 'search-active');
      });
      return;
    }

    const q = query.toLowerCase();
    const found = [];
    docContent.forEach((para, idx) => {
      if (para.text.toLowerCase().includes(q)) {
        found.push(idx);
      }
    });

    setMatches(found);
    setCurrentMatch(found.length > 0 ? 0 : -1);

    // Apply search-match class
    document.querySelectorAll('.search-match, .search-active').forEach((el) => {
      el.classList.remove('search-match', 'search-active');
    });
    found.forEach((idx) => {
      const el = document.querySelector(`[data-idx="${idx}"]`);
      if (el) el.classList.add('search-match');
    });

    // Scroll to first match
    if (found.length > 0) {
      const el = document.querySelector(`[data-idx="${found[0]}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('search-active');
      }
    }
  }, [query, docContent]);

  const navigateMatch = useCallback(
    (direction) => {
      if (!matches.length) return;

      // Remove previous active
      document.querySelectorAll('.search-active').forEach((el) => {
        el.classList.remove('search-active');
      });

      const newIdx =
        direction === 'next'
          ? (currentMatch + 1) % matches.length
          : (currentMatch - 1 + matches.length) % matches.length;

      setCurrentMatch(newIdx);

      const el = document.querySelector(`[data-idx="${matches[newIdx]}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('search-active');
      }
    },
    [matches, currentMatch]
  );

  const handleClose = useCallback(() => {
    document.querySelectorAll('.search-match, .search-active').forEach((el) => {
      el.classList.remove('search-match', 'search-active');
    });
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        navigateMatch(e.shiftKey ? 'prev' : 'next');
      }
    },
    [handleClose, navigateMatch]
  );

  return (
    <div className="search-overlay">
      <input
        ref={inputRef}
        className="search-input"
        type="text"
        placeholder="Buscar en el documento..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      {matches.length > 0 && (
        <span className="search-info">
          {currentMatch + 1}/{matches.length}
        </span>
      )}
      <button
        className="search-nav-btn"
        onClick={() => navigateMatch('prev')}
        disabled={!matches.length}
        aria-label="Resultado anterior"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m18 15-6-6-6 6" />
        </svg>
      </button>
      <button
        className="search-nav-btn"
        onClick={() => navigateMatch('next')}
        disabled={!matches.length}
        aria-label="Siguiente resultado"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <button className="search-close-btn" onClick={handleClose} aria-label="Cerrar búsqueda">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
