import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// --- POLYFILLS FOR OLDER IOS/SAFARI ---
if (!Map.prototype.getOrInsertComputed) {
  Map.prototype.getOrInsertComputed = function(key, callback) {
    if (this.has(key)) {
      return this.get(key);
    }
    const value = callback(key);
    this.set(key, value);
    return value;
  };
}

if (!Promise.withResolvers) {
  Promise.withResolvers = function() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}
// --------------------------------------

import { PDFDocument, rgb } from 'pdf-lib';
import './App.css';

// Set up the worker for pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const COLORS = [
  { id: 'yellow', label: 'Amarillo', css: 'rgba(255, 255, 0, 0.35)', pdf: rgb(1, 1, 0) },
  { id: 'green', label: 'Verde', css: 'rgba(0, 255, 0, 0.35)', pdf: rgb(0, 1, 0) },
  { id: 'pink', label: 'Rosa', css: 'rgba(255, 105, 180, 0.35)', pdf: rgb(1, 0.4, 0.7) },
  { id: 'blue', label: 'Azul', css: 'rgba(0, 180, 255, 0.35)', pdf: rgb(0, 0.7, 1) },
];

function App() {
  const [pdf, setPdf] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [rawPdfBuffer, setRawPdfBuffer] = useState(null);
  const [isConverting, setIsConverting] = useState(false);
  const [highlights, setHighlights] = useState([]);
  const [contextMenu, setContextMenu] = useState(null);
  const [noteModal, setNoteModal] = useState(null);
  const noteInputRef = useRef(null);

  const processFile = useCallback(async (file) => {
    if (!file || file.type !== 'application/pdf') return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      setRawPdfBuffer(arrayBuffer.slice(0));
      const loadedPdf = await pdfjsLib.getDocument({ 
        data: arrayBuffer,
        cMapUrl: `/cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `/standard_fonts/`
      }).promise;
      setPdf(loadedPdf);
      setNumPages(loadedPdf.numPages);
    } catch (error) {
      console.error("Error loading PDF:", error);
    }
  }, []);

  const handleDownload = async () => {
    if (!rawPdfBuffer) return;
    setIsConverting(true);
    try {
      const srcDoc = await PDFDocument.load(rawPdfBuffer);
      const pages = srcDoc.getPages();
      const newPdf = await PDFDocument.create();

      let totalHeight = 0;
      let maxWidth = 0;
      
      const pagesData = [];

      // Pass 1: Find crop bounds for each page (using same scale as web view)
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const pdfjsPage = await pdf.getPage(i + 1);
        
        // Use the same scale as the web rendering so findContentChunks
        // behaves identically (GAP_THRESHOLD is calibrated for scale 2.0)
        // Detect mobile: use lower scale to avoid iOS canvas memory limits
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
        let renderScale = isMobile ? 1.5 : 2.0;
        let renderViewport = pdfjsPage.getViewport({ scale: renderScale });
        
        // Hard cap canvas size to 3MP on mobile to prevent silent crash
        const MAX_AREA = isMobile ? 3000000 : 10000000;
        if (renderViewport.width * renderViewport.height > MAX_AREA) {
          renderScale = Math.sqrt(MAX_AREA / (renderViewport.width * renderViewport.height / (renderScale * renderScale)));
          renderViewport = pdfjsPage.getViewport({ scale: renderScale });
        }

        const renderCanvas = document.createElement('canvas');
        const renderContext = renderCanvas.getContext('2d');
        renderCanvas.width = renderViewport.width;
        renderCanvas.height = renderViewport.height;
        renderContext.fillStyle = 'white';
        renderContext.fillRect(0, 0, renderCanvas.width, renderCanvas.height);
        await pdfjsPage.render({ canvasContext: renderContext, viewport: renderViewport }).promise;
        const chunks = findContentChunks(renderCanvas, renderScale);
        
        for (const chunk of chunks) {
          // chunk coordinates are in renderScale pixel space, convert to PDF space
          const pdfTop = chunk.start / renderScale;
          const pdfBottom = chunk.end / renderScale;
          const cropHeight = pdfBottom - pdfTop;
          
          // pdf-lib uses bottom-left origin; pdfTop/pdfBottom are from top
          const cropBox = p.getCropBox();
          const bbox = {
            left: cropBox.x,
            bottom: cropBox.y + cropBox.height - pdfBottom,
            right: cropBox.x + cropBox.width,
            top: cropBox.y + cropBox.height - pdfTop
          };
          
          const ep = await newPdf.embedPage(p, bbox);
          
          pagesData.push({
            ep: ep,
            cropHeight: cropHeight,
            pdfTop: pdfTop,
            pdfBottom: pdfBottom,
            width: p.getWidth(),
            pageIndex: i
          });
          
          totalHeight += cropHeight;
          maxWidth = Math.max(maxWidth, p.getWidth());
        }
        renderCanvas.width = 0;
        renderCanvas.height = 0;
        pdfjsPage.cleanup();
      }

      // Pass 2: Draw on the giant page
      const giantPage = newPdf.addPage([maxWidth, totalHeight]);
      let currentY = totalHeight;

      for (let i = 0; i < pagesData.length; i++) {
        const data = pagesData[i];
        currentY -= data.cropHeight;
        
        giantPage.drawPage(data.ep, {
          x: 0,
          y: currentY,
          width: data.width,
          height: data.cropHeight,
        });

        // Draw highlights for this page
        const pageHighlights = highlights.filter(h => h.pageIndex === data.pageIndex);
        pageHighlights.forEach(hl => {
          hl.rects.forEach(rect => {
            // Check if the highlight belongs to this chunk
            if (rect.y >= data.pdfTop && rect.y <= data.pdfBottom) {
              const highlightYFromCropTop = rect.y - data.pdfTop;
              const finalY = currentY + data.cropHeight - highlightYFromCropTop - rect.height;
              giantPage.drawRectangle({
                x: rect.x,
                y: finalY,
                width: rect.width,
                height: rect.height,
                color: hl.colorObj.pdf,
                opacity: 0.4,
              });
            }
          });
          if (hl.note) {
            const firstRect = hl.rects[0];
            if (firstRect.y >= data.pdfTop && firstRect.y <= data.pdfBottom) {
              const highlightYFromCropTop = firstRect.y - data.pdfTop;
              const finalY = currentY + data.cropHeight - highlightYFromCropTop;
              giantPage.drawText(`[${hl.note}]`, {
                x: firstRect.x,
                y: finalY + 2,
                size: 8,
                color: rgb(0.8, 0, 0),
              });
            }
          }
        });
      }

      const pdfBytes = await newPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'documento_rollo.pdf';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Error converting PDF:", e);
    }
    setIsConverting(false);
  };

  const handleFileUpload = (event) => {
    processFile(event.target.files[0]);
  };

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleAddHighlight = (colorObj) => {
    if (!contextMenu) return;
    const { selectionData } = contextMenu;
    const newId = Date.now().toString();
    
    setHighlights(prev => {
      const filteredPrev = prev.filter(hl => {
        if (hl.pageIndex !== selectionData.pageIndex) return true;
        for (const oldR of hl.rects) {
          for (const newR of selectionData.rects) {
            const intersect = (
              newR.x < oldR.x + oldR.width - 2 && 
              newR.x + newR.width > oldR.x + 2 && 
              newR.y < oldR.y + oldR.height - 2 && 
              newR.y + newR.height > oldR.y + 2
            );
            if (intersect) return false;
          }
        }
        return true;
      });

      return [...filteredPrev, {
        id: newId,
        pageIndex: selectionData.pageIndex,
        rects: selectionData.rects,
        colorObj: colorObj,
        note: ''
      }];
    });
    setContextMenu(null);
    window.getSelection().removeAllRanges();
  };

  const handleAddNote = (id, noteText) => {
    setHighlights(prev => prev.map(hl => hl.id === id ? { ...hl, note: noteText } : hl));
    setNoteModal(null);
  };

  const highlightsByPage = useMemo(() => {
    const map = new Map();
    highlights.forEach(h => {
      if (!map.has(h.pageIndex)) map.set(h.pageIndex, []);
      map.get(h.pageIndex).push(h);
    });
    return map;
  }, [highlights]);

  return (
    <div className="webtoon-container">
      {!pdf && (
        <div className="upload-section">
          <img src="/logo.svg" alt="Rollo Logo" className="app-logo" />
          <h1>Rollo</h1>
          <p className="subtitle">Disfruta de la lectura vertical continua</p>
          <div 
            className={`dropzone ${isDragging ? 'dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="dropzone-content">
              <svg className="upload-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
      {pdf && (
        <div className="pdf-viewer-container">
          <div className="floating-actions">
            <button 
              className="download-button" 
              onClick={handleDownload} 
              disabled={isConverting}
            >
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 15V3M12 15L8 11M12 15L16 11M2 17L2.621 19.485C2.72915 19.9177 2.97882 20.3018 3.33033 20.5763C3.68184 20.8508 4.11501 20.9999 4.561 21H19.439C19.885 20.9999 20.3182 20.8508 20.6697 20.5763C21.0212 20.3018 21.2708 19.9177 21.379 19.485L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {isConverting ? 'Convirtiendo...' : 'Descargar PDF'}
            </button>
          </div>
          <div className="pdf-viewer">
            {Array.from(new Array(numPages), (el, index) => (
              <PdfPage 
                key={`page_${index + 1}`} 
                pdf={pdf} 
                pageNumber={index + 1}
                highlights={highlightsByPage.get(index) || []}
                setContextMenu={setContextMenu}
                onNoteClick={setNoteModal}
              />
            ))}
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div className="context-menu" style={{ position: 'fixed', top: contextMenu.y, left: contextMenu.x, zIndex: 9999 }}>
          <div className="context-menu-title">Subrayar</div>
          <div className="context-menu-colors">
            {COLORS.map(c => (
              <button
                key={c.id}
                title={c.label}
                onClick={() => handleAddHighlight(c)}
                className="color-btn"
                style={{ background: c.css.replace('0.35', '0.8') }}
              />
            ))}
          </div>
          <button className="context-menu-cancel" onClick={() => { setContextMenu(null); window.getSelection().removeAllRanges(); }}>Cancelar</button>
        </div>
      )}

      {/* Note Modal */}
      {noteModal && (
        <div className="note-modal-overlay">
          <div className="note-modal">
            <h3>Añadir Nota</h3>
            <textarea
              ref={noteInputRef}
              id="note-input"
              rows="4"
              defaultValue={highlights.find(h => h.id === noteModal)?.note || ''}
              placeholder="Escribe tu nota aquí..."
            />
            <div className="note-modal-actions">
              <button className="note-cancel" onClick={() => setNoteModal(null)}>Cancelar</button>
              <button className="note-save" onClick={() => handleAddNote(noteModal, noteInputRef.current.value)}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function findContentChunks(canvas, renderScale = 2.0) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height).data;
  
  const isWhite = (r, g, b, a) => (r > 245 && g > 245 && b > 245) || a === 0;
  
  const rowHasContent = new Array(height).fill(false);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (!isWhite(imageData[index], imageData[index+1], imageData[index+2], imageData[index+3])) {
        rowHasContent[y] = true;
        break;
      }
    }
  }
  
  const chunks = [];
  let inChunk = false;
  let chunkStart = 0;
  let emptyCount = 0;
  // Make gap threshold relative to render scale (50px at scale 2.0 -> 25px per scale unit)
  const GAP_THRESHOLD = Math.max(10, Math.floor(25 * renderScale)); 
  
  for (let y = 0; y < height; y++) {
    if (rowHasContent[y]) {
      if (!inChunk) {
        inChunk = true;
        chunkStart = y;
      }
      emptyCount = 0;
    } else {
      if (inChunk) {
        emptyCount++;
        if (emptyCount >= GAP_THRESHOLD) {
          chunks.push({ 
            start: Math.max(0, chunkStart - 10), 
            end: Math.min(height, y - emptyCount + 10),
            height: (Math.min(height, y - emptyCount + 10)) - (Math.max(0, chunkStart - 10))
          });
          inChunk = false;
        }
      }
    }
  }
  if (inChunk) {
    chunks.push({ 
      start: Math.max(0, chunkStart - 10), 
      end: height - 1,
      height: (height - 1) - Math.max(0, chunkStart - 10)
    });
  }

  const validChunks = chunks.filter((chunk, idx) => {
    if (idx === 0 && chunk.end < height * 0.15 && chunk.height < height * 0.1) return false;
    if (idx === chunks.length - 1 && chunk.start > height * 0.85 && chunk.height < height * 0.1) return false;
    return true;
  });

  return validChunks.length > 0 ? validChunks : chunks;
}

const PdfPage = memo(function PdfPage({ pdf, pageNumber, highlights, setContextMenu, onNoteClick }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [currentScale, setCurrentScale] = useState(1);
  const [activeNote, setActiveNote] = useState(null);
  const [chunksInfo, setChunksInfo] = useState({ chunks: [], totalHeight: 0, width: 0 });
  const pressTimer = useRef(null);
  const [isNearViewport, setIsNearViewport] = useState(false);
  const renderScaleRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current);
    };
  }, []);

  // Lazy loading: only render when near the viewport
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsNearViewport(true);
          observer.disconnect(); // Once triggered, no need to observe anymore
        }
      },
      { rootMargin: '200px' } // Start rendering when within 200px of viewport
    );
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isNearViewport) return; // Don't render until near viewport

    let renderTask;
    let isMounted = true;
    let resizeObserver;
    let loadedPage = null;

    const renderPage = async () => {
      try {
        loadedPage = await pdf.getPage(pageNumber);
        const page = loadedPage;
        if (!isMounted) return;

        // Detect mobile: use lower scale to avoid iOS canvas memory limits
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
        let renderScale = isMobile ? 1.5 : 2.0;
        let viewport = page.getViewport({ scale: renderScale });

        // Hard cap canvas size to 3MP on mobile to prevent silent crash
        const MAX_AREA = isMobile ? 3000000 : 10000000;
        if (viewport.width * viewport.height > MAX_AREA) {
          renderScale = Math.sqrt(MAX_AREA / (viewport.width * viewport.height / (renderScale * renderScale)));
          viewport = page.getViewport({ scale: renderScale });
        }

        renderScaleRef.current = renderScale;

        const hiddenCanvas = document.createElement('canvas');
        hiddenCanvas.width = viewport.width;
        hiddenCanvas.height = viewport.height;
        const hiddenContext = hiddenCanvas.getContext('2d');
        hiddenContext.fillStyle = 'white';
        hiddenContext.fillRect(0, 0, hiddenCanvas.width, hiddenCanvas.height);

        const renderContext = {
          canvasContext: hiddenContext,
          viewport: viewport,
        };
        renderTask = page.render(renderContext);
        await renderTask.promise;
        
        if (!isMounted) return;

        const chunks = findContentChunks(hiddenCanvas, renderScale);
        
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        
        const totalHeight = chunks.reduce((sum, c) => sum + c.height, 0);
        canvas.width = viewport.width;
        canvas.height = totalHeight;
        
        let currentY = 0;
        chunks.forEach(c => {
          context.drawImage(hiddenCanvas, 0, c.start, viewport.width, c.height, 0, currentY, viewport.width, c.height);
          c.newY = currentY;
          currentY += c.height;
        });

        setChunksInfo({ chunks, totalHeight, width: viewport.width, renderScale });
        const textContent = await page.getTextContent();

        // 2. Render Text Layer for highlighting
        const textLayerDiv = textLayerRef.current;
        textLayerDiv.innerHTML = '';
        
        textContent.items.forEach(item => {
          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
          const fontAscent = fontHeight;
          const originalTop = tx[5] - fontAscent;
          let mappedTop = -9999;
          
          for (const c of chunks) {
            if (originalTop + (fontHeight/2) >= c.start && originalTop <= c.end) {
              mappedTop = c.newY + (originalTop - c.start);
              break;
            }
          }
          
          if (mappedTop === -9999) return;
          
          const div = document.createElement('span');
          div.textContent = item.str;
          div.style.left = `${tx[4]}px`;
          div.style.top = `${mappedTop}px`;
          div.style.fontSize = `${fontHeight}px`;
          div.style.fontFamily = item.fontName;
          
          const targetWidth = item.width * renderScale; 
          div.style.width = `${targetWidth}px`;
          div.style.display = 'inline-block';
          div.style.transform = `scaleX(1.0)`;
          
          textLayerDiv.appendChild(div);
        });

        setIsVisible(true);

        // 3. Setup ResizeObserver to scale the text layer to match the CSS width
        resizeObserver = new ResizeObserver(entries => {
          for (let entry of entries) {
            const rect = entry.contentRect;
            const s = rect.width / canvas.width;
            textLayerDiv.style.transform = `scale(${s})`;
            setCurrentScale(s);
          }
        });
        resizeObserver.observe(containerRef.current);

      } catch (err) {
        if (err.name !== 'RenderingCancelledException') {
          console.error(`Error rendering page ${pageNumber}:`, err);
        }
      }
    };

    renderPage();

    return () => {
      isMounted = false;
      if (renderTask) renderTask.cancel();
      if (resizeObserver) resizeObserver.disconnect();
      if (loadedPage) loadedPage.cleanup();
    };
  }, [pdf, pageNumber, isNearViewport]);

  const openContextMenu = (clientX, clientY) => {
    const selection = window.getSelection();
    if (selection.rangeCount === 0 || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    const containerRect = textLayerRef.current.getBoundingClientRect();
    const rects = [];
    
    // Find all spans in the text layer
    const spans = textLayerRef.current.querySelectorAll('span');
    
    for (const span of spans) {
      // Check if the span is at least partially selected
      if (!selection.containsNode(span, true)) continue;
      
      // Skip spans that are just empty space or invisible
      if (!span.textContent.trim()) continue;
      
      const spanRange = document.createRange();
      spanRange.selectNodeContents(span);
      
      const intersectionRange = document.createRange();
      
      try {
        // Find intersection start
        if (range.compareBoundaryPoints(Range.START_TO_START, spanRange) > 0) {
          intersectionRange.setStart(range.startContainer, range.startOffset);
        } else {
          intersectionRange.setStart(spanRange.startContainer, spanRange.startOffset);
        }
        
        // Find intersection end
        if (range.compareBoundaryPoints(Range.END_TO_END, spanRange) < 0) {
          intersectionRange.setEnd(range.endContainer, range.endOffset);
        } else {
          intersectionRange.setEnd(spanRange.endContainer, spanRange.endOffset);
        }
        
        const spanRects = intersectionRange.getClientRects();
        for (const r of spanRects) {
          if (r.width > 2 && r.height > 2) {
            // Note: r is in screen coordinates.
            // We want to map it to the unscaled canvas.
            // Since the textLayer itself is already mapped to the compressed chunks space,
            // we just convert screen to unscaled chunk space.
            const unscaledX = (r.left - containerRect.left) / currentScale;
            const unscaledY = (r.top - containerRect.top) / currentScale;
            
            // To get original PDF coords for export, we reverse the chunk mapping:
            let pdfY = unscaledY;
            for (const c of chunksInfo.chunks) {
              if (unscaledY >= c.newY && unscaledY <= c.newY + c.height) {
                pdfY = c.start + (unscaledY - c.newY);
                break;
              }
            }
            
            rects.push({
              x: unscaledX / 2.0, // viewport scale is 2.0
              y: pdfY / 2.0,
              width: (r.width / currentScale) / 2.0,
              height: (r.height / currentScale) / 2.0,
              displayY: unscaledY / 2.0 // keep track for rendering in browser
            });
          }
        }
      } catch (e) {
        // Ignore boundary errors if nodes are incompatible
        continue;
      }
    }

    if (rects.length > 0) {
      setContextMenu({
        x: clientX,
        y: clientY,
        selectionData: { pageIndex: pageNumber - 1, rects }
      });
    }
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY);
  };

  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    pressTimer.current = setTimeout(() => {
      openContextMenu(touch.clientX, touch.clientY);
    }, 600);
  };

  const handleTouchEnd = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };

  return (
    <div 
      ref={containerRef}
      className={`pdf-page-container ${isVisible ? 'fade-in' : ''}`}
      style={{
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
        minHeight: chunksInfo.width ? 'auto' : '800px',
        lineHeight: 0,
        fontSize: 0,
        margin: 0,
        padding: 0,
      }}
    >
      <canvas 
        ref={canvasRef} 
        style={{ width: '100%', height: 'auto', display: 'block', margin: 0, padding: 0 }} 
      />
      <div 
        ref={textLayerRef} 
        className="textLayer"
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchEnd}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: chunksInfo.width ? `${chunksInfo.width}px` : '100%',
          height: chunksInfo.totalHeight ? `${chunksInfo.totalHeight}px` : '100%',
          transformOrigin: '0 0',
          lineHeight: 1.5,
          fontSize: '16px'
        }}
      >
          {highlights && highlights.map((hl) => (
            <div 
              key={hl.id}
              onMouseEnter={() => hl.note && setActiveNote(hl.id)}
              onMouseLeave={() => setActiveNote(null)}
            >
              {hl.rects.map((r, idx) => (
                <div
                  key={idx}
                  role="button"
                  tabIndex={0}
                  aria-label="Ver o editar nota"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNoteClick(hl.id);
                    setActiveNote(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      onNoteClick(hl.id);
                      setActiveNote(null);
                    }
                  }}
                  style={{
                    position: 'absolute',
                    left: `${r.x * 2.0}px`, top: `${r.displayY * 2.0}px`,
                    width: `${r.width * 2.0}px`, height: `${r.height * 2.0}px`,
                    backgroundColor: hl.colorObj.css,
                    pointerEvents: 'auto', cursor: 'pointer',
                    mixBlendMode: 'multiply'
                  }}
                />
              ))}
              {activeNote === hl.id && hl.note && (
                <div 
                  className="note-tooltip" 
                  style={{
                    position: 'absolute',
                    left: `${hl.rects[0].x * 2.0}px`,
                    top: `${(hl.rects[0].displayY * 2.0) - 5}px`,
                    background: '#1e1e1e',
                    border: '1px solid #444',
                    color: '#f3f4f6',
                    padding: '8px 12px',
                    borderRadius: '8px',
                    fontSize: '13px',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.6)',
                    pointerEvents: 'none',
                    zIndex: 100,
                    whiteSpace: 'pre-wrap',
                    maxWidth: '250px',
                    transform: 'translateY(-100%)'
                  }}
                >
                  {hl.note}
                  <div style={{fontSize: '10px', color: '#8b5cf6', marginTop: '6px', fontWeight: '500'}}>Clic para editar</div>
                </div>
              )}
            </div>
          ))}
        </div>
    </div>
  );
});

export default App;
