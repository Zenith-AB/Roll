// Legacy build, deliberately: the default build calls Promise.withResolvers()
// (13 times inside the worker alone) without shipping a polyfill, and that API
// only exists from Safari/iOS 17.4. On any older iPhone the worker threw
// immediately and no PDF could ever be read. The legacy bundle ships the
// polyfill in both the main thread and the worker.
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export async function loadPdfFromFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return extractDocument(pdf);
}

export async function extractDocument(pdf) {
  const items = await collectTextItems(pdf);
  if (!items.length) return [];

  // Two passes: a naive line grouping (no columns) is needed to *verify* a
  // candidate gutter before trusting it, otherwise a false positive slices
  // ordinary prose lines in half and scatters their right-hand halves.
  const naiveLines = groupIntoLines(items, new Map());
  if (!naiveLines.length) return [];
  const gutterByPage = validateGutters(computeGutters(items), naiveLines);

  const rawLines = groupIntoLines(items, gutterByPage);
  if (!rawLines.length) return [];

  const ordered = assignReadingOrder(rawLines);
  const lines = stripPageFurniture(ordered);
  if (!lines.length) return [];

  const modalFontSize = mode(lines.map((l) => l.fontSize), 10) || 12;
  const modalLineGap = findModalLineGap(lines);
  const edges = {
    primary: bodyEdges(lines.filter((l) => !l.aside), modalFontSize),
    aside: bodyEdges(lines.filter((l) => l.aside), modalFontSize),
  };

  // The main text is built as ONE continuous stream across every page, so a
  // paragraph split by a page break is rejoined instead of being cut in two.
  // Asides are built separately (they are self-contained boxes) and slotted
  // back in at the page where they appeared.
  const ctx = { modalFontSize, modalLineGap, edges };
  const primaryBlocks = buildBlocks(lines.filter((l) => !l.aside), ctx, true);
  const asideBlocks = buildBlocks(lines.filter((l) => l.aside), ctx, false);

  const blocks = dropNoiseBlocks(interleaveByPage(primaryBlocks, asideBlocks));
  return coalesceFragments(demoteTableRows(blocks));
}

// Table rows get styled like headings in many papers ("Procedimental 18 8 26"),
// which promoted them into the outline and rendered them huge. Two or more
// bare numbers in a short line is a data row, not a section title.
function demoteTableRows(blocks) {
  return blocks.map((b) => {
    if (b.type === 'paragraph' || b.type === 'verse') return b;
    if (detectNumberedHeading(b.text)) return b; // "3.2.1. Título" is genuine
    const numbers = b.text.match(/\d+/g) || [];
    return numbers.length >= 2 ? { ...b, type: 'paragraph' } : b;
  });
}

const FRAGMENT_MAX_CHARS = 70;

// Table cells arrive as a long run of tiny blocks. Rendered one-per-block they
// became a cascade of little cards that buried the text. Collapse each run into
// a single block so a table reads as one unit on a phone.
function coalesceFragments(blocks) {
  const out = [];
  let i = 0;

  while (i < blocks.length) {
    const b = blocks[i];

    if (b.aside) {
      const group = [b];
      let j = i + 1;
      while (j < blocks.length && blocks[j].aside && blocks[j].page === b.page) {
        group.push(blocks[j]);
        j++;
      }
      out.push({ ...b, text: group.map((g) => g.text).join('\n') });
      i = j;
      continue;
    }

    if (isFragment(b)) {
      const group = [b];
      let j = i + 1;
      while (j < blocks.length && blocks[j].page === b.page && isFragment(blocks[j])) {
        group.push(blocks[j]);
        j++;
      }
      if (group.length >= 3) {
        out.push({ ...b, type: 'table', text: group.map((g) => g.text).join('\n') });
        i = j;
        continue;
      }
    }

    out.push(b);
    i++;
  }

  return out;
}

function isFragment(b) {
  if (b.aside) return false;
  if (b.type === 'heading' || b.type === 'subheading' || b.type === 'subheading2') return false;
  if (detectNumberedHeading(b.text)) return false;
  return b.text.length <= FRAGMENT_MAX_CHARS;
}

// Page furniture — a running header/footer reprinted on every page, and bare
// page numbers — is layout scaffolding, not content. Removing it at the line
// level (before paragraphs are assembled) is what lets a paragraph flow
// uninterrupted across a page boundary.
function stripPageFurniture(lines) {
  const pagesByText = new Map();
  for (const l of lines) {
    const key = l.text.trim();
    if (!key) continue;
    if (!pagesByText.has(key)) pagesByText.set(key, new Set());
    pagesByText.get(key).add(l.page);
  }

  return lines.filter((l) => {
    const t = l.text.trim();
    if (!t) return false;
    if (/^\d{1,4}$/.test(t)) return false; // standalone page number
    return (pagesByText.get(t)?.size ?? 0) < 3; // repeated on 3+ pages
  });
}

