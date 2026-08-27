import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

const NUMERIC_CELL = /^[\d\s.,%()+\-–—/$€:]+$/;

// Below this a table of three or more columns stops being a grid a person can
// read and becomes a horizontal scroll with two words per line.
const CARD_BREAKPOINT = 700;
const CARD_MIN_COLUMNS = 3;

/**
 * A table the extractor resolved into a real grid.
 *
 * It is always a real `<table>` — `<caption>`, `<thead>`, `<th scope>` and all.
 * On a narrow screen a wide one is *restyled* into one card per row, with each
 * value carrying its column's name, but the markup does not change: the cells
 * keep their roles, so what is copied, read aloud or printed is still a table.
 * The reader can switch back to the grid at any time; the layout is a default,
 * not a restriction.
 */
const DocTable = memo(function DocTable({ idx, para, style }) {
  const scrollRef = useRef(null);
  const [overflowing, setOverflowing] = useState(false);
  const [mode, setMode] = useState('auto');
  const isNarrow = useIsMobile(CARD_BREAKPOINT);

  const rows = para.rows;
  const header = para.header && rows?.length ? rows[0] : null;
  const body = useMemo(() => (header ? rows.slice(1) : rows || []), [header, rows]);
  const columnCount = rows?.[0]?.length || 0;

  // Without a header row the first column is almost always the row's label
  // ("Matemáticas | 18 | 8"), so it is marked up as a row header — but only
  // when it really is text against figures, never for a grid of bare numbers.
  const hasRowHeaders = useMemo(() => {
    if (header || body.length < 2) return false;
    const firstColumnIsText = body.every((row) => !row[0] || !NUMERIC_CELL.test(row[0]));
    const restHasNumbers = body.some((row) => row.slice(1).some((cell) => /\d/.test(cell)));
    return firstColumnIsText && restHasNumbers;
  }, [header, body]);

  const canOfferCards = isNarrow && columnCount >= CARD_MIN_COLUMNS;
  const asCards = mode === 'cards' || (mode === 'auto' && canOfferCards);

  // Column names are what make a card readable. A table with no header row has
  // no names to give, and inventing "Columna 3" is worse than silence — so the
  // cards drop the label column entirely and simply stack the values.
  const labels = useMemo(
    () => (header ? header.map((name) => name.trim()) : null),
    [header]
  );

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setOverflowing(el.scrollWidth - el.clientWidth > 4);
  }, []);

  useEffect(() => {
    if (asCards) {
      setOverflowing(false);
      return undefined;
    }
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    if (scrollRef.current) observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [measure, rows, style, asCards]);

  // Tables the column detector could not resolve into a grid still arrive here,
  // as the block of lines they were. They keep their row breaks and their own
  // scroll box, which is still better than letting them shred the flow.
  if (!rows || !rows.length) {
    return (
      <div className="doc-table-raw-wrap">
        <p className="doc-paragraph doc-table" data-idx={idx} style={style}>
          {para.text}
        </p>
      </div>
    );
  }

  const cell = (value, column, tag) => {
    const Tag = tag;
    return (
      <Tag
        key={column}
        {...(tag === 'th' ? { scope: 'row' } : {})}
        className={tag === 'td' && NUMERIC_CELL.test(value) ? 'is-numeric' : undefined}
        /* Read back by CSS as the value's label once the row becomes a card. */
        data-label={labels?.[column] || undefined}
      >
        {value}
      </Tag>
    );
  };

  return (
    <figure
      className={[
        'doc-figure',
        'doc-table-figure',
        asCards ? 'doc-table-figure--cards' : '',
        asCards && !labels ? 'doc-table-figure--unlabelled' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      /* The column count sizes both the table's minimum width and how far the
         figure is allowed to spread past the reading measure. */
      style={{ '--doc-cols': columnCount || 3 }}
    >
      <div
        ref={scrollRef}
        className={`doc-table-scroll ${overflowing ? 'is-overflowing' : ''}`}
        /* Focusable and labelled so a keyboard user can scroll it and a screen
           reader announces it as a region rather than skipping past. */
        role="region"
        tabIndex={0}
        aria-label={para.caption || 'Tabla del documento'}
      >
        <table
          className="doc-data-table"
          data-idx={idx}
          style={style}
        >
          {para.caption && <caption>{para.caption}</caption>}
          {header && (
            <thead>
              <tr>
                {header.map((value, i) => (
                  <th key={i} scope="col">
                    {value}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {row.map((value, c) =>
                  cell(value, c, hasRowHeaders && c === 0 ? 'th' : 'td')
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(canOfferCards || overflowing) && (
        <p className="doc-table-tools">
          {overflowing && !asCards && (
            <span className="doc-table-hint">Desliza la tabla para ver el resto →</span>
          )}
          {canOfferCards && (
            <button
              type="button"
              className="doc-table-toggle"
              onClick={() => setMode(asCards ? 'grid' : 'cards')}
            >
              {asCards ? 'Ver como tabla' : 'Ver como fichas'}
            </button>
          )}
        </p>
      )}
    </figure>
  );
});

export default DocTable;
