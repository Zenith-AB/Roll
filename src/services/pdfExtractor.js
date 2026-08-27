// Legacy build, deliberately: the default build calls Promise.withResolvers()
// (13 times inside the worker alone) without shipping a polyfill, and that API
// only exists from Safari/iOS 17.4. On any older iPhone the worker threw
// immediately and no PDF could ever be read. The legacy bundle ships the
// polyfill in both the main thread and the worker.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractGraphics } from './pdfGraphics.js';
import { orderPageRegions } from './pdfLayout.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

// Safari never got async iteration on ReadableStream. Our own extraction no
// longer depends on it, but pdf.js still has other `for await (… of stream)`
// paths that some documents reach, so install the iterator it is missing.
if (
  typeof ReadableStream !== 'undefined' &&
  !ReadableStream.prototype[Symbol.asyncIterator]
) {
  ReadableStream.prototype[Symbol.asyncIterator] = function () {
    const reader = this.getReader();
    return {
      next: () => reader.read(),
      async return(value) {
        await reader.cancel();
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
}

export async function loadPdfFromFile(file, onProgress) {
  const arrayBuffer = await file.arrayBuffer();
  const base = import.meta.env?.BASE_URL || '/';

  const pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    // Figures are re-rendered through pdf.js rather than lifted out as raw
    // bitmaps, so the font and CMap resources now genuinely matter: without
    // them a chart's axis labels come out as blank boxes, and a CJK document
    // loses its text entirely.
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
  }).promise;

  try {
    return await extractDocument(pdf, onProgress);
  } finally {
    // Tear the worker down once the document has been converted: everything we
    // need is now plain objects and blob URLs, and on a phone holding the
    // parsed PDF as well is what pushes the tab over the memory limit.
    //
    // The document proxy itself has no destroy() in pdf.js 6 — only the
    // loading task can shut the worker down, and calling the wrong one fails
    // silently and leaves the whole parsed PDF resident.
    try {
      if (pdf.loadingTask?.destroy) await pdf.loadingTask.destroy();
      else await pdf.cleanup();
    } catch {
      /* the document is already gone; nothing to release */
    }
  }
}

export async function extractDocument(pdf, onProgress) {
  const { items, pageText } = await collectTextItems(pdf, onProgress);

  // The body size is measured from the raw runs, before anything else, because
  // every layout threshold downstream is a multiple of it.
  const modalFontSize = bodyFontSize(items);
  const ordered = buildOrderedLines(items, modalFontSize, pageText);
  const lines = stripPageFurniture(ordered, pageText);

  const modalLineGap = findModalLineGap(lines);
  const edges = {
    primary: buildEdgeModel(lines.filter((l) => !l.aside), modalFontSize),
    aside: buildEdgeModel(lines.filter((l) => l.aside), modalFontSize),
  };

  // The main text is built as ONE continuous stream across every page, so a
  // paragraph split by a page break is rejoined instead of being cut in two.
  // Asides are built separately (they are self-contained boxes) and slotted
  // back in at the page where they appeared.
  const ctx = { modalFontSize, modalLineGap, edges, pageText };
  const primaryBlocks = buildBlocks(lines.filter((l) => !l.aside), ctx, true);
  const asideBlocks = buildBlocks(lines.filter((l) => l.aside), ctx, false);

  // Figures and author comments are read from the *drawing* side of the PDF,
  // which the text pipeline above cannot see at all. It is done after the text
  // so a failure here still leaves a readable document.
  let figures = [];
  let annotations = [];
  try {
    ({ figures, annotations } = await extractGraphics(pdf, { pageText, onProgress }));
  } catch (err) {
    console.warn('No se pudieron extraer las figuras del PDF:', err);
  }

  const flow = attachFigureCaptions(dropBlocksInsideFigures(primaryBlocks, figures), figures);
  const blocks = orderBlocks(flow, asideBlocks, figures, annotations);
  const cleaned = attachTableCaptions(dropNoiseBlocks(demoteTableRows(blocks)));
  return mergeSplitTables(coalesceAsides(cleaned));
}

// Table rows get styled like headings in many papers ("Procedimental 18 8 26"),
// which promoted them into the outline and rendered them huge. Two or more
// bare numbers in a short line is a data row, not a section title.
function demoteTableRows(blocks) {
  return blocks.map((b) => {
    if (!HEADING_TYPES.has(b.type)) return b;
    if (detectNumberedHeading(b.text)) return b; // "3.2.1. Título" is genuine
    const numbers = b.text.match(/\d+/g) || [];
    return numbers.length >= 2 ? { ...b, type: 'paragraph' } : b;
  });
}

// Sidebars arrive as a run of separate little blocks — a contact box, a set of
// keywords, a pull quote — and one card per line buries them. Merging a page's
// aside blocks into one keeps the box reading as a box.
//
// This used to do the same thing to *any* run of three or more short blocks and
// label the result a table. That was wrong in a way that damaged the most
// important page of every document: an article's title, its authors and their
// affiliations are all short lines, so the front matter was boxed up as tabular
// data, and so was every stretch of prose whose lines happened to be short.
// Anything that is genuinely a table is found by detectTableAt, which has to
// agree with itself about columns before it claims one; anything else is prose
// and now stays prose.
function coalesceAsides(blocks) {
  const out = [];
  let i = 0;

  while (i < blocks.length) {
    const b = blocks[i];

    if (b.aside && b.type !== 'table' && b.type !== 'figure') {
      const group = [b];
      let j = i + 1;
      while (
        j < blocks.length &&
        blocks[j].aside &&
        blocks[j].page === b.page &&
        blocks[j].type !== 'table' &&
        blocks[j].type !== 'figure'
      ) {
        group.push(blocks[j]);
        j++;
      }
      out.push({ ...b, text: group.map((g) => g.text).join('\n') });
      i = j;
      continue;
    }

    out.push(b);
    i++;
  }

  return out;
}

// A long table does not stop at a page break; the PDF just starts drawing it
// again on the next page, often reprinting its header row. Left alone that
// becomes two unrelated tables, the second of them headerless and starting
// mid-thought — which is exactly how the reader met the twelve-week schedule
// and the coding scheme in the test documents.
const MAX_STRAY_BLOCKS_BETWEEN_TABLE_HALVES = 2;

function mergeSplitTables(blocks) {
  const out = [];

  for (const block of blocks) {
    // The two halves are not always adjacent: the last row's text sometimes
    // wraps onto the next page ahead of the rest of the table and arrives as a
    // stray line of its own. Looking back past a couple of short strays is what
    // lets the halves find each other; the strays keep their content and are
    // re-emitted after the table they came from.
    const anchor = findTableToContinue(out, block);
    if (anchor < 0) {
      out.push(block);
      continue;
    }

    const previous = out[anchor];
    const strays = out.splice(anchor + 1);
    const header = previous.header ? previous.rows[0] : null;
    const rows = block.rows.filter(
      (row, index) => !(index === 0 && header && sameRow(row, header))
    );

    out[anchor] = {
      ...previous,
      rows: [...previous.rows, ...rows],
      text: [previous.text, rows.map((r) => r.filter(Boolean).join(' · ')).join('\n')]
        .filter(Boolean)
        .join('\n'),
    };
    out.push(...strays);
  }

  return out;
}

function findTableToContinue(out, block) {
  if (block.type !== 'table' || !block.rows?.length) return -1;

  for (let i = out.length - 1, skipped = 0; i >= 0; i--, skipped++) {
    if (skipped > MAX_STRAY_BLOCKS_BETWEEN_TABLE_HALVES) return -1;

    const candidate = out[i];
    if (candidate.type === 'table' && candidate.rows?.length) {
      const continues =
        candidate.rows[0].length === block.rows[0].length &&
        block.page === candidate.page + 1 &&
        candidate.aside === block.aside;
      return continues ? i : -1;
    }

    // Only a short leftover may sit between the halves; a real paragraph means
    // the tables are genuinely separate.
    const isStray =
      (candidate.type === 'paragraph' || candidate.type === 'verse') &&
      candidate.text.length <= 100;
    if (!isStray) return -1;
  }

  return -1;
}

function sameRow(a, b) {
  if (a.length !== b.length) return false;
  return a.every((cell, i) => cell.trim().toLowerCase() === b[i].trim().toLowerCase());
}

// Page furniture — a running header/footer reprinted on every page, and bare
// page numbers — is layout scaffolding, not content. Removing it at the line
// level (before paragraphs are assembled) is what lets a paragraph flow
// uninterrupted across a page boundary.
function stripPageFurniture(lines, pageText) {
  // A running head usually carries the page number, so no two pages print it
  // identically: "206 LENGUAS MODERNAS 61" and "208 LENGUAS MODERNAS 61" are
  // the same furniture but not the same string. Comparing with the digits
  // blanked out is what recognises them as one thing — and the margin test
  // keeps that from eating a real sentence that merely repeats.
  const skeleton = (text) => text.replace(/\d+/g, '#');

  const pagesByText = new Map();
  const pagesBySkeleton = new Map();
  for (const l of lines) {
    const key = l.text.trim();
    if (!key) continue;
    if (!pagesByText.has(key)) pagesByText.set(key, new Set());
    pagesByText.get(key).add(l.page);
    const shape = skeleton(key);
    if (!pagesBySkeleton.has(shape)) pagesBySkeleton.set(shape, new Set());
    pagesBySkeleton.get(shape).add(l.page);
  }

  return lines.filter((l) => {
    const t = l.text.trim();
    if (!t) return false;
    if (/^\d{1,4}$/.test(t)) return false; // standalone page number
    // "Página 7" changes on every page, so the repeated-text rule below never
    // catches it and it ends up quoted in the middle of the reading flow.
    if (/^(p[áa]g(?:ina)?\.?|page|p\.)\s*\d{1,4}$/i.test(t)) return false;
    if ((pagesByText.get(t)?.size ?? 0) >= 3) return false; // reprinted verbatim
    if ((pagesBySkeleton.get(skeleton(t))?.size ?? 0) >= 3 && inPageMargin(l, pageText)) {
      return false;
    }
    return true;
  });
}

// Top and bottom strips of the page, where running heads and feet live.
function inPageMargin(line, pageText) {
  const view = pageText?.get(line.page)?.view;
  if (!view) return false;
  const height = view[3] - view[1];
  if (height <= 0) return false;
  const position = (line.y - view[1]) / height;
  return position > 0.9 || position < 0.08;
}

// Puts one page's material back in reading order. Figures are floats: they
// belong above the first block of running text that starts below them, which is
// where the reader would have met them on paper. Asides and author comments are
// self-contained boxes and go after the page's prose, since on a phone there is
// no margin to put them in.
function orderBlocks(primary, aside, figures, annotations) {
  const groupByPage = (list) => {
    const map = new Map();
    for (const b of list) {
      if (!map.has(b.page)) map.set(b.page, []);
      map.get(b.page).push(b);
    }
    return map;
  };

  const flowPages = groupByPage(primary);
  const asidePages = groupByPage(aside);
  const figurePages = groupByPage(figures);
  const commentPages = groupByPage(annotations);

  const pages = new Set();
  for (const list of [primary, aside, figures, annotations]) {
    for (const b of list) pages.add(b.page);
  }

  const out = [];
  for (const page of [...pages].sort((a, b) => a - b)) {
    const flow = flowPages.get(page) || [];
    const floats = [...(figurePages.get(page) || [])].sort((a, b) => b.y - a.y);

    let f = 0;
    for (const block of flow) {
      while (f < floats.length && block.y != null && floats[f].y > block.y) {
        out.push(floats[f++]);
      }
      out.push(block);
    }
    while (f < floats.length) out.push(floats[f++]);

    out.push(...(asidePages.get(page) || []));
    out.push(...[...(commentPages.get(page) || [])].sort((a, b) => b.y - a.y));
  }

  return out;
}

// Stray table cells and math fragments ("13", "x") survive as one- or
// zero-letter blocks and just add noise to a reading view.
function dropNoiseBlocks(blocks) {
  return blocks.filter((b) => {
    if (b.type === 'figure' || b.type === 'table' || b.type === 'annotation') return true;
    return (b.text.match(/\p{L}/gu) || []).length >= 2;
  });
}

// Some embedded PDF fonts map ligature glyphs (ti, tt, fí…) to unrelated
// Unicode code points because their ToUnicode CMap is broken/partial. This
// shows up as garbage like "gesƟón" or "hƩp" instead of "gestión" / "http".
// The mapping below was reverse-engineered from a real affected document —
// each code point consistently stands for the same ligature everywhere.
const LIGATURE_FIXES = [
  [/Ɵ/g, 'ti'],
  [/ơ/g, 'tí'],
  [/Ʃ/g, 'tt'],
  [/İ/g, 'fí'],
  [/Ō/g, 'ft'],
  [/„/g, ','],
];

function repairLigatures(str) {
  let out = str;
  for (const [pattern, replacement] of LIGATURE_FIXES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// Safari (all versions, iOS 18 included) does not implement
// ReadableStream[Symbol.asyncIterator], and pdf.js's getTextContent() consumes
// its own stream with `for await (const chunk of stream)`. On iPhone that threw
// "undefined is not a function (near '...e of t...')" the instant a PDF was
// opened — the app loaded fine and then nothing could ever be extracted.
// Driving the reader by hand works on every engine.
async function readTextItems(page) {
  if (typeof page.streamTextContent !== 'function') {
    return (await page.getTextContent()).items;
  }
  const reader = page.streamTextContent().getReader();
  const items = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    // push one by one: spreading a huge chunk can overflow the call stack
    for (const item of value?.items || []) items.push(item);
  }
  return items;
}

// Collects every text run, and alongside it the box each run occupies. Those
// boxes are what later tells a chart apart from a bordered paragraph: a region
// of the page that is mostly covered by text is not a figure, however many
// lines are drawn around it.
async function collectTextItems(pdf, onProgress) {
  const items = [];
  const pageText = new Map();

  for (let i = 1; i <= pdf.numPages; i++) {
    onProgress?.({ phase: 'text', page: i, total: pdf.numPages });

    const page = await pdf.getPage(i);
    const view = Array.isArray(page.view) && page.view.length === 4
      ? [...page.view]
      : [0, 0, 612, 792];
    const boxes = [];

    for (const item of await readTextItems(page)) {
      if (!item.str || !item.str.trim()) continue;
      const fontSize = Math.hypot(item.transform[0], item.transform[1]);
      const x = item.transform[4];
      const y = item.transform[5];
      const width = item.width ?? 0;

      items.push({
        str: repairLigatures(item.str),
        x,
        y,
        width,
        fontSize,
        font: item.fontName || '',
        page: i,
      });
      boxes.push([x, y - fontSize * 0.25, x + width, y + fontSize * 0.9]);
    }

    pageText.set(i, { view, boxes });
  }

  return { items, pageText };
}

// Body text size, measured from the raw runs and weighted by how much text
// each run carries, so a page of large headings cannot outvote the prose.
function bodyFontSize(items) {
  const counts = new Map();
  for (const it of items) {
    const key = Math.round(it.fontSize * 10) / 10;
    counts.set(key, (counts.get(key) || 0) + it.str.length);
  }
  let best = 12;
  let bestWeight = 0;
  counts.forEach((weight, key) => {
    if (weight > bestWeight) {
      bestWeight = weight;
      best = key;
    }
  });
  return best || 12;
}

// Runs the layout analysis page by page and flattens the result into one
// document-order list of lines. Reading order is settled here and never
// revisited: everything downstream can treat `lines` as the text of the
// document, in the order a person would read it.
function buildOrderedLines(items, modalFontSize, pageText) {
  const byPage = new Map();
  for (const it of items) {
    if (!byPage.has(it.page)) byPage.set(it.page, []);
    byPage.get(it.page).push(it);
  }

  const lines = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const view = pageText?.get(page)?.view;
    for (const region of orderPageRegions(byPage.get(page), modalFontSize, view)) {
      for (const line of groupIntoLines(region.items)) {
        line.aside = region.aside;
        // The region's own margins, not the page's: an indented first line and
        // a line that runs to the margin are both judged against the column
        // the line actually lives in.
        line.regionLeft = region.rect[0];
        line.regionRight = region.rect[2];
        lines.push(line);
      }
    }
  }
  return lines;
}

// Groups a region's text runs into visual lines (runs sharing a baseline).
// The region is already a single column, so there is no gutter to respect and
// no risk of fusing a sidebar line with whatever sits at the same height in the
// main text.
function groupIntoLines(items) {
  const sorted = [...items].sort((a, b) => {
    const yDiff = b.y - a.y;
    if (Math.abs(yDiff) > 5) return yDiff;
    return a.x - b.x;
  });

  const lines = [];
  let current = null;

  for (const item of sorted) {
    const sameLine = current && Math.abs(item.y - current.y) <= item.fontSize * 0.4;
    if (sameLine) {
      current.items.push(item);
    } else {
      if (current) lines.push(finalizeLine(current));
      current = { items: [item], page: item.page, y: item.y };
    }
  }
  if (current) lines.push(finalizeLine(current));
  return lines;
}

function finalizeLine(line) {
  const items = line.items;
  const fontSize = Math.round((items[0]?.fontSize || 0) * 10) / 10;
  const font = items[0]?.font || '';
  const text = items
    .map((it) => it.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    text,
    fontSize,
    font,
    // The same line split at its wide internal gaps. On prose this is always a
    // single cell; two or more is the raw signal a table is built from.
    cells: splitCells(items, fontSize),
    // Reduce rather than spread: a pathological PDF can put thousands of runs
    // on one baseline, and Math.min(...huge) blows the call stack.
    xLeft: items.reduce((m, it) => Math.min(m, it.x), Infinity),
    xRight: items.reduce((m, it) => Math.max(m, it.x + it.width), -Infinity),
    y: line.y,
    page: line.page,
    itemCount: items.length,
  };
}

// ── Tables ──────────────────────────────────────────────────────────────────

// A gap has to be much wider than word spacing to mean "new cell". Justified
// prose stretches its spaces, so the threshold is set above anything word
// spacing plausibly produces — roughly one and a third characters of blank.
function splitCells(items, fontSize) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const minGap = Math.max(fontSize * 1.35, 7);

  const cells = [];
  let current = null;

  for (const it of sorted) {
    const text = it.str.trim();
    if (!text) continue;
    const end = it.x + (it.width || 0);

    if (current && it.x - current.xEnd < minGap) {
      current.parts.push(text);
      current.xEnd = Math.max(current.xEnd, end);
    } else {
      if (current) cells.push(current);
      current = { x: it.x, xEnd: end, parts: [text] };
    }
  }
  if (current) cells.push(current);

  return cells
    .map((c) => ({
      x: c.x,
      xEnd: c.xEnd,
      text: c.parts.join(' ').replace(/\s+/g, ' ').trim(),
    }))
    .filter((c) => c.text);
}

