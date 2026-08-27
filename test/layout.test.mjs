import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderPageRegions } from '../src/services/pdfLayout.js';

const VIEW = [0, 0, 612, 792];
const run = (str, x, y, width, fontSize = 10) => ({ str, x, y, width, fontSize, page: 1 });

// Twenty lines in each of two equal columns, under a heading that spans both.
function twoColumnPage() {
  const items = [run('TITULO QUE CRUZA LA PAGINA ENTERA', 60, 735, 480, 14)];
  for (let i = 0; i < 20; i++) {
    const y = 690 - i * 21;
    items.push(run(`izquierda ${i}`, 60, y, 220));
    items.push(run(`derecha ${i}`, 330, y, 220));
  }
  return items;
}

// A five-column table in a band across the middle of the page: the gaps between
// its columns are as wide as a page gutter, and it must survive anyway.
function tablePage() {
  const items = [];
  for (let i = 0; i < 12; i++) {
    const y = 500 - i * 16;
    items.push(run(`S${i}`, 55, y, 18, 9));
    items.push(run('17-23 ago', 157, y, 45, 9));
    items.push(run('trabajo', 259, y, 40, 9));
    items.push(run('entregable', 361, y, 52, 9));
    items.push(run('responsable', 463, y, 58, 9));
  }
  return items;
}

test('reads one column before the other and keeps a full-width heading whole', () => {
  const regions = orderPageRegions(twoColumnPage(), 10, VIEW);
  const order = regions.flatMap((region) => region.items.map((it) => it.str));

  const heading = order.indexOf('TITULO QUE CRUZA LA PAGINA ENTERA');
  assert.equal(heading, 0, 'el titulo va primero y entero');

  const lastLeft = order.indexOf('izquierda 19');
  const firstRight = order.indexOf('derecha 0');
  assert.ok(lastLeft > 0 && firstRight > 0, 'ambas columnas estan presentes');
  assert.ok(
    lastLeft < firstRight,
    'la columna izquierda se lee completa antes de empezar la derecha'
  );
});

test('never splits a table into columns', () => {
  const regions = orderPageRegions(tablePage(), 10, VIEW);

  for (const region of regions) {
    const baselines = new Set(region.items.map((it) => Math.round(it.y)));
    const columns = new Set(region.items.map((it) => Math.round(it.x)));
    // A region that holds several baselines must hold the whole row on each of
    // them: one column of a table on its own is the failure this guards.
    if (baselines.size > 1) {
      assert.equal(columns.size, 5, 'cada region conserva las cinco celdas de la fila');
    }
  }
});

test('a narrow sidebar beside a wide body is marked as an aside', () => {
  const items = [];
  for (let i = 0; i < 20; i++) {
    items.push(run(`cuerpo ${i}`, 60, 700 - i * 21, 330));
  }
  for (let i = 0; i < 12; i++) {
    items.push(run(`nota ${i}`, 460, 700 - i * 21, 90));
  }

  const regions = orderPageRegions(items, 10, VIEW);
  const aside = regions.filter((r) => r.aside);
  assert.ok(aside.length > 0, 'la barra lateral se reconoce');
  assert.ok(
    aside.every((r) => r.items.every((it) => it.str.startsWith('nota'))),
    'solo la barra lateral queda marcada como aside'
  );
});

test('a single column of prose is left in one piece', () => {
  const items = [];
  for (let i = 0; i < 25; i++) items.push(run(`linea ${i} de prosa continua`, 60, 700 - i * 14, 480));

  const regions = orderPageRegions(items, 10, VIEW);
  assert.equal(regions.length, 1, 'no se inventan columnas donde no las hay');
});
