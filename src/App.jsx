import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useDocument } from './context/DocumentContext';
import { useHighlights } from './context/HighlightsContext';
import { useSettings } from './context/SettingsContext';
import { useIsMobile } from './hooks/useIsMobile';
import { getSelectionOffsets, getSelectedParagraphIndex } from './utils/selection';

import Header from './components/Header';
import UploadScreen from './components/UploadScreen';
import LoadingScreen from './components/LoadingScreen';
import ReadingProgress from './components/ReadingProgress';
import Paragraph from './components/Paragraph';
import HighlightMenu from './components/HighlightMenu';
import NoteEditor from './components/NoteEditor';
import TableOfContents from './components/TableOfContents';
import SearchOverlay from './components/SearchOverlay';
import NotesPanel from './components/NotesPanel';
import SettingsPanel from './components/SettingsPanel';
import ToolbarBottom from './components/ToolbarBottom';

import './App.css';

function AppContent() {
  const isMobile = useIsMobile();
  const articleRef = useRef(null);

  const { docContent, fileName, isExtracting, estimatedReadingTime, totalPages, wordCount } = useDocument();
  const { highlights, addHighlight } = useHighlights();
  const { settings } = useSettings();

  // Panel visibility
  const [showToc, setShowToc] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Highlight menu + note editor
  const [menuPosition, setMenuPosition] = useState(null);
  const [selectionData, setSelectionData] = useState(null);
  const [editingHighlightId, setEditingHighlightId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Refs for selection handling
  const debounceRef = useRef(null);
  const dismissingRef = useRef(false);
  const menuRef = useRef(null);
  const editingRef = useRef(null);

  menuRef.current = menuPosition;
  editingRef.current = editingHighlightId;

  // Toggle helpers that close other panels
  const togglePanel = useCallback((panel) => {
    setShowToc(panel === 'toc' ? (v) => !v : false);
    setShowSearch(panel === 'search' ? (v) => !v : false);
    setShowNotes(panel === 'notes' ? (v) => !v : false);
    setShowSettings(panel === 'settings' ? (v) => !v : false);
  }, []);

  // Dismiss highlight menu
  const dismissMenu = useCallback(() => {
    dismissingRef.current = true;
    setMenuPosition(null);
    setSelectionData(null);
    window.getSelection()?.removeAllRanges();
    setTimeout(() => { dismissingRef.current = false; }, 150);
  }, []);

  // Handle text selection → show highlight menu
  useEffect(() => {
    if (!docContent) return;

    const handleSelectionChange = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (dismissingRef.current) return;
        if (menuRef.current) return;
        if (editingRef.current) return;

        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

        const range = sel.getRangeAt(0);
        if (!articleRef.current?.contains(range.startContainer)) return;

        const paragraphIndex = getSelectedParagraphIndex(articleRef.current);
        if (paragraphIndex === null) return;

        const paraEl = articleRef.current.querySelector(`[data-idx="${paragraphIndex}"]`);
        if (!paraEl) return;

        const offsets = getSelectionOffsets(paraEl);
        if (!offsets || offsets.start === offsets.end) return;

        const rect = range.getBoundingClientRect();
        const preferBelow = rect.top < 140;

        setSelectionData({ paragraphIndex, startOffset: offsets.start, endOffset: offsets.end });
        setMenuPosition({
          x: rect.left + rect.width / 2,
          y: preferBelow ? rect.bottom + 8 : rect.top - 8,
          preferBelow,
        });
      }, 350);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      clearTimeout(debounceRef.current);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [docContent]);

  // Dismiss menu on scroll
  useEffect(() => {
    if (!menuPosition) return;
    const dismiss = () => {
      dismissingRef.current = true;
      setMenuPosition(null);
      setSelectionData(null);
      window.getSelection()?.removeAllRanges();
      setTimeout(() => { dismissingRef.current = false; }, 150);
    };
    window.addEventListener('scroll', dismiss, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', dismiss, { capture: true });
  }, [menuPosition]);

  // Handle highlight creation
  const handleSelectColor = useCallback(
    (colorObj) => {
      if (!selectionData) return;
      addHighlight({
        paragraphIndex: selectionData.paragraphIndex,
        startOffset: selectionData.startOffset,
        endOffset: selectionData.endOffset,
        colorObj,
      });
      dismissMenu();
    },
    [selectionData, addHighlight, dismissMenu]
  );

  // Memoize filtered highlights per paragraph
  const visibleHighlights = useMemo(
    () => highlights.filter((h) => h.paragraphIndex < (docContent?.length || 0)),
    [highlights, docContent]
  );

  // Dynamic reading styles
  const readingStyles = useMemo(
    () => ({
      fontSize: `${settings.fontSize}px`,
      lineHeight: settings.lineHeight,
      textAlign: settings.textAlign,
    }),
    [settings.fontSize, settings.lineHeight, settings.textAlign]
  );

  const headingStyles = useMemo(
    () => ({
      fontSize: `${Math.round(settings.fontSize * 1.4)}px`,
      lineHeight: 1.3,
    }),
    [settings.fontSize]
  );

  const subheadingStyles = useMemo(
    () => ({
      fontSize: `${Math.round(settings.fontSize * 1.15)}px`,
      lineHeight: 1.4,
    }),
    [settings.fontSize]
  );

  return (
    <div className="app">
      <ReadingProgress />

      <Header
        onToggleToc={() => togglePanel('toc')}
        onToggleSearch={() => togglePanel('search')}
        onToggleNotes={() => togglePanel('notes')}
        onToggleSettings={() => togglePanel('settings')}
        showToc={showToc}
        showSearch={showSearch}
        showNotes={showNotes}
        showSettings={showSettings}
      />

      {!docContent && !isExtracting && <UploadScreen />}

      {isExtracting && <LoadingScreen />}

      {docContent && (
        <>
          {showSearch && (
            <SearchOverlay onClose={() => setShowSearch(false)} />
          )}

          <div className="doc-info-bar">
            <span>📄 {totalPages} páginas</span>
            <span>📝 {wordCount.toLocaleString()} palabras</span>
            <span>⏱ ~{estimatedReadingTime} min</span>
          </div>

          <main className="document-container">
            <article className="document" ref={articleRef}>
              {docContent.map((para, idx) => {
                const paraHighlights = visibleHighlights.filter(
                  (h) => h.paragraphIndex === idx
                );
                const style =
                  para.type === 'heading'
                    ? headingStyles
                    : para.type === 'subheading'
                      ? subheadingStyles
                      : readingStyles;

                return (
                  <div key={idx} style={style}>
                    <Paragraph
                      idx={idx}
                      para={para}
                      highlights={paraHighlights}
                      searchQuery={searchQuery}
                      isSearchActive={false}
                      onHighlightClick={setEditingHighlightId}
                    />
                  </div>
                );
              })}
            </article>
          </main>

          {/* Mobile bottom toolbar */}
          <ToolbarBottom
            onToggleToc={() => togglePanel('toc')}
            onToggleSearch={() => togglePanel('search')}
            onToggleNotes={() => togglePanel('notes')}
            onToggleSettings={() => togglePanel('settings')}
          />
        </>
      )}

      {/* Highlight color menu */}
      <HighlightMenu
        position={menuPosition}
        onSelectColor={handleSelectColor}
        onDismiss={dismissMenu}
      />

      {/* Note editor popover */}
      {editingHighlightId && (
        <NoteEditor
          highlightId={editingHighlightId}
          articleRef={articleRef}
          docContent={docContent}
          onClose={() => setEditingHighlightId(null)}
        />
      )}

      {/* Panels */}
      {showToc && <TableOfContents onClose={() => setShowToc(false)} />}
      {showNotes && (
        <NotesPanel
          onClose={() => setShowNotes(false)}
          onEditHighlight={setEditingHighlightId}
        />
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  );
}

export default AppContent;