const TABLE_MIN_ROWS = 3;
const TABLE_MAX_COLUMNS = 14;

// Columns are found by clustering every cell's left edge across the whole
// candidate block. Alignment down the block is the thing that separates a real
// table from prose that happened to break with a wide gap: a stray gap lands
// somewhere different on every line, a column lands in the same place on all
// of them.
function clusterColumns(rows, fontSize) {
  const tolerance = Math.max(fontSize * 1.6, 9);
  const points = [];
  rows.forEach((row, r) => row.cells.forEach((c) => points.push({ x: c.x, row: r })));
  if (!points.length) return [];
  points.sort((a, b) => a.x - b.x);

  const clusters = [];
  let current = null;
  for (const p of points) {
    if (current && p.x - current.last <= tolerance) {
      current.sum += p.x;
      current.n++;
      current.last = p.x;
      current.rows.add(p.row);
    } else {
      if (current) clusters.push(current);
      current = { sum: p.x, n: 1, last: p.x, rows: new Set([p.row]) };
    }
  }
  if (current) clusters.push(current);

  return clusters
    .filter((c) => c.rows.size >= 2) // a column that appears once is a stray gap
    .map((c) => ({ x: c.sum / c.n }))
    .sort((a, b) => a.x - b.x);
}

// Many tables mark an empty cell with a dash, a bullet or a row of dots rather
// than leaving it blank. Carried through literally those become "- -" values
// that say nothing, and on a phone each one costs a labelled line of its own.
const PLACEHOLDER_CELL = /^[\s\-–—_.·•*]+$/;

