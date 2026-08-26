import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import './App.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

const COLORS = [
  { name: 'Amarillo', bg: 'rgba(250, 204, 21, 0.30)', border: 'rgba(250, 204, 21, 0.55)' },
  { name: 'Azul',     bg: 'rgba(96, 165, 250, 0.30)',  border: 'rgba(96, 165, 250, 0.55)' },
  { name: 'Rojo',     bg: 'rgba(248, 113, 113, 0.30)', border: 'rgba(248, 113, 113, 0.55)' },
  { name: 'Verde',    bg: 'rgba(74, 222, 128, 0.30)',  border: 'rgba(74, 222, 128, 0.55)' },
];

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

async function extractDocument(pdf) {
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push({ items: content.items });
  }

  const allItems = [];
  pages.forEach((p, pi) => {
    p.items.forEach((item) => {
      if (!item.str || !item.str.trim()) return;
      allItems.push({
        str: item.str,
        transform: item.transform,
        fontSize: Math.hypot(item.transform[0], item.transform[1]),
        hasEOL: item.hasEOL,
        page: pi + 1,
      });
    });
  });

  if (!allItems.length) return [];

  allItems.sort((a, b) => {
    const pageDiff = a.page - b.page;
    if (pageDiff !== 0) return pageDiff;
    const yDiff = b.transform[5] - a.transform[5];
    if (Math.abs(yDiff) > 5) return yDiff;
    return a.transform[4] - b.transform[4];
  });

  const fontSizes = allItems.map((i) => i.fontSize);
  const sizeCounts = new Map();
  fontSizes.forEach((s) => {
    const rounded = Math.round(s * 10) / 10;
    sizeCounts.set(rounded, (sizeCounts.get(rounded) || 0) + 1);
  });
  let modalSize = 0;
  let modalCount = 0;
  sizeCounts.forEach((count, size) => {
    if (count > modalCount) {
      modalCount = count;
      modalSize = size;
    }
  });

  const paragraphs = [];
  let currentParagraph = [];
    let currentY = null;

    for (const item of allItems) {
      const y = Math.round(item.transform[5]);

      const sameLine =
        currentY !== null &&
        Math.abs(y - currentY) <= item.fontSize * 0.4;

      if (sameLine) {
        currentParagraph.push(item);
      } else {
        if (currentParagraph.length > 0) {
          paragraphs.push([...currentParagraph]);
        }
        currentParagraph = [item];
        currentY = y;
      }
    }

  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph);
  }

  const structured = [];
  let i = 0;
  while (i < paragraphs.length) {
    const p = paragraphs[i];
    const pFontSize = p[0] ? Math.round(p[0].fontSize * 10) / 10 : modalSize;
    const isHeading = pFontSize > modalSize * 1.18 && p.length <= 12;

    if (isHeading) {
      structured.push({
        text: p.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim(),
        type: 'heading',
        page: p[0]?.page || 1,
      });
      i++;
      continue;
    }

    const paragraphItems = [...p];
    let j = i + 1;
    while (j < paragraphs.length) {
      const nextP = paragraphs[j];
      const nextFontSize = nextP[0] ? Math.round(nextP[0].fontSize * 10) / 10 : modalSize;
      const nextIsHeading = nextFontSize > modalSize * 1.18 && nextP.length <= 12;
      if (nextIsHeading) break;

      const lastItem = paragraphItems[paragraphItems.length - 1];
      const firstItem = nextP[0];
      const lastY = Math.round(lastItem.transform[5]);
      const firstY = Math.round(firstItem.transform[5]);
      const lastFontSize = Math.round(lastItem.fontSize * 10) / 10;
      const firstFontSize = Math.round(firstItem.fontSize * 10) / 10;
      const verticalGap = Math.abs(lastY - firstY);
      const expectedGap = (lastFontSize + firstFontSize) / 2 * 1.1;

      if (
        Math.abs(lastFontSize - firstFontSize) <= 0.5 &&
        verticalGap <= expectedGap &&
        verticalGap > 0
      ) {
        paragraphItems.push(...nextP);
        j++;
      } else {
        break;
      }
    }

    const text = paragraphItems
      .map((item) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text) {
      const isSub = pFontSize < modalSize * 0.97 && paragraphItems.length <= 10;
      structured.push({
        text,
        type: isSub ? 'subheading' : 'paragraph',
        page: paragraphItems[0]?.page || 1,
      });
    }

    i = j;
  }

  return structured;
}

function getSelectionOffsets(containerEl) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);

  if (!containerEl.contains(range.startContainer) || !containerEl.contains(range.endContainer)) {
    return null;
  }

  if (range.startContainer === range.endContainer && range.startOffset === range.endOffset) {
    return null;
  }

  const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT);
  let charIndex = 0;
  let startOffset = null;
  let endOffset = null;

  while (walker.nextNode()) {
    const node = walker.currentNode;
    const nodeLen = node.textContent.length;

    if (node === range.startContainer) {
      startOffset = charIndex + range.startOffset;
    }
    if (node === range.endContainer) {
      endOffset = charIndex + range.endOffset;
    }

    charIndex += nodeLen;

    if (startOffset !== null && endOffset !== null) break;
  }

  if (startOffset === null || endOffset === null) return null;
  if (startOffset === endOffset) return null;

  return { start: startOffset, end: endOffset };
}

