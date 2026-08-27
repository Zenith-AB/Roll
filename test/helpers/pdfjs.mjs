// Test harness for running the extractor outside a browser.
//
// Two things the app gets from its bundler and its DOM have to be supplied by
// hand here: the path to the pdf.js worker (the app resolves it through Vite's
// bare-specifier handling, which Node does not do), and a `document` object.
// Figure rasterising genuinely needs a canvas, so the stub makes it fail — the
// extractor is built to carry on without figures, and these tests are about the
// text pipeline.
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

if (!globalThis.document) {
  globalThis.document = {
    createElement() {
      throw new Error('sin canvas en el entorno de pruebas');
    },
  };
}

const { extractDocument } = await import('../../src/services/pdfExtractor.js');

pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(
  fileURLToPath(new URL('../../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url))
).href;

const STANDARD_FONTS = new URL(
  '../../node_modules/pdfjs-dist/standard_fonts/',
  import.meta.url
).href;

export async function extract(bytes) {
  const pdf = await pdfjsLib.getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: STANDARD_FONTS,
  }).promise;
  try {
    return await extractDocument(pdf);
  } finally {
    await pdf.loadingTask.destroy();
  }
}

export function countTypes(blocks) {
  const counts = {};
  for (const block of blocks) counts[block.type] = (counts[block.type] || 0) + 1;
  return counts;
}

export function textOf(blocks) {
  return blocks.map((b) => b.text).join('\n');
}

// Index of the first block whose text contains `needle`, or -1.
export function indexOf(blocks, needle) {
  return blocks.findIndex((b) => (b.text || '').includes(needle));
}
