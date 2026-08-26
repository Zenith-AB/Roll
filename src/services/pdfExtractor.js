import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

export async function loadPdfFromFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  return extractDocument(pdf);
}

export async function extractDocument(pdf) {
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push({ items: content.items });
  }

  const allItems = [];
  pages.forEach((p, pi) => {
    p.items.forEach((item) => {
      if (!item.str || !item.str.trim()) return;
      allItems.push({
        str: item.str,
        transform: item.transform,
        fontSize: Math.hypot(item.transform[0], item.transform[1]),
        hasEOL: item.hasEOL,
        page: pi + 1,
      });
    });
  });

  if (!allItems.length) return [];

  allItems.sort((a, b) => {
    const pageDiff = a.page - b.page;
    if (pageDiff !== 0) return pageDiff;
    const yDiff = b.transform[5] - a.transform[5];
    if (Math.abs(yDiff) > 5) return yDiff;
    return a.transform[4] - b.transform[4];
  });

  const fontSizes = allItems.map((i) => i.fontSize);
  const sizeCounts = new Map();
  fontSizes.forEach((s) => {
    const rounded = Math.round(s * 10) / 10;
    sizeCounts.set(rounded, (sizeCounts.get(rounded) || 0) + 1);
  });
  let modalSize = 0;
  let modalCount = 0;
  sizeCounts.forEach((count, size) => {
    if (count > modalCount) {
      modalCount = count;
      modalSize = size;
    }
  });

  const paragraphs = [];
  let currentParagraph = [];
  let currentY = null;

  for (const item of allItems) {
    const y = Math.round(item.transform[5]);
    const sameLine =
      currentY !== null &&
      Math.abs(y - currentY) <= item.fontSize * 0.4;

    if (sameLine) {
      currentParagraph.push(item);
    } else {
      if (currentParagraph.length > 0) {
        paragraphs.push([...currentParagraph]);
      }
      currentParagraph = [item];
      currentY = y;
    }
  }

  if (currentParagraph.length > 0) {
    paragraphs.push(currentParagraph);
  }

  const structured = [];
  let i = 0;
  while (i < paragraphs.length) {
    const p = paragraphs[i];
    const pFontSize = p[0] ? Math.round(p[0].fontSize * 10) / 10 : modalSize;
    const isHeading = pFontSize > modalSize * 1.18 && p.length <= 12;

    if (isHeading) {
      structured.push({
        text: p.map((item) => item.str).join(' ').replace(/\s+/g, ' ').trim(),
        type: 'heading',
        page: p[0]?.page || 1,
      });
      i++;
      continue;
    }

    const paragraphItems = [...p];
    let j = i + 1;
    while (j < paragraphs.length) {
      const nextP = paragraphs[j];
      const nextFontSize = nextP[0] ? Math.round(nextP[0].fontSize * 10) / 10 : modalSize;
      const nextIsHeading = nextFontSize > modalSize * 1.18 && nextP.length <= 12;
      if (nextIsHeading) break;

      const lastItem = paragraphItems[paragraphItems.length - 1];
      const firstItem = nextP[0];
      const lastY = Math.round(lastItem.transform[5]);
      const firstY = Math.round(firstItem.transform[5]);
      const lastFontSize = Math.round(lastItem.fontSize * 10) / 10;
      const firstFontSize = Math.round(firstItem.fontSize * 10) / 10;
      const verticalGap = Math.abs(lastY - firstY);
      const expectedGap = (lastFontSize + firstFontSize) / 2 * 1.1;

      if (
        Math.abs(lastFontSize - firstFontSize) <= 0.5 &&
        verticalGap <= expectedGap &&
        verticalGap > 0
      ) {
        paragraphItems.push(...nextP);
        j++;
      } else {
        break;
      }
    }

    const text = paragraphItems
      .map((item) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text) {
      const isSub = pFontSize < modalSize * 0.97 && paragraphItems.length <= 10;
      structured.push({
        text,
        type: isSub ? 'subheading' : 'paragraph',
        page: paragraphItems[0]?.page || 1,
      });
    }

    i = j;
  }

  return structured;
}
