// Figure extraction.
//
// A PDF has no concept of "a figure": there are only paint operations. Half the
// illustrations in a real document (charts, diagrams, schemes, formulas laid out
// with rules) are *vector* drawings, so pulling out the embedded image XObjects
// — the obvious approach — silently misses them and produces a document with
// holes where its graphics were.
//
// So instead of harvesting images, this finds the *areas of the page that are
// drawn rather than typeset*, and re-renders each one through pdf.js itself.
// Whatever the figure was made of — a JPEG, a thousand bezier paths, or both —
// what comes out is what the reader would have seen on paper.
//
// Regions are found from the operator list (cheap: no rasterising) by walking
// the transform stack and collecting the bounding box of every paint op, then
// grouping those boxes with a dilation + connected-components pass on a coarse
// grid. Each surviving region is rendered on its own small canvas using a
// viewport offset, so a phone never has to hold a full-page bitmap in memory.

import {
  OPS,
  Util,
  AnnotationMode,
  PDFDateString,
} from 'pdfjs-dist/legacy/build/pdf.mjs';

const IDENTITY = [1, 0, 0, 1, 0, 0];

// Grid resolution for region grouping, in PDF points. 3pt is fine enough to
// keep two side-by-side figures apart and coarse enough that a whole page is
// only ~200×280 cells.
const CELL = 3;
// Two marks closer than this are the same figure (axis labels to plot area,
// legend to chart). ~11pt is a little under one line of body text.
const MERGE_GAP = 11;

// A phone is not a laptop: it has less memory, a smaller screen and a slower
// JPEG encoder, and iOS kills the tab rather than swapping. Everything that
// costs memory is sized from here.
export function graphicsBudget() {
  const coarse =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(pointer: coarse)').matches ?? false);
  const narrow = typeof window !== 'undefined' && (window.innerWidth || 1024) < 820;
  const memory = typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined;
  const lean = coarse || narrow || (memory != null && memory <= 4);

  return {
    lean,
    // Hard ceiling so a pathological document can't fill memory with bitmaps.
    maxFigures: lean ? 60 : 160,
    maxPixelsPerFigure: lean ? 1_200_000 : 3_200_000,
    // Every figure stays in memory as a blob for as long as the document is
    // open. An illustrated 300-page book would otherwise accumulate hundreds of
    // megabytes of bitmaps and get the tab discarded mid-read, so extraction
    // stops adding figures once this much has been produced.
    maxTotalBytes: lean ? 24_000_000 : 90_000_000,
    // Rendered width to aim for: enough to stay sharp when the reader zooms in,
    // not so much that the encode stalls the main thread.
    targetWidth: lean ? 1100 : 1700,
    maxScale: 3.5,
    // Pages whose operator list is longer than this are maps/CAD drawings;
    // scanning them costs more than the figures are worth.
    maxOps: 200_000,
    maxMarks: 8000,
  };
}

// ── Region detection ────────────────────────────────────────────────────────

// `constructPath` also carries the clipping paths — a `W n` pair that paints
// nothing. Those are almost always the whole page, so counting them as ink made
// every page look like one giant graphic. Only the operators that actually put
// something on the page count.
const PAINT_PATH_OPS = new Set([
  OPS.stroke,
  OPS.closeStroke,
  OPS.fill,
  OPS.eoFill,
  OPS.fillStroke,
  OPS.eoFillStroke,
  OPS.closeFillStroke,
  OPS.closeEOFillStroke,
]);

const IMAGE_OPS = new Set([
  OPS.paintImageXObject,
  OPS.paintInlineImageXObject,
  OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat,
  OPS.paintImageMaskXObjectRepeat,
  OPS.paintInlineImageXObjectGroup,
  OPS.paintImageMaskXObjectGroup,
  OPS.paintSolidColorImageMask,
]);