function interleaveByPage(primaryBlocks, asideBlocks) {
  const tagged = [
    ...primaryBlocks.map((b, i) => ({ b, rank: 0, i })),
    ...asideBlocks.map((b, i) => ({ b, rank: 1, i })),
  ];
  tagged.sort((x, y) => x.b.page - y.b.page || x.rank - y.rank || x.i - y.i);
  return tagged.map((t) => t.b);
}

// Stray table cells and math fragments ("13", "x") survive as one- or
// zero-letter blocks and just add noise to a reading view.
function dropNoiseBlocks(blocks) {
  return blocks.filter((b) => (b.text.match(/\p{L}/gu) || []).length >= 2);
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

async function collectTextItems(pdf) {
  const items = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = { items: await readTextItems(page) };
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      items.push({
        str: repairLigatures(item.str),
        x: item.transform[4],
        y: item.transform[5],
        width: item.width ?? 0,
        fontSize: Math.hypot(item.transform[0], item.transform[1]),
        page: i,
      });
    }
  }
  return items;
}

// Finds, per page, the x position of a real column gutter — a wide gap in
// the page's raw item positions with a healthy population of text on each
// side. Working from raw items (not yet-grouped lines) gives a much denser
// sample of "what x ranges have text on them", so even a tight marginalia
// gutter (a sidebar box sitting snug against the main column) shows up as
// a real gap rather than being lost in per-line noise.
function computeGutters(items) {
  const byPage = new Map();
  for (const it of items) {
    if (!byPage.has(it.page)) byPage.set(it.page, []);
    byPage.get(it.page).push(it);
  }
  const gutters = new Map();
  byPage.forEach((pageItems, page) => gutters.set(page, findGutterX(pageItems)));
  return gutters;
}

// A real column gutter is a vertical corridor that no text crosses. On a
// normal prose page the widest x-gap between items is just an accident of
// word spacing, and treating it as a gutter chops every line in two and
// exiles the right-hand halves — text appears to vanish mid-sentence. So a
// candidate is only trusted when almost no line spans it and both sides
// hold a real block of text.
function validateGutters(candidates, naiveLines) {
  const byPage = new Map();
  for (const l of naiveLines) {
    if (!byPage.has(l.page)) byPage.set(l.page, []);
    byPage.get(l.page).push(l);
  }

  const validated = new Map();
  candidates.forEach((gutterX, page) => {
    if (gutterX == null) return;
    const pageLines = byPage.get(page) || [];
    if (pageLines.length < 6) return;

    const tol = 2;
    let crossing = 0;
    let left = 0;
    let right = 0;
    for (const l of pageLines) {
      if (l.xLeft < gutterX - tol && l.xRight > gutterX + tol) crossing++;
      else if (l.xRight <= gutterX + tol) left++;
      else right++;
    }

    if (crossing / pageLines.length > 0.1) return; // text spans it: not a gutter
    if (left < 4 || right < 4) return; // one side is too thin to be a column
    validated.set(page, gutterX);
  });

  return validated;
}

function findGutterX(pageItems) {
  const MIN_ITEMS = 20;
  const MIN_CLUSTER = 6;
  const MIN_GUTTER = 18;

  if (pageItems.length < MIN_ITEMS) return null;

  const sorted = [...pageItems].sort((a, b) => a.x - b.x);
  let bestIdx = -1;
  let bestGap = 0;
  for (let i = MIN_CLUSTER; i < sorted.length - MIN_CLUSTER; i++) {
    const gap = sorted[i].x - sorted[i - 1].x;
    if (gap > bestGap) {
      bestGap = gap;
      bestIdx = i;
    }
  }

  if (bestIdx === -1 || bestGap < MIN_GUTTER) return null;

  const gutterX = (sorted[bestIdx - 1].x + sorted[bestIdx].x) / 2;
  const leftCount = sorted.filter((it) => it.x < gutterX).length;
  if (leftCount < MIN_CLUSTER || sorted.length - leftCount < MIN_CLUSTER) return null;

  return gutterX;
}

