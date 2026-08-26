import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// --- POLYFILLS FOR OLDER IOS/SAFARI ---
if (!Map.prototype.getOrInsertComputed) {
  Map.prototype.getOrInsertComputed = function(key, callback) {
    if (this.has(key)) return this.get(key);
    const value = callback(key);
    this.set(key, value);
    return value;
  };
}
if (!Promise.withResolvers) {
  Promise.withResolvers = function() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  };
}
// --------------------------------------

import './App.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = `${import.meta.env.BASE_URL}pdf.worker.min.mjs`;

const COLORS = [
  { id: 'yellow', label: 'Amarillo', css: 'rgba(255, 255, 0, 0.35)', solid: 'rgba(255, 255, 0, 0.8)' },
  { id: 'green', label: 'Verde', css: 'rgba(0, 255, 0, 0.35)', solid: 'rgba(0, 255, 0, 0.8)' },
  { id: 'pink', label: 'Rosa', css: 'rgba(255, 105, 180, 0.35)', solid: 'rgba(255, 105, 180, 0.8)' },
  { id: 'blue', label: 'Azul', css: 'rgba(0, 180, 255, 0.35)', solid: 'rgba(0, 180, 255, 0.8)' },
];

// ===================== TEXT EXTRACTION =====================

async function extractDocument(pdf) {
  const allParagraphs = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    const items = content.items
      .filter(item => item.str.trim())
      .map(item => {
        const tx = item.transform;
        const fontHeight = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]);
        return {
          str: item.str,
          x: tx[4],
          y: tx[5],
          fontHeight,
          fontName: item.fontName || '',
        };
      });

    if (!items.length) continue;

    items.sort((a, b) => {
      if (Math.abs(a.y - b.y) > 3) return b.y - a.y;
      return a.x - b.x;
    });

    const lines = [];
    let line = [items[0]];
    for (let i = 1; i < items.length; i++) {
      const item = items[i];
      if (Math.abs(item.y - line[0].y) < line[0].fontHeight * 0.4) {
        line.push(item);
      } else {
        lines.push(line);
        line = [item];
      }
    }
    lines.push(line);

    lines.forEach(l => l.sort((a, b) => a.x - b.x));

    let cur = {
      text: lines[0].map(i => i.str).join(' '),
      fontSize: lines[0][0].fontHeight,
      isBold: lines[0].some(i => /bold/i.test(i.fontName)),
      x: lines[0][0].x,
      pageNum,
    };

    for (let i = 1; i < lines.length; i++) {
      const l = lines[i];
      const text = l.map(i => i.str).join(' ');
      const fontSize = l[0].fontHeight;
      const isBold = l.some(i => /bold/i.test(i.fontName));
      const x = l[0].x;
      const prevLine = lines[i - 1];
      const gap = prevLine[0].y - l[0].y;

      const sizeChanged = Math.abs(fontSize - cur.fontSize) > cur.fontSize * 0.15;
      const indentChanged = Math.abs(x - cur.x) > cur.fontSize * 0.5;
      const largeGap = gap > cur.fontSize * 2;

      if (sizeChanged || indentChanged || largeGap) {
        allParagraphs.push({ ...cur });
        cur = { text, fontSize, isBold, x, pageNum };
      } else {
        cur.text += ' ' + text;
      }
    }
    allParagraphs.push({ ...cur });
  }

  if (!allParagraphs.length) return [];

  const counts = {};
  allParagraphs.forEach(p => {
    const s = Math.round(p.fontSize);
    counts[s] = (counts[s] || 0) + p.text.length;
  });
  const modalSize = parseInt(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);

  return allParagraphs
    .filter(p => p.text.trim().length > 0)
    .map(p => {
      const ratio = p.fontSize / modalSize;
      let type = 'body';
      if (ratio > 1.6) type = 'title';
      else if (ratio > 1.3) type = 'heading';
      else if (ratio > 1.08 && p.isBold) type = 'subheading';
      else if (p.isBold && p.text.length < 80 && p.text.length > 3) type = 'subheading';
      return { type, text: p.text.trim(), pageNumber: p.pageNum };
    });
}

// ===================== SELECTION UTILITIES =====================

function getSelectionOffsets(containerEl) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);
  if (!containerEl.contains(range.startContainer) || !containerEl.contains(range.endContainer)) return null;

  function offset(node, off) {
    const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT);
    let total = 0;
    while (walker.nextNode()) {
      if (walker.currentNode === node) return total + off;
      total += walker.currentNode.textContent.length;
    }
    return total;
  }

  const start = offset(range.startContainer, range.startOffset);
  const end = offset(range.endContainer, range.endOffset);
  return start < end ? { start, end } : { start: end, end: start };
}

