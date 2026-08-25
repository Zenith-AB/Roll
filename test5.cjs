const { PDFDocument, rgb } = require('pdf-lib');
const fs = require('fs');
async function run() {
  const newPdf = await PDFDocument.create();
  const page = newPdf.addPage([500, 500]);
  try {
    page.drawText("Hello World", { x: 50, y: 50, size: 12, color: rgb(1,0,0) });
    console.log("Success");
  } catch (e) {
    console.log("Error:", e.message);
  }
}
run();
