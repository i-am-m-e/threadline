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
 * @param {File} file  A file from a file picker or drag-and-drop.
 * @param {(fraction: number) => void} [onProgress]  Called with 0…1 as pages are read.
 * @returns {Promise<{text: string, type: string, pages: number | null}>}
 *          PDF text has a "\f" character between pages so passages know their page.
 *          `text` may be empty for scanned PDFs.
 * @throws {Error} If the file type isn't supported.
 */
export async function extractText(file, onProgress) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    return extractPdfText(file, onProgress);
  }

  if (file.type.startsWith("text/") || /\.(txt|md|csv|json|log)$/.test(name)) {
    const extension = name.includes(".") ? name.split(".").pop().toUpperCase() : "TXT";
    return { text: await file.text(), type: extension, pages: null };
  }

  throw new Error(`Sorry, "${file.name}" isn't supported yet. Try a .txt, .md, .csv or .pdf file.`);
}

async function extractPdfText(file, onProgress) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    // Each "item" is a small run of text on the page; join them with spaces.
    // Then squeeze runs of spaces down to one, which saves room for the model.
    // (pdf.js marks line ends with hasEOL, so we keep those as line breaks.)
    const pageText = content.items
      .map((item) => item.str + (item.hasEOL ? "\n" : " "))
      .join("")
      .replace(/[ \t]+/g, " ")
      .trim();
    pages.push(pageText);
    if (onProgress) onProgress(pageNumber / pdf.numPages);
  }

  const text = pages.every((p) => !p) ? "" : pages.join("\f");
  return { text, type: "PDF", pages: pdf.numPages };
}