function normalizeCell(text) {
  return PLACEHOLDER_CELL.test(text) ? '' : text;
}

function toGrid(rows, columns) {
  return rows.map((row) => {
    const cells = new Array(columns.length).fill('');
    for (const cell of row.cells) {
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < columns.length; i++) {
        const distance = Math.abs(columns[i].x - cell.x);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      cells[best] = cells[best] ? `${cells[best]} ${cell.text}` : cell.text;
    }
    return cells.map(normalizeCell);
  });
}

const NUMERIC_CELL = /^[\d\s.,%()+\-–—/$€:]+$/;

// A cell whose text is longer than its column is wide wraps onto further
// baselines, and each of those baselines looks like another row. The giveaway
// is that the continuation has nothing in the first column: a real new row
// starts by naming itself. Folding them back is the difference between a table
// that reads as sentences in cells and one shredded into fragments.
function mergeWrappedRows(grid) {
  const out = [];

  for (const row of grid) {
    const previous = out[out.length - 1];
    const isContinuation = previous && !row[0] && previous[0] && row.some(Boolean);

    if (isContinuation) {
      for (let c = 0; c < row.length; c++) {
        if (!row[c]) continue;
        previous[c] = previous[c] ? `${previous[c]} ${row[c]}` : row[c];
      }
      continue;
    }

    out.push([...row]);
  }

  return out;
}