// Walks the operator list keeping our own copy of the transform matrix, and
// records where each paint operation lands in page (user) space.
//
// `save`/`restore` are the obvious pairs, but form XObjects, transparency
// groups and annotations *also* push and pop the matrix; missing one of them
// leaves the CTM stuck and every later box lands in the wrong place.
export function collectMarks(opList, limit) {
  const { fnArray, argsArray } = opList;
  const marks = [];
  const stack = [];
  let ctm = IDENTITY.slice();
  // Util.axialAlignedBoundingBox *accumulates* into its output (it is built to
  // union many boxes), so the accumulator has to be emptied before each use or
  // every box silently grows to include the origin — which reads as "the whole
  // page is one graphic".
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  const resetBox = () => {
    box[0] = Infinity;
    box[1] = Infinity;
    box[2] = -Infinity;
    box[3] = -Infinity;
  };

  const push = () => stack.push(ctm);
  const pop = () => {
    ctm = stack.pop() || IDENTITY.slice();
  };

  for (let i = 0; i < fnArray.length && marks.length < limit; i++) {
    const fn = fnArray[i];
    const args = argsArray[i];

    switch (fn) {
      case OPS.save:
        push();
        break;
      case OPS.restore:
        pop();
        break;
      case OPS.transform:
        ctm = Util.transform(ctm, args);
        break;
      case OPS.paintFormXObjectBegin:
        push();
        if (args?.[0]) ctm = Util.transform(ctm, args[0]);
        break;
      case OPS.paintFormXObjectEnd:
        pop();
        break;
      // A transparency group is composited back at the same place, so for the
      // purpose of "where on the page is this", it is just a save/restore.
      case OPS.beginGroup:
      case OPS.beginAnnotation:
        push();
        break;
      case OPS.endGroup:
      case OPS.endAnnotation:
        pop();
        break;
      case OPS.constructPath: {
        // args = [op, data, minMax]; minMax is the path's own bounding box in
        // the space the CTM maps from. Absent for glyph-ish raw paths.
        const minMax = args?.[2];
        if (!minMax || !PAINT_PATH_OPS.has(args[0])) break;
        resetBox();
        Util.axialAlignedBoundingBox(minMax, ctm, box);
        marks.push({ kind: 'path', box: box.slice() });
        break;
      }
      default:
        if (IMAGE_OPS.has(fn)) {
          // Images are painted into the unit square of the current transform.
          resetBox();
          Util.axialAlignedBoundingBox([0, 0, 1, 1], ctm, box);
          marks.push({ kind: 'image', box: box.slice() });
        }
        break;
    }
  }

  return marks;
}

function makeGrid(view) {
  const width = view[2] - view[0];
  const height = view[3] - view[1];
  const cols = Math.max(1, Math.ceil(width / CELL));
  const rows = Math.max(1, Math.ceil(height / CELL));
  return { x0: view[0], y0: view[1], width, height, cols, rows, area: width * height };
}

function paintBox(grid, cells, box) {
  const c0 = Math.max(0, Math.floor((box[0] - grid.x0) / CELL));
  const c1 = Math.min(grid.cols - 1, Math.floor((box[2] - grid.x0) / CELL));
  const r0 = Math.max(0, Math.floor((box[1] - grid.y0) / CELL));
  const r1 = Math.min(grid.rows - 1, Math.floor((box[3] - grid.y0) / CELL));
  if (c1 < c0 || r1 < r0) return;
  for (let r = r0; r <= r1; r++) {
    const base = r * grid.cols;
    cells.fill(1, base + c0, base + c1 + 1);
  }
}

// Binary max-filter of radius `radius`, run separably (rows then columns) off a
// prefix sum so it stays linear in the number of cells rather than quadratic in
// the radius. This is what closes the gaps *inside* a figure — between a bar
// and its axis, a legend and its plot — so the pieces come out as one region.
function dilate(cells, cols, rows, radius) {
  const out = new Uint8Array(cells.length);
  const prefix = new Int32Array(Math.max(cols, rows) + 1);

  for (let r = 0; r < rows; r++) {
    const base = r * cols;
    for (let c = 0; c < cols; c++) prefix[c + 1] = prefix[c] + cells[base + c];
    for (let c = 0; c < cols; c++) {
      const lo = Math.max(0, c - radius);
      const hi = Math.min(cols, c + radius + 1);
      out[base + c] = prefix[hi] - prefix[lo] > 0 ? 1 : 0;
    }
  }

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) prefix[r + 1] = prefix[r] + out[r * cols + c];
    for (let r = 0; r < rows; r++) {
      const lo = Math.max(0, r - radius);
      const hi = Math.min(rows, r + radius + 1);
      cells[r * cols + c] = prefix[hi] - prefix[lo] > 0 ? 1 : 0;
    }
  }

  return cells;
}

