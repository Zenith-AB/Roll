const { PDFDocument } = require('pdf-lib');
const fs = require('fs');

async function run() {
  const srcDoc = await PDFDocument.load(fs.readFileSync('/home/zenith/a_bustos_i,+Gestor_a+de+la+revista,+484 (1).pdf'));
  const newPdf = await PDFDocument.create();

  const page = srcDoc.getPages()[0];
  const width = page.getWidth();
  const height = page.getHeight();
  
  page.setCropBox(0, height - 200, width, 200);
  const ep1 = await newPdf.embedPage(page);
  
  page.setCropBox(0, height - 400, width, 200);
  const ep2 = await newPdf.embedPage(page);
  
  const giantPage = newPdf.addPage([width, 400]);
  giantPage.drawPage(ep1, { x: 0, y: 200, width, height: 200 });
  giantPage.drawPage(ep2, { x: 0, y: 0, width, height: 200 });
  
  fs.writeFileSync('/tmp/test_pdf_lib.pdf', await newPdf.save());
  console.log("Done");
}
run();