// Groups raw text-run items into visual lines (items sharing a baseline).
// A known page gutter forces a line break exactly at that boundary, so a
// sidebar line ending right where the main column starts never fuses with
// whatever happens to sit at the same height in the main column.
function groupIntoLines(items, gutterByPage) {
  const sorted = [...items].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    const yDiff = b.y - a.y;
    if (Math.abs(yDiff) > 5) return yDiff;
    return a.x - b.x;
  });

  const lines = [];
  let current = null;

  for (const item of sorted) {
    const gutterX = gutterByPage.get(item.page) ?? null;
    const side = gutterX == null ? 0 : item.x < gutterX ? 0 : 1;

    const sameLine =
      current &&
      current.page === item.page &&
      current.side === side &&
      Math.abs(item.y - current.y) <= item.fontSize * 0.4;

    if (sameLine) {
      current.items.push(item);
    } else {
      if (current) lines.push(finalizeLine(current));
      current = { items: [item], page: item.page, y: item.y, side };
    }
  }
  if (current) lines.push(finalizeLine(current));
  return lines;
}

function finalizeLine(line) {
  const items = line.items;
  const fontSize = Math.round((items[0]?.fontSize || 0) * 10) / 10;
  const text = items
    .map((it) => it.str)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    text,
    fontSize,
    // Reduce rather than spread: a pathological PDF can put thousands of runs
    // on one baseline, and Math.min(...huge) blows the call stack.
    xLeft: items.reduce((m, it) => Math.min(m, it.x), Infinity),
    xRight: items.reduce((m, it) => Math.max(m, it.x + it.width), -Infinity),
    y: line.y,
    page: line.page,
    side: line.side,
    itemCount: items.length,
  };
}

// A plain top-to-bottom sort corrupts any page with a sidebar or a second
// column, because their lines share a y-range with the main column and get
// interleaved with it. This reads one whole column before the other,
// instead of weaving them together by height — and picks the narrower
// column as the "aside", since a sidebar/footnote box is narrower than the
// main text column regardless of which physical side of the page it's on.
function assignReadingOrder(lines) {
  const byPage = new Map();
  for (const line of lines) {
    if (!byPage.has(line.page)) byPage.set(line.page, []);
    byPage.get(line.page).push(line);
  }

  const ordered = [];
  const pages = [...byPage.keys()].sort((a, b) => a - b);

  for (const page of pages) {
    const pageLines = byPage.get(page);
    const sideA = pageLines.filter((l) => l.side === 0).sort((a, b) => b.y - a.y);
    const sideB = pageLines.filter((l) => l.side === 1).sort((a, b) => b.y - a.y);

    if (!sideB.length) {
      sideA.forEach((l) => ordered.push({ ...l, aside: false }));
      continue;
    }

    const widthA = median(sideA.map((l) => l.xRight - l.xLeft));
    const widthB = median(sideB.map((l) => l.xRight - l.xLeft));
    const [primary, secondary] = widthA >= widthB ? [sideA, sideB] : [sideB, sideA];

    primary.forEach((l) => ordered.push({ ...l, aside: false }));
    secondary.forEach((l) => ordered.push({ ...l, aside: true }));
  }

  return ordered;
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

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

// Typical left/right extent of a region's body-text lines, used to detect
// indentation (new paragraph) and full-width lines (a wrapped line vs. an
// intentional break). Computed separately for the main text and the aside
// so a narrow sidebar doesn't skew the main column's margins, or vice versa.
function bodyEdges(lines, modalFontSize) {
  return {
    left: findEdge(lines, modalFontSize, (l) => l.xLeft, 1),
    right: findEdge(lines, modalFontSize, (l) => l.xRight, 1, 0.75),
  };
}

function findEdge(lines, modalFontSize, accessor, precision, percentile = 0.5) {
  const values = lines
    .filter((l) => Math.abs(l.fontSize - modalFontSize) <= 0.5)
    .map(accessor);
  if (!values.length) return null;
  if (percentile === 0.5) return mode(values, precision);
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * percentile));
  return sorted[idx];
}

// A bare number or punctuation fragment (a stray table cell value, a page
// number) should never register as a heading, no matter its font size.
function looksLikeHeadingText(text) {
  return /\p{L}/u.test(text);
}

function isHeadingLine(line, modalFontSize) {
  return (
    line.fontSize > modalFontSize * 1.18 &&
    line.itemCount <= 12 &&
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
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.text) {
      i++;
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
      const headEdge = (line.aside ? edges.aside : edges.primary) || {};
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

      const prev = run[run.length - 1];
      if (Math.abs(prev.fontSize - next.fontSize) > 0.5) break;

      const bodyEdge = (next.aside ? edges.aside : edges.primary) || {};
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
      blocks.push({
        text,
        type: isVerse ? 'verse' : 'paragraph',
        page: run[0].page,
        aside: run[0].aside,
      });
    }

    i = j;
  }

  return blocks;
}