// 4-connected labelling with an explicit stack — a recursive flood fill blows
// the call stack on a full-page graphic.
function label(cells, cols, rows) {
  const labels = new Int32Array(cells.length).fill(-1);
  const queue = new Int32Array(cells.length);
  let next = 0;

  for (let start = 0; start < cells.length; start++) {
    if (!cells[start] || labels[start] !== -1) continue;
    const id = next++;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;

    while (head < tail) {
      const idx = queue[head++];
      const c = idx % cols;
      const r = (idx - c) / cols;
      if (c > 0) {
        const n = idx - 1;
        if (cells[n] && labels[n] === -1) { labels[n] = id; queue[tail++] = n; }
      }
      if (c < cols - 1) {
        const n = idx + 1;
        if (cells[n] && labels[n] === -1) { labels[n] = id; queue[tail++] = n; }
      }
      if (r > 0) {
        const n = idx - cols;
        if (cells[n] && labels[n] === -1) { labels[n] = id; queue[tail++] = n; }
      }
      if (r < rows - 1) {
        const n = idx + cols;
        if (cells[n] && labels[n] === -1) { labels[n] = id; queue[tail++] = n; }
      }
    }
  }

  return { labels, count: next };
}

function cellIndex(grid, x, y) {
  const c = Math.min(grid.cols - 1, Math.max(0, Math.floor((x - grid.x0) / CELL)));
  const r = Math.min(grid.rows - 1, Math.max(0, Math.floor((y - grid.y0) / CELL)));
  return r * grid.cols + c;
}

/**
 * Groups the paint operations of one page into candidate figure regions.
 *
 * `textBoxes` are the boxes of the page's own text runs: a region that is
 * mostly text is a bordered paragraph or a ruled table, not a figure, and must
 * be left to the text pipeline — which renders it as real prose or a real
 * `<table>` rather than a picture nobody can search or select.
 */
export function findFigureRegions(marks, textBoxes, view, options = {}) {
  const { allowFullPage = false } = options;
  const grid = makeGrid(view);
  if (grid.cols * grid.rows > 500_000) return [];

  const size = grid.cols * grid.rows;
  const drawn = new Uint8Array(size);
  const textCells = new Uint8Array(size);
  const maxMarkArea = allowFullPage ? grid.area * 1.3 : grid.area * 0.82;

  // Hairlines — table rules, underlines, the box around a callout — are real
  // ink but they are never a figure on their own. They may join a region but
  // may not seed one, which is the difference between capturing a chart's axes
  // and turning every underlined heading into a picture.
  const seeds = [];
  for (const mark of marks) {
    const w = mark.box[2] - mark.box[0];
    const h = mark.box[3] - mark.box[1];
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0.4 || h <= 0.4) continue;
    if (w > grid.width * 1.5 || h > grid.height * 1.5) continue;
    if (w * h > maxMarkArea) continue;

    paintBox(grid, drawn, mark.box);
    const hairline = w < 2.5 || h < 2.5;
    if (!hairline || mark.kind === 'image') seeds.push(mark);
  }
  if (!seeds.length) return [];

  for (const box of textBoxes) paintBox(grid, textCells, box);

  dilate(drawn, grid.cols, grid.rows, Math.max(1, Math.round(MERGE_GAP / CELL)));
  const { labels, count } = label(drawn, grid.cols, grid.rows);
  if (!count) return [];

  const regions = new Map();
  for (const mark of seeds) {
    const cx = (mark.box[0] + mark.box[2]) / 2;
    const cy = (mark.box[1] + mark.box[3]) / 2;
    const id = labels[cellIndex(grid, cx, cy)];
    if (id < 0) continue;

    let region = regions.get(id);
    if (!region) {
      region = { rect: mark.box.slice(), marks: 0, images: 0 };
      regions.set(id, region);
    }
    region.rect[0] = Math.min(region.rect[0], mark.box[0]);
    region.rect[1] = Math.min(region.rect[1], mark.box[1]);
    region.rect[2] = Math.max(region.rect[2], mark.box[2]);
    region.rect[3] = Math.max(region.rect[3], mark.box[3]);
    region.marks++;
    if (mark.kind === 'image') region.images++;
  }

  const out = [];
  for (const region of regions.values()) {
    const rect = [
      Math.max(view[0], region.rect[0] - 3),
      Math.max(view[1], region.rect[1] - 3),
      Math.min(view[2], region.rect[2] + 3),
      Math.min(view[3], region.rect[3] + 3),
    ];
    const w = rect[2] - rect[0];
    const h = rect[3] - rect[1];
    if (w < 34 || h < 26) continue;

    const area = w * h;
    if (!allowFullPage && area > grid.area * 0.92) continue;

    if (region.images) {
      // A photo or a placed drawing only has to not be mostly text.
      if (textRatio(grid, textCells, rect) > 0.5) continue;
    } else {
      // Vector regions are the hard case, because a document's *furniture* is
      // vector too: the tinted header row of a table, the coloured banner
      // behind a section title, the rule under a running head. Measured on real
      // reports, those come out as a handful of filled rectangles in a band a
      // line or two high and as wide as the text; an actual chart or diagram is
      // dozens of paths in a block with real height and comparatively little
      // text in it. Each of these thresholds removes one of those shapes.
      if (region.marks < 8) continue;
      if (h < 45) continue;
      if (w / h > 9) continue;
      if (area < grid.area * 0.012) continue;
      if (textRatio(grid, textCells, rect) > 0.35) continue;
    }

    out.push({ rect, hasImage: region.images > 0, marks: region.marks, area });
  }

  // Largest first: if the figure cap is reached, the big illustrations are the
  // ones worth keeping.
  out.sort((a, b) => b.area - a.area);
  return out;
}