function App() {
  const isMobile = useIsMobile();
  const articleRef = useRef(null);

  const [document, setDocument] = useState(null);
  const [highlights, setHighlights] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [editingHighlight, setEditingHighlight] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [fileName, setFileName] = useState('');

  const highlightIdCounter = useRef(0);
  const contextMenuRef = useRef(null);
  const editingHighlightRef = useRef(null);
  const debounceRef = useRef(null);
  const dismissingRef = useRef(false);

  contextMenuRef.current = contextMenu;
  editingHighlightRef.current = editingHighlight;

  const dismissContextMenu = useCallback(() => {
    dismissingRef.current = true;
    setContextMenu(null);
    window.getSelection()?.removeAllRanges();
    setTimeout(() => { dismissingRef.current = false; }, 150);
  }, []);

  useEffect(() => {
    const handleSelectionChange = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        if (dismissingRef.current) return;
        if (contextMenuRef.current) return;
        if (editingHighlightRef.current) return;

        const sel = window.getSelection();
        if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

        const range = sel.getRangeAt(0);
        if (!articleRef.current?.contains(range.startContainer)) return;

        let node = range.startContainer;
        while (node && node !== articleRef.current) {
          if (node.dataset?.idx !== undefined) break;
          node = node.parentNode;
        }
        if (!node || node.dataset?.idx === undefined) return;

        const paragraphIndex = parseInt(node.dataset.idx);
        const offsets = getSelectionOffsets(node);
        if (!offsets || offsets.start === offsets.end) return;

        const rect = range.getBoundingClientRect();
        const preferBelow = rect.top < 140;

        setContextMenu({
          x: rect.left + rect.width / 2,
          y: preferBelow ? rect.bottom + 8 : rect.top - 8,
          preferBelow,
          selectionData: { paragraphIndex, startOffset: offsets.start, endOffset: offsets.end },
        });
      }, 400);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => {
      clearTimeout(debounceRef.current);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = () => {
      dismissingRef.current = true;
      setContextMenu(null);
      window.getSelection()?.removeAllRanges();
      setTimeout(() => { dismissingRef.current = false; }, 150);
    };
    window.addEventListener('scroll', dismiss, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', dismiss, { capture: true });
  }, [contextMenu]);

  const handleAddHighlight = useCallback(
    (colorObj) => {
      if (!contextMenu) return;
      const { paragraphIndex, startOffset, endOffset } = contextMenu.selectionData;
      dismissContextMenu();
      setHighlights((prev) => [
        ...prev,
        {
          id: ++highlightIdCounter.current,
          paragraphIndex,
          startOffset,
          endOffset,
          colorObj,
          note: '',
        },
      ]);
    },
    [contextMenu, dismissContextMenu]
  );

  const handleDeleteHighlight = useCallback(
    (id) => {
      setHighlights((prev) => prev.filter((h) => h.id !== id));
      setEditingHighlight(null);
    },
    []
  );

  const handleUpdateNote = useCallback((id, note) => {
    setHighlights((prev) => prev.map((h) => (h.id === id ? { ...h, note } : h)));
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file || file.type !== 'application/pdf') return;
    setFileName(file.name);
    setIsExtracting(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const doc = await extractDocument(pdf);
      setDocument(doc);
    } catch (err) {
      console.error('Error al extraer texto del PDF:', err);
    } finally {
      setIsExtracting(false);
    }
  }, []);

  const handleFileUpload = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
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
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleReset = useCallback(() => {
    setDocument(null);
    setHighlights([]);
    setContextMenu(null);
    setEditingHighlight(null);
    setFileName('');
    setIsExtracting(false);
    setIsDragging(false);
  }, []);

  const visibleHighlights = useMemo(
    () => highlights.filter((h) => h.paragraphIndex < (document?.length || 0)),
    [highlights, document]
  );

  return (
    <div className="app">
      <header className="header">
        <span className="header-brand">Rollo</span>
        {document && (
          <>
            <span className="header-file">{fileName}</span>
            <button className="header-new" onClick={handleReset}>
              Nuevo
            </button>
          </>
        )}
      </header>

      {!document && !isExtracting && (
        <div className="upload-section">
          <img src="/logo.svg" alt="Rollo" className="app-logo" />
          <h1>Rollo</h1>
          <p className="subtitle">
            Convierte tu PDF en un documento interactivo con subrayados y notas
          </p>

          <label className="upload-button">
            Seleccionar PDF
            <input
              type="file"
              accept="application/pdf"
              onChange={handleFileUpload}
            />
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
      )}

      {isExtracting && (
        <div className="loading">
          <div className="spinner" />
          <p>Extrayendo texto del PDF...</p>
        </div>
      )}

      {document && (
        <main className="document-container">
          <article className="document" ref={articleRef}>
            {document.map((para, idx) => (
              <DocParagraph
                key={idx}
                idx={idx}
                para={para}
                highlights={visibleHighlights.filter((h) => h.paragraphIndex === idx)}
                onHighlightClick={setEditingHighlight}
              />
            ))}
          </article>
        </main>
      )}

      {contextMenu && (
        <>
          <div className="context-menu-backdrop" onClick={dismissContextMenu} />
          <div
            className={`context-menu ${isMobile ? 'context-menu--sheet' : ''}`}
            style={
              isMobile
                ? undefined
                : {
                    position: 'fixed',
                    top: contextMenu.y,
                    left: Math.min(Math.max(12, contextMenu.x - 80), window.innerWidth - 180),
                    transform: contextMenu.preferBelow ? 'none' : 'translateY(-100%)',
                    zIndex: 9999,
                  }
            }
          >
            {COLORS.map((c) => (
              <button
                key={c.name}
                className="color-btn"
                style={{ background: c.bg, borderColor: c.border }}
                title={c.name}
                onClick={() => handleAddHighlight(c)}
              />
            ))}
            <button className="cancel-btn" onClick={dismissContextMenu}>
              Cancelar
            </button>
          </div>
        </>
      )}

      {editingHighlight && (() => {
        const hl = highlights.find((h) => h.id === editingHighlight);
        if (!hl) return null;

        const paraEl = articleRef.current?.querySelector(
          `[data-idx="${hl.paragraphIndex}"]`
        );
        if (!paraEl) return null;

        const rect = paraEl.getBoundingClientRect();
        const scrollTop = window.scrollY || document.documentElement.scrollTop;
        const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

        return (
          <>
            <div
              className="popover-backdrop"
              onClick={() => setEditingHighlight(null)}
            />
            <div
              className="popover"
              style={{
                position: 'absolute',
                top: scrollTop + rect.top + 4,
                left: scrollLeft + Math.min(
                  Math.max(16, rect.left + (rect.width - 300) / 2),
                  window.innerWidth - 320
                ),
              }}
            >
              <div className="popover-header">
                <span
                  className="popover-color-dot"
                  style={{
                    background: hl.colorObj.bg,
                    borderColor: hl.colorObj.border,
                  }}
                />
                <span className="popover-color-name">{hl.colorObj.name}</span>
                <button
                  className="popover-close"
                  onClick={() => setEditingHighlight(null)}
                >
                  &times;
                </button>
              </div>
              <textarea
                className="note-input"
                placeholder="Escribe una nota..."
                value={hl.note}
                onChange={(e) => handleUpdateNote(hl.id, e.target.value)}
              />
              <button
                className="delete-btn"
                onClick={() => handleDeleteHighlight(hl.id)}
              >
                Eliminar
              </button>
            </div>
          </>
        );
      })()}
    </div>
  );
}