// A header row names the columns instead of holding data. Three independent
// tells, because documents disagree about which one they use: it is set in a
// larger face than the body; it is all words where the body holds figures; or
// its cells are all short labels above cells that are not.
function looksLikeHeaderRow(grid, headerLine, bodyLine) {
  if (grid.length < 2) return false;
  const first = grid[0].filter(Boolean);
  if (first.length < 2) return false;
  if (first.some((cell) => NUMERIC_CELL.test(cell))) return false;

  const headerFontSize = headerLine?.fontSize;
  const bodyFontSize = bodyLine?.fontSize;
  if (headerFontSize != null && bodyFontSize != null && headerFontSize > bodyFontSize + 0.4) {
    return true;
  }

  // Same size, different face: the overwhelmingly common way a header row is
  // set apart, and invisible to a size comparison.
  if (headerLine?.font && bodyLine?.font && headerLine.font !== bodyLine.font) {
    return true;
  }

  if (grid.slice(1).some((row) => row.some((cell) => cell && NUMERIC_CELL.test(cell)))) {
    return true;
  }

  const labelsAreShort = first.every((cell) => cell.length <= 34);
  const bodyIsLonger = grid.slice(1).some((row) => row.some((cell) => cell.length > 34));
  return labelsAreShort && bodyIsLonger;
}

