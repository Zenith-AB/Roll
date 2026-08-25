const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
async function run() {
  const srcDoc = await PDFDocument.load(fs.readFileSync('/home/zenith/a_bustos_i,+Gestor_a+de+la+revista,+484 (1).pdf'));
  const newPdf = await PDFDocument.create();
  const page = srcDoc.getPages()[0];
  
  const bbox1 = { left: 0, bottom: page.getHeight() - 200, right: page.getWidth(), top: page.getHeight() };
  const ep1 = await newPdf.embedPage(page, bbox1);
  
  const giantPage = newPdf.addPage([page.getWidth(), 200]);
  giantPage.drawPage(ep1, { x: 0, y: 0, width: ep1.width, height: ep1.height });
  
  fs.writeFileSync('/tmp/test_pdf_lib.pdf', await newPdf.save());
  console.log("PDF Created");
}
run();
