import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSelection, locateHighlight, reanchorHighlights } from '../src/utils/anchoring.js';

const block = (text) => ({ text });

test('a highlight survives blocks being inserted above it', () => {
  const before = [block('Uno.'), block('La frase que el lector subrayo esta aqui.')];
  const text = before[1].text;
  const start = text.indexOf('frase');
  const end = start + 'frase'.length;
  const highlight = {
    paragraphIndex: 1,
    startOffset: start,
    endOffset: end,
    ...describeSelection(text, start, end),
  };
  assert.equal(highlight.quote, 'frase');

  const after = [block('Cero.'), block('Uno.'), block('Nuevo parrafo.'), before[1]];
  const [moved] = reanchorHighlights([highlight], after);

  assert.equal(moved.orphan, false);
  assert.equal(moved.paragraphIndex, 3);
  assert.equal(after[moved.paragraphIndex].text.slice(moved.startOffset, moved.endOffset), 'frase');
});

test('the surrounding text decides between two identical quotes', () => {
  const blocks = [
    block('el resultado fue claro y contundente'),
    block('sin embargo el resultado fue discutido'),
  ];
  const start = blocks[1].text.indexOf('resultado fue');
  const end = start + 'resultado fue'.length;
  const highlight = {
    paragraphIndex: 1,
    startOffset: start,
    endOffset: end,
    ...describeSelection(blocks[1].text, start, end),
  };
  assert.equal(highlight.quote, 'resultado fue');

  // Same two blocks, order swapped: the mark must follow its own sentence.
  const shuffled = [blocks[1], block('relleno'), blocks[0]];
  const [moved] = reanchorHighlights([highlight], shuffled);
  assert.equal(moved.paragraphIndex, 0);
});

test('a quote that is gone is kept as an orphan rather than misplaced', () => {
  const highlight = {
    paragraphIndex: 0,
    startOffset: 0,
    endOffset: 10,
    ...describeSelection('encabezado de pagina 7', 0, 10),
  };
  const [moved] = reanchorHighlights([highlight], [block('un texto totalmente distinto')]);

  assert.equal(moved.orphan, true);
  // Nothing is thrown away: the record still carries what it was placed on.
  assert.equal(moved.quote, 'encabezado');
});

test('offsets that still hold are left untouched', () => {
  const blocks = [block('texto estable que no ha cambiado')];
  const start = blocks[0].text.indexOf('estable');
  const end = start + 'estable'.length;
  const highlight = {
    paragraphIndex: 0,
    startOffset: start,
    endOffset: end,
    ...describeSelection(blocks[0].text, start, end),
  };
  const [same] = reanchorHighlights([highlight], blocks);
  assert.equal(same.startOffset, start);
  assert.equal(same.endOffset, end);
});

test('records saved before quotes existed are not moved or discarded', () => {
  const legacy = { paragraphIndex: 4, startOffset: 0, endOffset: 5, colorObj: {} };
  const [kept] = reanchorHighlights([legacy], [block('otro documento')]);
  assert.deepEqual(kept, legacy);
});

test('locateHighlight reports nothing when there is nothing to go on', () => {
  assert.equal(locateHighlight([block('hola')], { quote: '' }), null);
});