const DocParagraph = memo(function DocParagraph({ idx, para, highlights, onHighlightClick }) {
  const text = para.text;

  const segments = useMemo(() => {
    if (!highlights.length) return [{ text, highlight: null }];

    const sorted = [...highlights].sort((a, b) => a.startOffset - b.startOffset);
    const segs = [];
    let lastEnd = 0;

    for (const hl of sorted) {
      const s = Math.max(hl.startOffset, lastEnd);
      const e = Math.min(hl.endOffset, text.length);
      if (s >= e) continue;

      if (s > lastEnd) {
        segs.push({ text: text.slice(lastEnd, s), highlight: null });
      }
      segs.push({ text: text.slice(s, e), highlight: hl });
      lastEnd = e;
    }

    if (lastEnd < text.length) {
      segs.push({ text: text.slice(lastEnd), highlight: null });
    }

    return segs;
  }, [text, highlights]);

  const Tag = para.type === 'heading' || para.type === 'subheading'
    ? para.type === 'heading' ? 'h2' : 'h3'
    : 'p';

  return (
    <Tag
      className={`doc-paragraph ${para.type === 'heading' ? 'doc-heading' : ''} ${
        para.type === 'subheading' ? 'doc-subheading' : ''
      }`}
      data-idx={idx}
    >
      {segments.map((seg, i) =>
        seg.highlight ? (
          <mark
            key={seg.highlight.id}
            className="doc-highlight"
            style={{
              background: seg.highlight.colorObj.bg,
              borderBottomColor: seg.highlight.colorObj.border,
            }}
            onClick={(e) => {
              e.stopPropagation();
              onHighlightClick(seg.highlight.id);
            }}
          >
            {seg.text}
            {seg.highlight.note && (
              <span className="note-indicator" title={seg.highlight.note}>
                ✎
              </span>
            )}
          </mark>
        ) : (
          <span key={`t${i}`}>{seg.text}</span>
        )
      )}
    </Tag>
  );
});

export default App;
