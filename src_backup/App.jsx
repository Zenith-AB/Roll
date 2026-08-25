import { useState, useRef, useEffect, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import './App.css';

// Set up the worker for pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

function App() {
  const [pdf, setPdf] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [rawPdfBuffer, setRawPdfBuffer] = useState(null);
  const [isConverting, setIsConverting] = useState(false);

  const processFile = async (file) => {
    if (!file || file.type !== 'application/pdf') return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      setRawPdfBuffer(arrayBuffer.slice(0));
      const loadedPdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdf(loadedPdf);
      setNumPages(loadedPdf.numPages);
    } catch (error) {
      console.error("Error loading PDF:", error);
    }
  };

  const handleDownload = async () => {
    if (!rawPdfBuffer) return;
    setIsConverting(true);
    try {
      const srcDoc = await PDFDocument.load(rawPdfBuffer);
      const pages = srcDoc.getPages();
      const newPdf = await PDFDocument.create();

      let totalHeight = 0;
      let maxWidth = 0;
      
      const embeddedPages = await newPdf.embedPages(pages);
      const pagesData = [];

      // Pass 1: Find crop bounds for each page
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const pdfjsPage = await pdf.getPage(i + 1);
        
        // Scan at a lower resolution for speed
        const scale = 0.5;
        const viewport = pdfjsPage.getViewport({ scale });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d', { willReadFrequently: true });
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await pdfjsPage.render({ canvasContext: context, viewport }).promise;
        
        // --- CLEAN HEADERS AND FOOTERS BEFORE CROPPING ---
        // Just wipe the top and bottom margins directly!
        // PDF points: typical header is top 50 points, footer is bottom 50 points.
        // We multiply by our scale to get canvas pixels.
        context.fillStyle = 'white';
        if (i > 0) {
          // Wipe top 60 points (headers) only on pages > 1
          context.fillRect(0, 0, canvas.width, 60 * scale);
        }
        // Wipe bottom 60 points (footers) on ALL pages
        context.fillRect(0, canvas.height - (60 * scale), canvas.width, 60 * scale);
        // -------------------------------------------------

        const bounds = findContentBounds(canvas);
        
        // Convert bounds back to original PDF point scale
        const pdfTop = Math.max(0, (bounds.top / scale) - 5);
        const pdfBottom = Math.min(p.getHeight(), (bounds.bottom / scale) + 5);
        const cropHeight = pdfBottom - pdfTop;
        
        pagesData.push({
          ep: embeddedPages[i],
          cropY: p.getHeight() - pdfBottom, // PDF-lib uses Y=0 at bottom
          cropHeight: cropHeight,
          pdfTop: pdfTop,
          pdfBottom: pdfBottom,
          width: p.getWidth()
        });
        
        totalHeight += cropHeight;
        maxWidth = Math.max(maxWidth, p.getWidth());
      }

      // Pass 2: Draw on the giant page
      const giantPage = newPdf.addPage([maxWidth, totalHeight]);
      let currentY = totalHeight;

      for (let i = 0; i < pagesData.length; i++) {
        const data = pagesData[i];
        currentY -= data.cropHeight;
        
        // In pdf-lib, to draw a cropped embedded page, we just draw the whole page 
        // but shifted so that the cropped area aligns with our target box, 
        // and wrap it in a clip. But actually pdf-lib embedPages automatically respects CropBox if set!
        // Alternatively, drawing the page offset downwards by `data.pdfTop` will shift the white top margin up 
        // past the bounds of our intended area. Since the top is white, it just overlaps invisibly!
        // The most robust way is just drawing it shifted.
        
        giantPage.drawPage(data.ep, {
          x: 0,
          y: currentY - data.cropY, // shift down so the cropped area starts exactly at currentY
          width: data.width,
          height: data.ep.height,
        });
      }

      const pdfBytes = await newPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'comic_webtoon_recortado.pdf';
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

  return (
    <div className="webtoon-container">
      {!pdf && (
        <div className="upload-section">
          <h1>Webtoon Reader</h1>
          <p className="subtitle">Experience continuous vertical reading</p>
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
              <h3>Drag & drop your PDF here</h3>
              <p>or</p>
              <label className="upload-button">
                Browse Files
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
              {isConverting ? 'Convirtiendo...' : 'Descargar PDF Webtoon'}
            </button>
          </div>
          <div className="pdf-viewer">
            {Array.from(new Array(numPages), (el, index) => (
              <PdfPage key={`page_${index + 1}`} pdf={pdf} pageNumber={index + 1} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function findContentBounds(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height).data;
  
  let top = 0;
  let bottom = height;
  
  // A pixel is empty if it's white or completely transparent
  const isWhite = (r, g, b, a) => (r > 245 && g > 245 && b > 245) || a === 0;
  
  // Find top
  for (let y = 0; y < height; y++) {
    let emptyRow = true;
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (!isWhite(imageData[index], imageData[index+1], imageData[index+2], imageData[index+3])) {
        emptyRow = false;
        break;
      }
    }
    if (!emptyRow) {
      top = y;
      break;
    }
  }
  
  // Find bottom
  for (let y = height - 1; y >= 0; y--) {
    let emptyRow = true;
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (!isWhite(imageData[index], imageData[index+1], imageData[index+2], imageData[index+3])) {
        emptyRow = false;
        break;
      }
    }
    if (!emptyRow) {
      bottom = y + 1;
      break;
    }
  }
  
  // Add a small 10px overlap buffer
  return { 
    top: Math.max(0, top - 10), 
    bottom: Math.min(height, bottom + 10) 
  };
}

function PdfPage({ pdf, pageNumber }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const textLayerRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const [cropInfo, setCropInfo] = useState(null);

  useEffect(() => {
    let renderTask;
    let isMounted = true;
    let resizeObserver;

    const renderPage = async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        if (!isMounted) return;

        // Scale by 2 for better resolution
        const viewport = page.getViewport({ scale: 2.0 });
        const canvas = canvasRef.current;
        if (!canvas) return;

        const context = canvas.getContext('2d', { willReadFrequently: true });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = {
          canvasContext: context,
          viewport: viewport,
        };
        renderTask = page.render(renderContext);
        await renderTask.promise;
        
        if (!isMounted) return;

        // --- CLEAN HEADERS AND FOOTERS BEFORE CROPPING ---
        context.fillStyle = 'white';
        if (pageNumber > 1) {
          // Wipe top 60 points (headers)
          context.fillRect(0, 0, canvas.width, 60 * 2.0); // 2.0 is the viewport scale
        }
        // Wipe bottom 60 points (footers)
        context.fillRect(0, canvas.height - (60 * 2.0), canvas.width, 60 * 2.0);
        
        // Remove those text items from the selectable text layer
        const textContent = await page.getTextContent();
        textContent.items.forEach(item => {
          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const y = tx[5];
          // If the text falls in the wiped areas, empty it
          if (y > canvas.height - (60 * 2.0) || (pageNumber > 1 && y < (60 * 2.0))) {
            item.str = "";
          }
        });
        // -------------------------------------------------

        // 1. Calculate Auto-Crop
        const bounds = findContentBounds(canvas);
        const cropHeight = bounds.bottom - bounds.top;
        setCropInfo({
          top: bounds.top,
          bottom: bounds.bottom,
          height: cropHeight,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height
        });

        // 2. Render Text Layer for highlighting
        // Using the textContent from above which already has headers/footers removed!
        const textLayerDiv = textLayerRef.current;
        textLayerDiv.innerHTML = '';
        
        textContent.items.forEach(item => {
          const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
          const fontHeight = Math.sqrt((tx[2] * tx[2]) + (tx[3] * tx[3]));
          const fontAscent = fontHeight;
          
          const div = document.createElement('span');
          div.textContent = item.str;
          div.style.left = `${tx[4]}px`;
          div.style.top = `${tx[5] - fontAscent}px`;
          div.style.fontSize = `${fontHeight}px`;
          div.style.fontFamily = item.fontName;
          
          // Fix for text selection gaps: stretch the invisible text to match the PDF width
          const targetWidth = item.width * 2.0; // 2.0 is the viewport scale
          div.style.width = `${targetWidth}px`;
          div.style.display = 'inline-block';
          // Use CSS transform to squish or stretch the text inside the span to fit exactly
          // We wrap the text in a span that scales
          div.style.transform = `scaleX(1.0)`; // We don't need scaleX if width is set and we don't care about visual squishing since it's transparent
          
          textLayerDiv.appendChild(div);
        });

        setIsVisible(true);

        // 3. Setup ResizeObserver to scale the text layer to match the CSS width
        resizeObserver = new ResizeObserver(entries => {
          for (let entry of entries) {
            const rect = entry.contentRect;
            const scale = rect.width / canvas.width;
            textLayerDiv.style.transform = `scale(${scale})`;
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
    };
  }, [pdf, pageNumber]);

  return (
    <div 
      ref={containerRef}
      className={`pdf-page-container ${isVisible ? 'fade-in' : ''}`}
      style={{
        width: '100%',
        position: 'relative',
        overflow: 'hidden',
        // Aspect ratio dynamically adjusts to the cropped height
        aspectRatio: cropInfo ? `${cropInfo.canvasWidth} / ${cropInfo.height}` : 'auto',
      }}
    >
      <div 
        style={{
          position: 'absolute',
          width: '100%',
          // Inner div stretches to accommodate the full uncropped canvas ratio
          height: cropInfo ? `${(cropInfo.canvasHeight / cropInfo.height) * 100}%` : '100%',
          // Shift the inner div up by the exact cropped amount
          top: cropInfo ? `-${(cropInfo.top / cropInfo.height) * 100}%` : '0',
          left: 0
        }}
      >
        <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        <div 
          ref={textLayerRef} 
          className="textLayer" 
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: cropInfo ? `${cropInfo.canvasWidth}px` : '100%',
            height: cropInfo ? `${cropInfo.canvasHeight}px` : '100%',
            transformOrigin: '0 0'
          }}
        />
      </div>
    </div>
  );
}

export default App;