/**
 * Tries to read a real table starting at `lines[start]`.
 *
 * Returns null far more often than not, and that is the point: a false positive
 * shreds a paragraph into a grid of nonsense, which is much worse than a table
 * that stays plain text. Hence three independent agreements are required —
 * enough rows, columns that line up, and a column count that repeats.
 */
function detectTableAt(lines, start, ctx, cache) {
  const cached = cache?.get(start);
  if (cached !== undefined) return cached;
  const result = detectTable(lines, start, ctx);
  cache?.set(start, result);
  return result;
}

function detectTable(lines, start, ctx) {
  const first = lines[start];
  if (!first?.cells || first.cells.length < 2) return null;

  const rows = [];
  const leftEdge = first.cells[0].x;
  const columnTolerance = Math.max(first.fontSize * 1.6, 9);
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.text) {
      i++;
      continue;
    }
    if (line.page !== first.page) break;
    if (detectNumberedHeading(line.text)) break;
    // The first row is allowed to be styled like a heading — that is exactly
    // what a bold column-header row looks like to the font-size test.
    if (rows.length && isHeadingLine(line, ctx.modalFontSize)) break;

    if (line.cells.length < 2) {
      // One cell on a baseline is normally prose. Inside a table it is the
      // tail of a wrapped cell whose neighbours happened to fit on one line —
      // and refusing it here truncated real tables to two rows and threw the
      // rest back into the prose. What distinguishes the two is where it
      // starts: prose returns to the left margin, a wrapped cell stays out in
      // its own column.
      if (!rows.length) break;
      if (Math.abs(line.cells[0].x - leftEdge) <= columnTolerance) break;
    }

    // Size consistency is measured against the *body* rows, so a larger header
    // row does not end the table at its second line.
    const sizeRef = rows.length >= 2 ? rows[1].fontSize : null;
    if (sizeRef != null && Math.abs(line.fontSize - sizeRef) > 1.2) break;

    if (rows.length) {
      const previous = rows[rows.length - 1];
      const gap = previous.y - line.y;
      const gapRef = ctx.modalLineGap || first.fontSize * 1.2;
      if (gap <= 0 || gap > gapRef * 3) break; // a blank band ends the table
    }

    rows.push(line);
    i++;
  }

  if (rows.length < TABLE_MIN_ROWS) return null;

  const columns = clusterColumns(rows, first.fontSize);
  if (columns.length < 2 || columns.length > TABLE_MAX_COLUMNS) return null;

  // Wrapped cells are folded back *before* the grid is judged. Measured on the
  // raw baselines the same table looks ragged — a four-row table whose cells
  // wrap has rows of three, two, one and two cells — and the consistency test
  // below then throws away exactly the dense, interesting tables it should be
  // keeping.
  const grid = mergeWrappedRows(toGrid(rows, columns));

  // Folding the continuations back can reveal that what looked like a table was
  // really one wrapped line, which is not a table at all. Two rows are only
  // convincing when there are at least three columns to line up.
  if (grid.length < 2) return null;
  if (grid.length < 3 && columns.length < 3) return null;

  const populated = grid.filter((row) => row.filter(Boolean).length >= 2).length;
  if (populated / grid.length < 0.7) return null;

  const counts = grid.map((row) => row.filter(Boolean).length);
  const modalCount = mode(counts, 1);
  if (modalCount < 2) return null;
  if (counts.filter((c) => c === modalCount).length / counts.length < 0.6) return null;

  const header = looksLikeHeaderRow(grid, rows[0], rows[1]);

  return {
    end: i,
    block: {
      type: 'table',
      rows: grid,
      header,
      caption: null,
      page: first.page,
      aside: first.aside,
      y: first.y,
      fontSize: first.fontSize,
      xLeft: rows.reduce((m, l) => Math.min(m, l.xLeft), Infinity),
      xRight: rows.reduce((m, l) => Math.max(m, l.xRight), -Infinity),
      // A flat text form is kept alongside the grid so search, the word count
      // and text selection keep working on tables exactly as on prose.
      text: grid.map((row) => row.filter(Boolean).join(' · ')).join('\n'),
    },
  };
}

// ── Captions and footnotes ──────────────────────────────────────────────────

