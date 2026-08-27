// Page layout analysis: turning a bag of positioned text runs back into a
// reading order.
//
// The previous approach looked for *one* vertical gutter per page and split
// everything on it. That works for exactly one shape of document — a body of
// text in two columns — and quietly corrupts the rest. A title spanning both
// columns was cut in half and its right-hand side exiled to the end of the
// page; a three-column layout was unreadable; a page whose columns start below
// a full-width abstract had no single gutter to find at all.
//
// This does the standard thing instead: a recursive XY-cut. Look for a band of
// whitespace that crosses the whole region, split there, recurse. Cutting
// horizontally first is what separates a full-width heading from the columns
// beneath it, and only then does a vertical cut find those columns — each of
// which is recursed into in turn, so a sidebar inside a column, or a second
// heading further down, is found as well.
//
// The result is an ordered list of regions with no assumption about how many
// columns a page has, whether they line up between pages, or where they start.

const MAX_DEPTH = 6;
const MIN_ITEMS_TO_CUT = 8;
// Both sides of a vertical cut must be a real block of text, not one stray
// label sitting out in the margin.
const MIN_LINES_PER_COLUMN = 3;

/**
 * Splits one page's text runs into regions and returns them in reading order.
 *
 * `items` are the page's runs ({ x, y, width, fontSize }); `modalFontSize` is
 * the document's body size. Every threshold is expressed as a multiple of it,
 * so the analysis behaves the same on a 7pt datasheet and a large-print book.
 */
export function orderPageRegions(items, modalFontSize, view) {
  if (!items.length) return [];

  const size = modalFontSize > 0 ? modalFontSize : 10;
  const page = pageBox(view, items);
  const thresholds = {
    gutter: size * 2.2,
    // Vertical whitespace that means "a new block starts here" rather than
    // "this is the next line of the same paragraph".
    band: size * 1.0,
    page,
  };

  const regions = [];
  cut(items, 0, thresholds, regions);
  return regions.filter((region) => region.items.length).map(finalizeRegion);
}