function textRatio(grid, textCells, rect) {
  const c0 = Math.max(0, Math.floor((rect[0] - grid.x0) / CELL));
  const c1 = Math.min(grid.cols - 1, Math.floor((rect[2] - grid.x0) / CELL));
  const r0 = Math.max(0, Math.floor((rect[1] - grid.y0) / CELL));
  const r1 = Math.min(grid.rows - 1, Math.floor((rect[3] - grid.y0) / CELL));
  if (c1 < c0 || r1 < r0) return 0;

  let hits = 0;
  for (let r = r0; r <= r1; r++) {
    const base = r * grid.cols;
    for (let c = c0; c <= c1; c++) if (textCells[base + c]) hits++;
  }
  return hits / ((c1 - c0 + 1) * (r1 - r0 + 1));
}

// ── Rasterising ─────────────────────────────────────────────────────────────

function releaseCanvas(canvas) {
  // Zeroing the size is what actually frees the backing store on iOS; dropping
  // the reference alone leaves the bitmap alive until GC, and a handful of
  // full-size canvases is enough for Safari to discard the whole tab.
  canvas.width = 0;
  canvas.height = 0;
}

// Reads a tiny thumbnail of the render instead of the full bitmap: enough to
// tell "nothing was drawn here" from "this is a photo" without the cost (or the
// iOS memory spike) of getImageData over millions of pixels.
function inspect(canvas) {
  const sample = document.createElement('canvas');
  const side = 48;
  sample.width = side;
  sample.height = side;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ink: 1, colorful: true };

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, side, side);
  try {
    ctx.drawImage(canvas, 0, 0, side, side);
  } catch {
    releaseCanvas(sample);
    return { ink: 1, colorful: true };
  }

  let ink = 0;
  let colorful = 0;
  try {
    const { data } = ctx.getImageData(0, 0, side, side);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (r < 246 || g < 246 || b < 246) ink++;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      // Saturated, mid-tone pixels mean a photo or a filled chart; pure
      // black-on-white line art compresses far better as PNG than as JPEG.
      if (max - min > 26 && max > 40 && min < 235) colorful++;
    }
  } catch {
    releaseCanvas(sample);
    return { ink: 1, colorful: true };
  }

  releaseCanvas(sample);
  const total = side * side;
  return { ink: ink / total, colorful: colorful / total > 0.06 };
}

function toDataUrlSafely(canvas, type, quality) {
  try {
    return canvas.toDataURL(type, quality);
  } catch {
    return null;
  }
}

function encode(canvas, colorful) {
  const pixels = canvas.width * canvas.height;
  // PNG keeps diagram lines and small type crisp; above roughly a megapixel, or
  // for anything photographic, the file size stops being worth it.
  const usePng = !colorful && pixels <= 1_200_000;
  const type = usePng ? 'image/png' : 'image/jpeg';
  const quality = usePng ? undefined : 0.88;

  const fallback = () => {
    const url = toDataUrlSafely(canvas, type, quality);
    // A data: URL's cost is roughly its own string length.
    return url ? { url, bytes: url.length } : null;
  };

  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(fallback());
      return;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      canvas.toBlob(
        (blob) =>
          finish(blob ? { url: URL.createObjectURL(blob), bytes: blob.size } : fallback()),
        type,
        quality
      );
    } catch {
      finish(fallback());
    }
  });
}