const CAPTION_RE =
  /^\s*(fig(?:ura|\.)?|tabla|cuadro|gr[áa]fic[oa]|imagen|ilustraci[óo]n|foto(?:graf[íi]a)?|esquema|mapa|anexo|l[áa]mina|diagrama|table|figure|chart|plate)\s*\.?\s*(\d{1,3}|[ivxlc]{1,6})?\s*[.:)–—-]?\s+\S/i;

const CAPTION_MAX_CHARS = 400;

function detectCaption(text) {
  return text.length <= CAPTION_MAX_CHARS && CAPTION_RE.test(text);
}

// Footnotes and editor's notes are set smaller than the body and sit at the
// foot of the page. Both signals are needed: small type in the middle of a page
// is a table cell or a caption, and body-size type at the bottom is just the
// last paragraph.
function detectFootnote(run, ctx) {
  const line = run[0];
  if (line.fontSize > ctx.modalFontSize * 0.9) return false;

  const view = ctx.pageText?.get(line.page)?.view;
  if (!view) return false;
  const height = view[3] - view[1];
  if (height <= 0) return false;

  return (line.y - view[1]) / height < 0.26;
}

const HEADING_TYPES = new Set(['heading', 'subheading', 'subheading2']);

// A chart carries its own axis labels, legend and value callouts *inside* the
// picture. Those same runs also reach the text pipeline, where they arrive as
// meaningless little tables and stanzas of percentages sitting next to a figure
// that already shows them. Anything short enough to be a label and sitting
// inside a figure's box has therefore already been delivered to the reader.
const LABEL_MAX_CHARS = 200;

function dropBlocksInsideFigures(blocks, figures) {
  if (!figures.length) return blocks;

  const byPage = new Map();
  for (const figure of figures) {
    if (!figure.rect) continue;
    if (!byPage.has(figure.page)) byPage.set(figure.page, []);
    byPage.get(figure.page).push(figure);
  }
  if (!byPage.size) return blocks;

  return blocks.filter((block) => {
    if (block.type === 'figure' || block.type === 'annotation') return true;
    if (block.y == null || !Number.isFinite(block.xLeft)) return true;
    // A chart's axis ticks and legend add up to a lot of characters between
    // them, so the length limit only guards prose — a "table" or a stanza of
    // labels sitting inside a figure is the figure's own lettering however
    // long it is.
    const isLabelShaped = block.type === 'table' || block.type === 'verse';
    if (!isLabelShaped && block.text.length > LABEL_MAX_CHARS) return true;

    const centre = (block.xLeft + block.xRight) / 2;
    const covering = byPage.get(block.page) || [];
    return !covering.some(
      ({ rect }) =>
        block.y >= rect[1] &&
        block.y <= rect[3] &&
        centre >= rect[0] &&
        centre <= rect[2]
    );
  });
}

// A caption names the figure it sits under (or, for tables, above it). Pairing
// them up here is what lets the caption be rendered as a real `<figcaption>`
// belonging to the picture, instead of an orphan sentence floating in the text.
function attachFigureCaptions(blocks, figures) {
  if (!figures.length) return blocks;

  const candidatesByPage = new Map();
  blocks.forEach((block, index) => {
    if (block.type !== 'caption') return;
    if (!candidatesByPage.has(block.page)) candidatesByPage.set(block.page, []);
    candidatesByPage.get(block.page).push(index);
  });

  const used = new Set();

  for (const figure of figures) {
    const candidates = candidatesByPage.get(figure.page) || [];
    let bestIndex = -1;
    let bestDistance = Infinity;

    for (const index of candidates) {
      if (used.has(index)) continue;
      const block = blocks[index];
      if (block.y == null) continue;

      const distance =
        block.y <= figure.yBottom ? figure.yBottom - block.y : block.y - figure.y;
      if (distance < 0 || distance > 90) continue;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0) {
      figure.caption = blocks[bestIndex].text;
      figure.text = blocks[bestIndex].text;
      used.add(bestIndex);
    }
  }

  return blocks.filter((_, index) => !used.has(index));
}

// The same pairing for tables, done on the final flow: a table's caption is
// whichever caption block ended up immediately next to it.
function attachTableCaptions(blocks) {
  const consumed = new Set();

  const result = blocks.map((block, index) => {
    if (block.type !== 'table' || block.caption) return block;

    const before = blocks[index - 1];
    if (before?.type === 'caption' && before.page === block.page && !consumed.has(index - 1)) {
      consumed.add(index - 1);
      return { ...block, caption: before.text };
    }

    const after = blocks[index + 1];
    if (after?.type === 'caption' && after.page === block.page && !consumed.has(index + 1)) {
      consumed.add(index + 1);
      return { ...block, caption: after.text };
    }

    return block;
  });

  return result.filter((_, index) => !consumed.has(index));
}

// ── Layout metrics ──────────────────────────────────────────────────────────

function mode(values, precision = 1) {
  const counts = new Map();
  for (const v of values) {
    const key = Math.round(v * precision) / precision;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let bestKey = 0;
  let bestCount = 0;
  counts.forEach((count, key) => {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  });
  return bestKey;
}

// Most common gap between consecutive same-size lines in the same region —
// the document's single-line-spacing baseline, whatever the PDF's actual
// leading is.
function findModalLineGap(lines) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const next = lines[i];
    if (prev.page !== next.page || prev.aside !== next.aside) continue;
    if (Math.abs(prev.fontSize - next.fontSize) > 0.5) continue;
    const gap = prev.y - next.y;
    if (gap > 0 && gap < prev.fontSize * 4) gaps.push(gap);
  }
  return gaps.length ? mode(gaps, 2) : null;
}

