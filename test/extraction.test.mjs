import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extract, countTypes, indexOf } from './helpers/pdfjs.mjs';
import { twoColumnArticle, splitTable, frontMatter, annotated } from './helpers/fixtures.mjs';

test('a two-column article is read one column at a time', async () => {
  const blocks = await extract(await twoColumnArticle());
  const text = blocks.map((b) => b.text).join('\n');

  assert.ok(
    indexOf(blocks, 'TITULO COMPLETO QUE CRUZA LAS DOS COLUMNAS') >= 0,
    'el titulo sobrevive entero en un solo bloque'
  );

  const lastLeft = indexOf(blocks, 'IZQUIERDA 0-21');
  const firstRight = indexOf(blocks, 'DERECHA 0-0');
  assert.ok(lastLeft >= 0 && firstRight >= 0, 'ambas columnas llegan al documento');
  assert.ok(lastLeft < firstRight, 'la columna izquierda se lee antes que la derecha');

  assert.ok(!text.includes('REVISTA DE PRUEBAS'), 'el encabezado corriente se elimina');
});

test('a footnote keeps its own tag', async () => {
  const blocks = await extract(await twoColumnArticle());
  const note = blocks.find((b) => b.text.includes('Nota al pie'));
  assert.ok(note, 'la nota al pie esta presente');
  assert.equal(note.type, 'note');
});

test('a table split across pages comes back as one table', async () => {
  const blocks = await extract(await splitTable());
  const tables = blocks.filter((b) => b.type === 'table');

  assert.equal(tables.length, 1, 'las dos mitades se unen en una sola tabla');

  const [table] = tables;
  assert.ok(Array.isArray(table.rows), 'la tabla es una cuadricula, no texto suelto');
  assert.equal(table.header, true, 'se reconoce la fila de encabezado');
  assert.deepEqual(table.rows[0], ['Semana', 'Fecha', 'Trabajo principal', 'Responsable']);

  const weeks = table.rows.slice(1).map((row) => row[0]);
  assert.deepEqual(weeks, ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'], 'no falta ni sobra ninguna fila');

  // The header is reprinted on the second page and must not become a data row.
  assert.equal(
    table.rows.filter((row) => row[0] === 'Semana').length,
    1,
    'el encabezado repetido no se duplica'
  );

  // The wrapped continuation of S1 belongs to S1, not to a row of its own.
  assert.ok(
    table.rows[1][2].includes('esquema de datos'),
    'la celda partida en dos lineas se vuelve a unir'
  );
});

test('a front page of short lines is prose, not a table', async () => {
  const blocks = await extract(await frontMatter());
  const types = countTypes(blocks);

  assert.equal(types.table ?? 0, 0, 'la portada no se convierte en datos tabulares');
  const authors = blocks.find((b) => b.text.includes('Ana Reyes'));
  assert.ok(authors, 'los autores estan en el documento');
  assert.ok(
    ['paragraph', 'verse', 'heading'].includes(authors.type),
    `los autores son texto corriente, no ${authors.type}`
  );
});

test("author comments are extracted with who wrote them", async () => {
  const blocks = await extract(await annotated());
  const comments = blocks.filter((b) => b.type === 'annotation');

  assert.equal(comments.length, 2);
  assert.deepEqual(
    comments.map((c) => c.author).sort(),
    ['Ana Reyes', 'Luis Soto']
  );
  assert.ok(comments.every((c) => c.text.length > 0 && c.label));
});

test('every block carries the fields the reader depends on', async () => {
  const blocks = await extract(await splitTable());
  for (const block of blocks) {
    assert.equal(typeof block.text, 'string', 'todo bloque tiene texto para buscar y contar');
    assert.equal(typeof block.type, 'string');
    assert.ok(Number.isInteger(block.page) && block.page >= 1);
  }
});