/**
 * Re-renders one region of a page onto its own canvas.
 *
 * The whole page is never rasterised: `offsetX`/`offsetY` shift the page so the
 * region lands at the canvas origin, so the bitmap is only as large as the
 * figure. On a phone that is the difference between a few hundred kilobytes and
 * a tab the OS kills.
 */
async function renderRegion(page, rect, budget) {
  const wPt = rect[2] - rect[0];
  const hPt = rect[3] - rect[1];
  if (wPt <= 0 || hPt <= 0) return null;

  let scale = Math.min(budget.maxScale, budget.targetWidth / wPt);
  scale = Math.min(scale, Math.sqrt(budget.maxPixelsPerFigure / (wPt * hPt)));
  scale = Math.max(0.6, scale);

  const probe = page.getViewport({ scale });
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  Util.axialAlignedBoundingBox(rect, probe.transform, box);

  const left = Math.floor(box[0]);
  const top = Math.floor(box[1]);
  const width = Math.min(6000, Math.max(1, Math.ceil(box[2]) - left));
  const height = Math.min(6000, Math.max(1, Math.ceil(box[3]) - top));
  if (width < 8 || height < 8) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    releaseCanvas(canvas);
    return null;
  }

  // Figures are drawn for white paper: line art with no background of its own
  // would vanish against a dark theme, so every figure keeps its own white
  // sheet and the reader gets it as a card (see .doc-figure).
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const viewport = page.getViewport({ scale, offsetX: -left, offsetY: -top });

  try {
    await page.render({
      canvasContext: ctx,
      viewport,
      background: '#ffffff',
      // The annotation layer is handled separately, as text; baking sticky
      // notes and form widgets into the picture would be neither readable
      // nor selectable.
      annotationMode: AnnotationMode.DISABLE,
    }).promise;
  } catch {
    releaseCanvas(canvas);
    return null;
  }

  const { ink, colorful } = inspect(canvas);
  // A clipped-away or invisible region renders as blank paper. Dropping it here
  // is what keeps stray clip paths from becoming empty grey boxes in the text.
  if (ink < 0.004) {
    releaseCanvas(canvas);
    return null;
  }

  const encoded = await encode(canvas, colorful);
  releaseCanvas(canvas);
  if (!encoded) return null;

  return {
    url: encoded.url,
    bytes: encoded.bytes,
    width,
    height,
    ratio: width / height,
  };
}

// ── Annotations (author comments) ───────────────────────────────────────────

// Subtypes that carry something a person wrote. Popup is deliberately absent:
// it is the little window for its parent's text, and including it would print
// every comment twice.
const COMMENT_SUBTYPES = new Set([
  'Text',
  'FreeText',
  'Highlight',
  'Underline',
  'StrikeOut',
  'Squiggly',
  'Square',
  'Circle',
  'Polygon',
  'PolyLine',
  'Ink',
  'Caret',
  'FileAttachment',
  'Stamp',
]);

const SUBTYPE_LABEL = {
  Text: 'Nota',
  FreeText: 'Comentario',
  Highlight: 'Subrayado del autor',
  Underline: 'Subrayado del autor',
  StrikeOut: 'Texto tachado',
  Squiggly: 'Marca del autor',
  Square: 'Recuadro',
  Circle: 'Marca del autor',
  Polygon: 'Marca del autor',
  PolyLine: 'Marca del autor',
  Ink: 'Anotación a mano',
  Caret: 'Corrección',
  FileAttachment: 'Adjunto',
  Stamp: 'Sello',
};