// Where a column's body text starts and ends. Indentation (a new paragraph)
// and running to the margin (a wrapped line rather than a deliberate break)
// are both judged against these, so getting them wrong scrambles paragraphs.
//
// A document can have more than one measure — two columns, a wide abstract over
// a narrow body, an indented block quote — so the left edges are clustered and
// each line is later matched to the one it actually belongs to. A single global
// pair, which is what this used to be, silently mis-judged every line that did
// not live in the dominant column.
function buildEdgeModel(lines, modalFontSize) {
  const body = lines.filter((l) => Math.abs(l.fontSize - modalFontSize) <= 0.5);
  const global = {
    left: body.length ? mode(body.map((l) => l.xLeft), 1) : null,
    right: body.length ? percentile(body.map((l) => l.xRight), 0.75) : null,
  };
  if (body.length < 12) return { global, clusters: [], tolerance: modalFontSize * 4 };

  const tolerance = modalFontSize * 2.5;
  const sorted = [...body].sort((a, b) => a.xLeft - b.xLeft);
  const groups = [];
  let current = null;

  for (const line of sorted) {
    if (current && line.xLeft - current.last <= tolerance) {
      current.lines.push(line);
      current.last = line.xLeft;
    } else {
      if (current) groups.push(current);
      current = { lines: [line], last: line.xLeft };
    }
  }
  if (current) groups.push(current);

  const clusters = groups
    .filter((g) => g.lines.length >= 8)
    .map((g) => ({
      left: mode(g.lines.map((l) => l.xLeft), 1),
      right: percentile(g.lines.map((l) => l.xRight), 0.75),
    }))
    .sort((a, b) => a.left - b.left);

  return { global, clusters, tolerance: modalFontSize * 4 };
}

// The measure a given line belongs to. A line's own region is the best answer
// when the layout analysis found one; otherwise fall back to the nearest
// measured column, and to the document-wide one if nothing is close.
function edgeFor(line, model) {
  if (!model) return {};
  if (line.regionLeft != null && line.regionRight != null) {
    const width = line.regionRight - line.regionLeft;
    // A region that is only as wide as the line itself tells us nothing about
    // where the margin is; that happens when a band contains a single short
    // line. Only trust a region wide enough to hold a real measure.
    if (width > model.tolerance * 2) {
      return { left: line.regionLeft, right: line.regionRight };
    }
  }

  let best = null;
  let bestDistance = Infinity;
  for (const cluster of model.clusters) {
    const distance = Math.abs(cluster.left - line.xLeft);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cluster;
    }
  }
  if (best && bestDistance <= model.tolerance) return best;
  return model.global;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction));
  return sorted[index];
}

// A bare number or punctuation fragment (a stray table cell value, a page
// number) should never register as a heading, no matter its font size.
function looksLikeHeadingText(text) {
  return /\p{L}/u.test(text);
}

function isHeadingLine(line, modalFontSize) {
  return (
    line.fontSize > modalFontSize * 1.18 &&
    // Measured in characters, not in text runs: a document's own title is set
    // large and often arrives as thirty separate runs, and counting runs threw
    // it out of the outline for being "too complex" to be a heading.
    line.text.length <= 160 &&
    line.itemCount <= 40 &&
    looksLikeHeadingText(line.text)
  );
}

// Section numbering ("1.", "2.1.", "3.2.1.") is a far more reliable heading
// signal than font size — many academic PDFs style numbered headers at body
// size, and this also recovers the document's real nesting depth. Capped at
// 2 digits per segment so it can't mistake a 4-digit year or a footnote
// marker glued to the next word (no period) for a heading.
const HEADING_TYPES_BY_DEPTH = { 1: 'heading', 2: 'subheading', 3: 'subheading2' };

function detectNumberedHeading(text) {
  const match = text.match(/^(\d{1,2}(?:\.\d{1,2}){0,2})\.\s+(.{2,140})$/);
  if (!match) return null;
  const depth = match[1].split('.').length;
  const type = HEADING_TYPES_BY_DEPTH[depth];
  if (!type) return null;
  return { type, text: `${match[1]}. ${match[2]}` };
}

