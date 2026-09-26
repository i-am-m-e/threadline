// extract.js — turns an attached file into plain text the AI can read.
//
// Supports plain text files (.txt, .md, .csv, ...) and PDFs.
// PDF reading is done by pdf.js (a library by Mozilla, in src/vendor/).

import * as pdfjs from "./vendor/pdf.min.mjs";

// pdf.js does its heavy lifting in a separate "worker" script; tell it where that is.
pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

/**
 * Pull the text out of a file the user picked.
 *
 * @param {File} file  A file from an <input type="file"> element.
 * @returns {Promise<string>} The file's text (may be empty for scanned PDFs).
 * @throws {Error} If the file type isn't supported.
 */
export async function extractText(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    return extractPdfText(file);
  }

  if (file.type.startsWith("text/") || /\.(txt|md|csv|json|log)$/.test(name)) {
    return file.text();
  }

  throw new Error(`Sorry, "${file.name}" isn't supported yet. Try a .txt or .pdf file.`);
}

async function extractPdfText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    // Each "item" is a small run of text on the page; join them with spaces.
    // Then squeeze runs of spaces down to one, which saves room for the model.
    const pageText = content.items.map((item) => item.str).join(" ").replace(/[ \t]+/g, " ");
    pages.push(pageText);
  }

  return pages.join("\n\n").trim();
}
