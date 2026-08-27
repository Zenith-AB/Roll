// Test documents, built rather than committed.
//
// Real PDFs cannot go in the repository — they belong to their authors, and a
// binary blob tells no one what it is meant to prove. These are written with
// pdf-lib at test time, one per behaviour, so each fixture's layout is right
// there in the source next to the assertions about it.
import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from 'pdf-lib';

const PAGE = [612, 792];

async function newDocument() {
  const doc = await PDFDocument.create();
  return {
    doc,
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
}

function write(page, font, text, x, y, size = 10) {
  page.drawText(text, { x, y, size, font, color: rgb(0.1, 0.1, 0.1) });
}

/**
 * A journal article: a full-width title over two equal columns, with a running
 * head carrying the page number, and a footnote at the foot of page one.
 *
 * Proves the two things a single-gutter analysis gets wrong — a heading that
 * spans both columns, and reading one whole column before the other.
 */
export async function twoColumnArticle() {
  const { doc, regular, bold } = await newDocument();

  for (let p = 0; p < 4; p++) {
    const page = doc.addPage(PAGE);
    // Running head: same words every page, different number, up in the margin.
    write(page, regular, `REVISTA DE PRUEBAS 61 ${205 + p}`, 60, 770, 8);

    if (p === 0) {
      write(page, bold, 'TITULO COMPLETO QUE CRUZA LAS DOS COLUMNAS DEL ARTICULO', 60, 735, 14);
      write(page, regular, '1 Nota al pie de la primera pagina.', 60, 70, 7);
    }

    for (let i = 0; i < 22; i++) {
      const y = 690 - i * 21;
      write(page, regular, `IZQUIERDA ${p}-${i} texto de la columna de la`, 60, y);
      write(page, regular, `DERECHA ${p}-${i} texto de la columna de la`, 330, y);
    }
  }

  return doc.save();
}

/**
 * A table that runs past the end of its page and reprints its header on the
 * next one, with cells long enough to wrap onto a second baseline.
 */
export async function splitTable() {
  const { doc, regular, bold } = await newDocument();
  const columns = [60, 170, 300, 450];
  const header = ['Semana', 'Fecha', 'Trabajo principal', 'Responsable'];

  const rows = [
    ['S1', '17-23 ago', 'Definir el corredor piloto y el', 'Direccion'],
    ['', '', 'esquema de datos', ''],
    ['S2', '24-30 ago', 'Ingesta de imagenes y series', 'Ingenieria'],
    ['S3', '31 ago-6 sep', 'Mascaras de nubes e indices', 'Percepcion'],
  ];
  const more = [
    ['S4', '7-13 sep', 'Modelo de referencia y linea base', 'Analitica'],
    ['S5', '14-20 sep', 'Optimizacion de cuadrillas', 'Operaciones'],
    ['S6', '21-27 sep', 'Validacion tecnica y demo', 'Direccion'],
  ];

  const drawRows = (page, list, top) => {
    write(page, bold, 'Semana', columns[0], top, 9);
    header.slice(1).forEach((cell, i) => write(page, bold, cell, columns[i + 1], top, 9));
    list.forEach((row, r) => {
      row.forEach((cell, c) => {
        if (cell) write(page, regular, cell, columns[c], top - 20 - r * 16, 9);
      });
    });
  };

  const first = doc.addPage(PAGE);
  write(first, regular, 'El cronograma recomendado se resume a continuacion.', 60, 700, 10);
  drawRows(first, rows, 660);

  const second = doc.addPage(PAGE);
  drawRows(second, more, 700);
  write(second, regular, 'Los hitos de decision se revisan al cierre de cada quincena y', 60, 560, 10);
  write(second, regular, 'quedan registrados en el acta correspondiente del comite.', 60, 546, 10);

  return doc.save();
}

/**
 * A front page of the kind that used to be mistaken for tabular data: a title,
 * a list of authors and their affiliations, all of them short lines.
 */
export async function frontMatter() {
  const { doc, regular, bold } = await newDocument();
  const page = doc.addPage(PAGE);

  write(page, bold, 'ESTUDIO SOBRE LA LECTURA EN PANTALLA', 60, 720, 15);
  ['Ana Reyes', 'Universidad de Prueba', 'Luis Soto', 'Instituto de Ensayo', 'Marta Diaz', 'Centro de Datos']
    .forEach((line, i) => write(page, regular, line, 60, 680 - i * 18, 10));

  write(page, regular, 'Resumen: este documento existe unicamente para comprobar que una portada', 60, 550, 10);
  write(page, regular, 'con lineas cortas no se confunde con una tabla de datos.', 60, 536, 10);

  return doc.save();
}

/** Author comments living in the PDF's annotation dictionary. */
export async function annotated() {
  const { doc, regular } = await newDocument();
  const page = doc.addPage(PAGE);
  write(page, regular, 'Un parrafo cualquiera sobre el que alguien dejo un comentario.', 60, 700, 11);

  const annotation = (subtype, rect, contents, author, extra = {}) =>
    doc.context.register(
      doc.context.obj({
        Type: 'Annot',
        Subtype: subtype,
        Rect: rect,
        F: 4,
        Contents: PDFString.of(contents),
        T: PDFString.of(author),
        M: PDFString.of('D:20260210120000Z'),
        Name: 'Comment',
        ...extra,
      })
    );

  page.node.set(
    PDFName.of('Annots'),
    doc.context.obj([
      annotation('Text', [520, 690, 540, 710], 'Revisar esta cifra antes de publicar.', 'Ana Reyes'),
      annotation('Highlight', [60, 694, 300, 710], 'El dato cambio en abril.', 'Luis Soto', {
        QuadPoints: [60, 710, 300, 710, 60, 694, 300, 694],
      }),
    ])
  );

  return doc.save();
}