// Walks the line list, fusing wrapped prose lines into flowing paragraphs
// while keeping intentional line breaks (verse/poetry) intact.
function buildBlocks(lines, ctx, allowCrossPage) {
  const { modalFontSize, modalLineGap, edges } = ctx;
  const blocks = [];
  // Each line is probed for a table twice — once as a possible start, once by
  // the paragraph loop looking ahead — and the probe scans forward from there.
  // Remembering the answer keeps that from turning quadratic on a document that
  // is mostly two-column lines.
  const tableCache = new Map();
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.text) {
      i++;
      continue;
    }

    // Tables are checked first, and only ever claim a run of lines that agrees
    // with itself on columns — see detectTableAt. Anything it declines falls
    // through to the ordinary paragraph machinery untouched.
    const table = detectTableAt(lines, i, ctx, tableCache);
    if (table) {
      blocks.push(table.block);
      i = table.end;
      continue;
    }

    const numbered = detectNumberedHeading(line.text);
    if (numbered || isHeadingLine(line, modalFontSize)) {
      // A heading that wrapped onto a second line must be rejoined, or the
      // outline shows a truncated title and an orphan word ("…inicial de" /
      // "profesores"). Only a short trailing line is absorbed, so the
      // paragraph that follows a heading is never swallowed.
      const parts = [line];
      let k = i + 1;
      const headEdge = edgeFor(line, line.aside ? edges.aside : edges.primary);
      while (k < lines.length) {
        const nx = lines[k];
        if (!nx.text) { k++; continue; }
        const prevPart = parts[parts.length - 1];
        if (nx.page !== prevPart.page) break;
        if (Math.abs(nx.fontSize - prevPart.fontSize) > 0.5) break;
        if (detectNumberedHeading(nx.text)) break;
        const gap = prevPart.y - nx.y;
        const gapRef = modalLineGap || prevPart.fontSize * 1.2;
        if (gap <= 0 || gap > gapRef * 1.8) break;
        if (headEdge.right == null) break;
        const prevWrapped = prevPart.xRight >= headEdge.right - prevPart.fontSize * 6;
        const nxIsShort = nx.xRight < headEdge.right - nx.fontSize * 6;
        if (!prevWrapped || !nxIsShort) break;
        parts.push(nx);
        k++;
        break; // one continuation line is enough
      }

      const headingText = parts.map((p) => p.text).join(' ');
      const rejoined = parts.length > 1 ? detectNumberedHeading(headingText) : numbered;
      blocks.push({
        text: rejoined ? rejoined.text : headingText,
        type: rejoined ? rejoined.type : 'heading',
        page: line.page,
        aside: line.aside,
        y: line.y,
        fontSize: line.fontSize,
        xLeft: Math.min(...parts.map((p) => p.xLeft)),
        xRight: Math.max(...parts.map((p) => p.xRight)),
      });
      i = k;
      continue;
    }

    const run = [line];
    const joins = [];
    let j = i + 1;

    while (j < lines.length) {
      const next = lines[j];
      if (!next.text) {
        j++;
        continue;
      }
      if (isHeadingLine(next, modalFontSize) || detectNumberedHeading(next.text)) break;
      // Stop before a table rather than absorbing its header row into the
      // paragraph above it — the table would then start at its second row and
      // lose the line that names its columns.
      if (next.cells.length >= 2 && detectTableAt(lines, j, ctx, tableCache)) break;

      const prev = run[run.length - 1];
      if (Math.abs(prev.fontSize - next.fontSize) > 0.5) break;

      const bodyEdge = edgeFor(next, next.aside ? edges.aside : edges.primary);
      const isIndented =
        bodyEdge.left != null && next.xLeft > bodyEdge.left + next.fontSize * 0.6;
      if (isIndented) break; // new paragraph start, no blank line needed

      const reachesMargin =
        bodyEdge.right != null && prev.xRight >= bodyEdge.right - prev.fontSize * 3;
      const isHyphenBreak =
        reachesMargin && /\p{L}-$/u.test(prev.text) && /^\p{Ll}/u.test(next.text);

      if (next.page === prev.page) {
        const gap = prev.y - next.y;
        if (gap <= 0) break;
        const gapRef = modalLineGap || prev.fontSize * 1.2;
        if (gap > gapRef * 1.6) break; // blank line — paragraph/stanza break
        joins.push(isHyphenBreak ? 'hyphen' : reachesMargin ? 'space' : 'break');
      } else if (allowCrossPage && next.page > prev.page) {
        // Rejoin a paragraph the PDF split across a page break, but only when
        // the previous page truly ended mid-paragraph: its last line ran to
        // the margin and didn't close a sentence.
        if (!reachesMargin) break;
        if (/[.!?:;]["'”’)\]]?$/.test(prev.text)) break;
        joins.push(isHyphenBreak ? 'hyphen' : 'space');
      } else {
        break;
      }

      run.push(next);
      j++;
    }

    // Undo the PDF's own end-of-line hyphenation ("documen-" + "tada" ->
    // "documentada") instead of leaving the hyphen and a space in reflowed text.
    const text = run.reduce((acc, ln, idx) => {
      if (idx === 0) return ln.text;
      const join = joins[idx - 1];
      if (join === 'hyphen') return acc.slice(0, -1) + ln.text;
      return acc + (join === 'break' ? '\n' : ' ') + ln.text;
    }, '');

    // A single trailing short line (e.g. a "Keywords:" line after an
    // abstract) shouldn't flip an otherwise-flowing paragraph into verse —
    // only treat it as verse when line breaks are the dominant pattern.
    const breakRatio = joins.length ? joins.filter((j) => j === 'break').length / joins.length : 0;
    const isVerse = breakRatio >= 0.4;

    // Note: smaller-than-body text is NOT a subheading — in a PDF that means
    // footnotes, captions, table cells and reference lists. Treating it as one
    // filled the outline with fragments. Subheadings come from section
    // numbering or a larger font, both handled above.
    if (text) {
      let type = isVerse ? 'verse' : 'paragraph';
      // Both of these keep their own tag downstream (`<figcaption>` once paired
      // with its figure, `<aside>` for a note), which is the whole point of
      // recognising them: the reader can tell a caption from the prose, and a
      // screen reader announces it as one.
      if (run.length <= 4 && detectCaption(text)) type = 'caption';
      else if (detectFootnote(run, ctx)) type = 'note';

      blocks.push({
        text,
        type,
        page: run[0].page,
        aside: run[0].aside,
        y: run[0].y,
        fontSize: run[0].fontSize,
        xLeft: run.reduce((m, l) => Math.min(m, l.xLeft), Infinity),
        xRight: run.reduce((m, l) => Math.max(m, l.xRight), -Infinity),
      });
    }

    i = j;
  }

  return blocks;
}