function pageBox(view, items) {
  if (Array.isArray(view) && view.length === 4 && view[2] > view[0] && view[3] > view[1]) {
    return { width: view[2] - view[0], height: view[3] - view[1] };
  }
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (const it of items) {
    minY = Math.min(minY, it.y);
    maxY = Math.max(maxY, it.y);
    minX = Math.min(minX, it.x);
    maxX = Math.max(maxX, it.x + (it.width || 0));
  }
  return { width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function cut(items, depth, thresholds, out) {
  if (depth >= MAX_DEPTH || items.length < MIN_ITEMS_TO_CUT) {
    out.push({ items });
    return;
  }

  // Horizontal first, always: a full-width heading has to be lifted off the
  // columns below it before those columns can be found, or half the heading
  // ends up in the left column and half in the right.
  const bands = splitIntoBands(items, thresholds.band);
  if (bands.length > 1) {
    for (const band of bands) cut(band, depth + 1, thresholds, out);
    return;
  }

  const columns = splitIntoColumns(items, thresholds, isPageTall(items, thresholds.page));
  if (columns.length > 1) {
    const widths = columns.map(spanWidth);
    const widest = Math.max(...widths);

    columns.forEach((column, index) => {
      // A column much narrower than the one beside it is marginalia — a
      // sidebar, a contact box, a pull quote. Two columns of comparable width
      // are just columns; the old "narrower side is the aside" rule boxed off
      // half of every genuinely two-column article.
      const aside = columns.length === 2 && widths[index] < widest * 0.55;

      const nested = [];
      cut(column, depth + 1, thresholds, nested);
      for (const region of nested) {
        region.aside = aside;
        out.push(region);
      }
    });
    return;
  }

  out.push({ items });
}

// Groups items into horizontal strips separated by a band of empty space that
// runs the full width of the region.
function splitIntoBands(items, minGap) {
  const gaps = findGaps(
    items.map((it) => ({ start: it.y - it.fontSize * 0.25, end: it.y + it.fontSize * 0.9 })),
    minGap
  );
  if (!gaps.length) return [items];

  // PDF y grows upwards, so the topmost band is the one above the highest
  // boundary and the bands come out in reverse order of the sorted gaps.
  const boundaries = gaps.map((g) => (g.start + g.end) / 2).sort((a, b) => b - a);
  const bands = Array.from({ length: boundaries.length + 1 }, () => []);

  for (const it of items) {
    const middle = it.y + it.fontSize * 0.3;
    let index = 0;
    while (index < boundaries.length && middle < boundaries[index]) index++;
    bands[index].push(it);
  }

  const usable = bands.filter((band) => band.length);
  return usable.length > 1 ? usable : [items];
}

// The whole difficulty of an XY-cut on a real document is here: the gap between
// two columns of prose and the gap between two columns of a table look exactly
// the same locally. Splitting on the second one destroys the table — it gets
// read one column at a time, so a schedule comes out as a list of dates
// followed by a list of unrelated tasks.
//
// What separates them is not the gap, it is the shape of what it splits:
//
//   * A page's columns run down most of the page. A table sits in a band.
//   * A page's columns are near enough the same width, because that is what a
//     layout does. A table's columns are as wide as their contents need.
//   * The exception to the width rule is marginalia — a narrow sidebar beside a
//     wide body — which is a two-column split with a very lopsided ratio, and
//     never the five near-arbitrary widths of a table.
//
// A gap that fails these is left alone, and whatever it separates stays in one
// region and is read line by line, left to right: which is exactly right for a
// table, and is how detectTableAt gets to see it as a grid.
const MAX_LAYOUT_COLUMNS = 3;

function splitIntoColumns(items, thresholds, tall) {
  if (!tall) return [items];

  const gaps = findGaps(
    items.map((it) => ({ start: it.x, end: it.x + (it.width || 0) })),
    thresholds.gutter
  );
  if (!gaps.length || gaps.length + 1 > MAX_LAYOUT_COLUMNS) return [items];

  const boundaries = gaps.map((g) => (g.start + g.end) / 2).sort((a, b) => a - b);
  const columns = Array.from({ length: boundaries.length + 1 }, () => []);

  for (const it of items) {
    const centre = it.x + (it.width || 0) / 2;
    let index = 0;
    while (index < boundaries.length && centre > boundaries[index]) index++;
    columns[index].push(it);
  }

  const usable = columns.filter((column) => baselineCount(column) >= MIN_LINES_PER_COLUMN);
  if (usable.length < 2) return [items];

  const widths = usable.map(spanWidth);
  const widest = Math.max(...widths);
  const narrowest = Math.min(...widths);

  const evenColumns = narrowest >= widest * 0.7;
  const sidebar =
    usable.length === 2 &&
    narrowest < widest * 0.55 &&
    widest >= thresholds.page.width * 0.4;

  if (!evenColumns && !sidebar) return [items];
  return usable;
}

// Does this region run down enough of the page to be a column of it? A table,
// a boxed note and a heading block all sit inside a band; the body of a
// two-column page does not.
function isPageTall(items, page) {
  let min = Infinity;
  let max = -Infinity;
  for (const it of items) {
    min = Math.min(min, it.y);
    max = Math.max(max, it.y);
  }
  return max - min >= page.height * 0.45;
}

// Merges a set of intervals and returns the empty stretches between them that
// are at least `minGap` wide.
function findGaps(intervals, minGap) {
  if (intervals.length < 2) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);

  const gaps = [];
  let reach = sorted[0].end;
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i];
    if (next.start - reach >= minGap) gaps.push({ start: reach, end: next.start });
    reach = Math.max(reach, next.end);
  }
  return gaps;
}

// How many distinct text lines a set of items covers. A raw item count is not
// the same thing: one line can be a hundred runs, and a hundred runs stacked in
// a margin can be one word each.
function baselineCount(items) {
  const seen = new Set();
  for (const it of items) seen.add(Math.round(it.y / Math.max(1, it.fontSize * 0.6)));
  return seen.size;
}

function spanWidth(items) {
  let min = Infinity;
  let max = -Infinity;
  for (const it of items) {
    min = Math.min(min, it.x);
    max = Math.max(max, it.x + (it.width || 0));
  }
  return max - min;
}

function finalizeRegion(region) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const it of region.items) {
    x0 = Math.min(x0, it.x);
    x1 = Math.max(x1, it.x + (it.width || 0));
    y0 = Math.min(y0, it.y - it.fontSize * 0.25);
    y1 = Math.max(y1, it.y + it.fontSize * 0.9);
  }
  return {
    items: region.items,
    rect: [x0, y0, x1, y1],
    width: x1 - x0,
    aside: Boolean(region.aside),
  };
}