// ===================== APP =====================

function App() {
  const [document, setDocument] = useState(null);
  const [highlights, setHighlights] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [editingHighlight, setEditingHighlight] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [fileName, setFileName] = useState('');
  const highlightIdCounter = useRef(0);

  const processFile = useCallback(async (file) => {
    if (!file || file.type !== 'application/pdf') return;
    setFileName(file.name.replace(/\.pdf$/i, ''));
    setIsExtracting(true);
    try {
      const buf = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({
        data: buf,
        cMapUrl: `${import.meta.env.BASE_URL}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${import.meta.env.BASE_URL}standard_fonts/`,
      }).promise;
      const doc = await extractDocument(pdf);
      setDocument(doc);
      setHighlights([]);
    } catch (e) {
      console.error('Error extracting text:', e);
    }
    setIsExtracting(false);
  }, []);

  const handleAddHighlight = useCallback((colorObj) => {
    if (!contextMenu) return;
    const { paragraphIndex, startOffset, endOffset } = contextMenu.selectionData;

    setHighlights(prev => {
      const filtered = prev.filter(h => {
        if (h.paragraphIndex !== paragraphIndex) return true;
        return h.endOffset <= startOffset || h.startOffset >= endOffset;
      });
      return [...filtered, {
        id: `hl-${++highlightIdCounter.current}`,
        paragraphIndex, startOffset, endOffset,
        colorObj, note: '',
      }];
    });
    setContextMenu(null);
    window.getSelection()?.removeAllRanges();
  }, [contextMenu]);

  const handleDeleteHighlight = useCallback((id) => {
    setHighlights(prev => prev.filter(h => h.id !== id));
    setEditingHighlight(null);
  }, []);

  const handleUpdateNote = useCallback((id, note) => {
    setHighlights(prev => prev.map(h => h.id === id ? { ...h, note } : h));
  }, []);

  const handleFileUpload = (e) => processFile(e.target.files[0]);

  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) processFile(e.dataTransfer.files[0]);
  }, [processFile]);

  const highlightsByParagraph = useMemo(() => {
    const map = new Map();
    highlights.forEach(h => {
      if (!map.has(h.paragraphIndex)) map.set(h.paragraphIndex, []);
      map.get(h.paragraphIndex).push(h);
    });
    return map;
  }, [highlights]);

  const dismissContextMenu = useCallback(() => {
    setContextMenu(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  return (
    <div className="app">
      {!document && !isExtracting && (
        <div className="upload-section">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Rollo" className="app-logo" />
          <h1>Rollo</h1>
          <p className="subtitle">Convierte tu PDF en un documento interactivo con subrayados y notas</p>
          <div
            className={`dropzone ${isDragging ? 'dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="dropzone-content">
              <svg className="upload-icon" viewBox="0 0 24 24" fill="none">
                <path d="M7 16L12 11M12 11L17 16M12 11V21M20 16.7428C21.2215 15.734 22 14.2079 22 12.5C22 9.46243 19.5376 7 16.5 7C16.2815 7 16.0771 7.0128 15.8803 7.03752C15.4093 4.18431 12.9492 2 10 2C6.13401 2 3 5.13401 3 9C3 9.48915 3.05041 9.96656 3.14488 10.4284C1.94218 11.233 1.125 12.6397 1.125 14.25C1.125 16.8734 3.25165 19 5.875 19H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <h3>Arrastra y suelta tu PDF aquí</h3>
              <p>o</p>
              <label className="upload-button">
                Explorar Archivos
                <input type="file" accept="application/pdf" onChange={handleFileUpload} />
              </label>
            </div>
          </div>
        </div>
      )}

      {isExtracting && (
        <div className="loading">
          <div className="spinner" />
          <p>Extrayendo texto de <strong>{fileName}</strong>...</p>
        </div>
      )}

      {document && (
        <>
          <header className="doc-header">
            <div className="doc-header-inner">
              <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Rollo" className="doc-logo" />
              <span className="doc-title-text">{fileName}</span>
              <button className="new-doc-btn" onClick={() => { setDocument(null); setHighlights([]); setFileName(''); }}>
                Nuevo
              </button>
            </div>
          </header>
          <main className="document-container">
            <article className="document">
              {document.length === 0 && (
                <p className="doc-empty">No se pudo extraer texto de este PDF. Puede ser un documento escaneado.</p>
              )}
              {document.map((para, i) => (
                <DocParagraph
                  key={i}
                  index={i}
                  text={para.text}
                  type={para.type}
                  highlights={highlightsByParagraph.get(i) || []}
                  setContextMenu={setContextMenu}
                  setEditingHighlight={setEditingHighlight}
                />
              ))}
            </article>
          </main>
        </>
      )}

      {contextMenu && (
        <div
          className="context-menu"
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: Math.min(Math.max(12, contextMenu.x), window.innerWidth - 180),
            transform: contextMenu.preferBelow ? 'none' : 'translateY(-100%)',
            zIndex: 9999,
          }}
        >
          <div className="context-menu-title">Subrayar</div>
          <div className="context-menu-colors">
            {COLORS.map(c => (
              <button
                key={c.id}
                title={c.label}
                className="color-btn"
                style={{ background: c.solid }}
                onClick={() => handleAddHighlight(c)}
              />
            ))}
          </div>
          <button className="context-menu-cancel" onClick={dismissContextMenu}>Cancelar</button>
        </div>
      )}

      {editingHighlight && (() => {
        const hl = highlights.find(h => h.id === editingHighlight);
        if (!hl) return null;
        return (
          <div className="popover-overlay" onClick={() => setEditingHighlight(null)}>
            <div className="popover" onClick={e => e.stopPropagation()}>
              <div className="popover-header">
                <span className="popover-dot" style={{ background: hl.colorObj.solid }} />
                <span>Subrayado</span>
                <button className="popover-delete" onClick={() => handleDeleteHighlight(hl.id)} title="Eliminar">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
              <textarea
                className="popover-textarea"
                rows="3"
                value={hl.note}
                onChange={e => handleUpdateNote(hl.id, e.target.value)}
                placeholder="Añadir comentario..."
                autoFocus
              />
              <div className="popover-actions">
                <button className="popover-done" onClick={() => setEditingHighlight(null)}>Listo</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ===================== DOCUMENT PARAGRAPH =====================

const DocParagraph = memo(function DocParagraph({ index, text, type, highlights, setContextMenu, setEditingHighlight }) {
  const ref = useRef(null);
  const touchTimer = useRef(null);

  useEffect(() => {
    return () => { if (touchTimer.current) clearTimeout(touchTimer.current); };
  }, []);

  const showContextMenu = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

    const range = sel.getRangeAt(0);
    if (!ref.current?.contains(range.startContainer)) return;

    const offsets = getSelectionOffsets(ref.current);
    if (!offsets || offsets.start === offsets.end) return;

    const rect = range.getBoundingClientRect();
    const preferBelow = rect.top < 120;

    setContextMenu({
      x: rect.left + rect.width / 2,
      y: preferBelow ? rect.bottom + 8 : rect.top - 8,
      preferBelow,
      selectionData: { paragraphIndex: index, startOffset: offsets.start, endOffset: offsets.end },
    });
  }, [index, setContextMenu]);

  const handleMouseUp = useCallback((e) => {
    if (e.target.closest('.doc-highlight')) return;
    showContextMenu();
  }, [showContextMenu]);

  const handleTouchEnd = useCallback(() => {
    if (touchTimer.current) clearTimeout(touchTimer.current);
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
    touchTimer.current = setTimeout(() => {
      touchTimer.current = null;
      showContextMenu();
    }, isIOS ? 300 : 50);
  }, [showContextMenu]);

  const segments = useMemo(() => {
    if (!highlights.length) return [{ type: 'text', content: text }];

    const sorted = [...highlights].sort((a, b) => a.startOffset - b.startOffset);
    const segs = [];
    let lastEnd = 0;

    for (const hl of sorted) {
      if (hl.startOffset > lastEnd) {
        segs.push({ type: 'text', content: text.slice(lastEnd, hl.startOffset) });
      }
      segs.push({ type: 'mark', content: text.slice(hl.startOffset, hl.endOffset), highlight: hl });
      lastEnd = hl.endOffset;
    }

    if (lastEnd < text.length) {
      segs.push({ type: 'text', content: text.slice(lastEnd) });
    }

    return segs;
  }, [text, highlights]);

  return (
    <div
      ref={ref}
      data-idx={index}
      className={`doc-paragraph ${type}`}
      onMouseUp={handleMouseUp}
      onTouchEnd={handleTouchEnd}
    >
      {segments.map((seg, i) => {
        if (seg.type === 'mark') {
          return (
            <mark
              key={i}
              className="doc-highlight"
              style={{ backgroundColor: seg.highlight.colorObj.css }}
              onClick={(e) => { e.stopPropagation(); setEditingHighlight(seg.highlight.id); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setEditingHighlight(seg.highlight.id);
                }
              }}
            >
              {seg.content}
            </mark>
          );
        }
        return <span key={i}>{seg.content}</span>;
      })}
    </div>
  );
});

export default App;
