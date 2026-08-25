const { PDFDocument } = require('pdf-lib');
async function run() {
  const newPdf = await PDFDocument.create();
  console.log(newPdf.embedPage.toString());
}
run();