function annotationDate(raw) {
  if (!raw) return null;
  try {
    const date = PDFDateString.toDateObject(raw);
    if (!date) return null;
    return date.toLocaleDateString('es', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return null;
  }
}

function readAnnotations(list, pageNumber) {
  const out = [];
  for (const a of list || []) {
    if (!COMMENT_SUBTYPES.has(a.subtype)) continue;
    const contents = (a.contentsObj?.str ?? a.contents ?? '').trim();
    if (!contents) continue; // a bare highlight with no note says nothing

    const author = (a.titleObj?.str ?? a.title ?? '').trim();
    const rect = Array.isArray(a.rect) ? Util.normalizeRect(a.rect) : null;

    out.push({
      type: 'annotation',
      page: pageNumber,
      y: rect ? rect[3] : 0,
      author: author || null,
      date: annotationDate(a.modificationDate || a.creationDate),
      label: SUBTYPE_LABEL[a.subtype] || 'Comentario',
      text: contents,
    });
  }
  return out;
}

// ── Public entry point ──────────────────────────────────────────────────────

/**
 * Extracts every figure and author comment in the document.
 *
 * `pageText` maps a page number to `{ view, boxes }` — the page box and the
 * boxes of its text runs — which is what tells a chart apart from a paragraph
 * with a border around it.
 */
export async function extractGraphics(pdf, { pageText, onProgress, budget } = {}) {
  const limits = budget || graphicsBudget();
  const figures = [];
  const annotations = [];
  const seen = new Map();
  const spent = { bytes: 0 };

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    onProgress?.({ phase: 'figures', page: pageNumber, total: pdf.numPages });

    let page;
    try {
      page = await pdf.getPage(pageNumber);
    } catch {
      continue;
    }

    try {
      annotations.push(
        ...readAnnotations(await page.getAnnotations({ intent: 'display' }), pageNumber)
      );
    } catch {
      /* a broken annotation dictionary must not cost us the page's figures */
    }

    if (figures.length < limits.maxFigures && spent.bytes < limits.maxTotalBytes) {
      try {
        await collectPageFigures(page, pageNumber, { pageText, limits, figures, seen, spent });
      } catch {
        /* skip the page's graphics rather than failing the whole document */
      }
    }

    try {
      page.cleanup();
    } catch {
      /* best effort */
    }
  }

  // Repeated geometry across many pages is a logo or a watermark in the page
  // furniture, not an illustration — the same reasoning that strips running
  // headers from the text.
  const furniture = new Set();
  seen.forEach((pages, key) => {
    if (pages.size >= 3) furniture.add(key);
  });

  const kept = [];
  for (const figure of figures) {
    if (furniture.has(figure.key) && figure.area < figure.pageArea * 0.12) {
      if (figure.image?.url?.startsWith('blob:')) URL.revokeObjectURL(figure.image.url);
      continue;
    }
    delete figure.key;
    delete figure.pageArea;
    kept.push(figure);
  }

  return { figures: kept, annotations };
}

async function collectPageFigures(page, pageNumber, { pageText, limits, figures, seen, spent }) {
  const info = pageText?.get(pageNumber);
  const view = info?.view || page.view;
  if (!view || view.length !== 4) return;

  const opList = await page.getOperatorList({ annotationMode: AnnotationMode.DISABLE });
  if (opList.fnArray.length > limits.maxOps) return;

  const marks = collectMarks(opList, limits.maxMarks);
  if (!marks.length) return;

  const boxes = info?.boxes || [];
  // With no text of its own the page *is* the picture — a scanned document, a
  // full-bleed plate. Refusing full-page graphics there would hand the reader
  // an empty document.
  const regions = findFigureRegions(marks, boxes, view, { allowFullPage: boxes.length < 5 });

  const pageArea = (view[2] - view[0]) * (view[3] - view[1]);

  for (const region of regions) {
    if (figures.length >= limits.maxFigures) break;
    if (spent.bytes >= limits.maxTotalBytes) break;

    const key = [
      Math.round(region.rect[0] / 6),
      Math.round(region.rect[1] / 6),
      Math.round((region.rect[2] - region.rect[0]) / 6),
      Math.round((region.rect[3] - region.rect[1]) / 6),
    ].join(':');

    const image = await renderRegion(page, region.rect, limits);
    if (!image) continue;

    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key).add(pageNumber);
    spent.bytes += image.bytes || 0;

    figures.push({
      type: 'figure',
      page: pageNumber,
      // The box the figure occupied on the page, kept because the text that
      // falls *inside* it — a chart's axis labels — was already captured in the
      // picture and must not be repeated as prose.
      rect: region.rect,
      // Ordering in the reading flow is by the top edge: a figure belongs
      // above the first paragraph that starts below it.
      y: region.rect[3],
      yBottom: region.rect[1],
      image,
      caption: null,
      text: '',
      key,
      area: region.area,
      pageArea,
    });
  }
}
