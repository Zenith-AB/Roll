const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
async function run() {
  const srcDoc = await PDFDocument.load(fs.readFileSync('/home/zenith/a_bustos_i,+Gestor_a+de+la+revista,+484 (1).pdf'));
  const newPdf = await PDFDocument.create();
  const page = srcDoc.getPages()[0];
  const width = page.getWidth();
  const height = page.getHeight();
  
  const bbox1 = { left: 0, bottom: height - 200, right: width, top: height };
  const ep1 = await newPdf.embedPage(page, bbox1);
  
  const bbox2 = { left: 0, bottom: height - 400, right: width, top: height - 200 };
  const ep2 = await newPdf.embedPage(page, bbox2);
  
  console.log(ep1.height, ep2.height);
}
run();
