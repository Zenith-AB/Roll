const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
async function run() {
  const srcDoc = await PDFDocument.load(fs.readFileSync('/home/zenith/a_bustos_i,+Gestor_a+de+la+revista,+484 (1).pdf'));
  const newPdf = await PDFDocument.create();
  const page = srcDoc.getPages()[0];
  
  page.setCropBox(0, page.getHeight() - 200, page.getWidth(), 200);
  const ep1 = await newPdf.embedPage(page);
  
  page.setCropBox(0, page.getHeight() - 400, page.getWidth(), 200);
  const ep2 = await newPdf.embedPage(page);
  
  const giantPage = newPdf.addPage([page.getWidth(), 400]);
  giantPage.drawPage(ep1, { x: 0, y: 200, width: ep1.width, height: ep1.height });
  giantPage.drawPage(ep2, { x: 0, y: 0, width: ep2.width, height: ep2.height });
  
  fs.writeFileSync('/tmp/test_pdf_lib.pdf', await newPdf.save());
  console.log(ep1.height, ep2.height);
}
run();
