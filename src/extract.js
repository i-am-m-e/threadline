// extract.js — turns an attached file into plain text the AI can read.
//
// Supports plain text (.txt, .md, .csv, …), PDF, Word (.docx) and Excel (.xlsx).
// The libraries that read PDF/Word/Excel live in src/vendor/ and are only
// loaded the first time a file of that kind is attached (they're large).

/**
 * Pull the text out of a file the user picked.
 *
 * @param {File} file  A file from a file picker or drag-and-drop.
 * @param {(fraction: number) => void} [onProgress]  Called with 0…1 as pages are read.
 * @returns {Promise<{text: string, type: string, pages: number | null, pageUnit?: "page" | "sheet"}>}
 *          Text from PDFs (pages) and spreadsheets (sheets) has a "\f" character
 *          between pages/sheets, so passages know where they came from.
 *          `text` may be empty, e.g. for scanned PDFs.
 * @throws {Error} If the file type isn't supported.
 */
export async function extractText(file, onProgress) {
  const name = file.name.toLowerCase();
  const extension = name.includes(".") ? name.split(".").pop() : "";

  if (extension === "pdf") return extractPdf(file, onProgress);
  if (extension === "docx") return extractDocx(file);
  if (extension === "xlsx") return extractXlsx(file);

  if (file.type.startsWith("text/") || ["txt", "md", "csv", "json", "log"].includes(extension)) {
    return { text: await file.text(), type: (extension || "txt").toUpperCase(), pages: null };
  }

  throw new Error(`Sorry, "${file.name}" isn't supported yet. Try PDF, Word (.docx), Excel (.xlsx), .txt, .md or .csv.`);
}

// ---------- PDF (pdf.js by Mozilla) ----------
async function extractPdf(file, onProgress) {
  const pdfjs = await import("./vendor/pdf.min.mjs");
  // pdf.js does its heavy lifting in a separate "worker" script; tell it where that is.
  pdfjs.GlobalWorkerOptions.workerSrc = "./vendor/pdf.worker.min.mjs";

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const content = await (await pdf.getPage(pageNumber)).getTextContent();
    // Each "item" is a small run of text; pdf.js marks line ends with hasEOL.
    // Runs of spaces are squeezed to one, which saves room for the model.
    const pageText = content.items
      .map((item) => item.str + (item.hasEOL ? "\n" : " "))
      .join("")
      .replace(/[ \t]+/g, " ")
      .trim();
    pages.push(pageText);
    if (onProgress) onProgress(pageNumber / pdf.numPages);
  }

  const text = pages.every((p) => !p) ? "" : pages.join("\f");
  return { text, type: "PDF", pages: pdf.numPages, pageUnit: "page" };
}

// ---------- Word (mammoth) ----------
async function extractDocx(file) {
  const mammoth = await loadMammoth();
  const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  // mammoth puts a blank line between paragraphs, which is exactly where passages split.
  return { text: result.value.replace(/\n{3,}/g, "\n\n").trim(), type: "DOCX", pages: null };
}

// mammoth's browser version is an old-style script that sets a global `mammoth`,
// so we add it to the page with a <script> tag the first time it's needed.
function loadMammoth() {
  if (globalThis.mammoth) return Promise.resolve(globalThis.mammoth);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "./vendor/mammoth.browser.min.js";
    script.onload = () => resolve(globalThis.mammoth);
    script.onerror = () => reject(new Error("Couldn't load the Word reader."));
    document.head.append(script);
  });
}

// ---------- Excel (SheetJS) ----------
async function extractXlsx(file) {
  const XLSX = await import("./vendor/xlsx.mjs");
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  const sheets = workbook.SheetNames.map((sheetName) => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false, defval: "" });
    return `Sheet "${sheetName}"\n\n` + describeRows(rows);
  });
  return { text: sheets.join("\f"), type: "XLSX", pages: workbook.SheetNames.length, pageUnit: "sheet" };
}

// Turn a table into one line per row that names each value, e.g.
//   "Unit: 4B; Patients on 10+ meds: 12; Reviews done: 9"
// Each row stands on its own, so a cited passage still makes sense without the header.
// Rows are separated by blank lines, which is where passages prefer to split.
export function describeRows(rows) {
  if (rows.length === 0) return "(empty sheet)";
  const [header, ...body] = rows;
  const names = header.map((h, i) => String(h).trim() || `Column ${i + 1}`);
  if (body.length === 0) return names.join("; ");
  return body
    .map((row) =>
      names
        .map((name, i) => [name, String(row[i] ?? "").trim()])
        .filter(([, value]) => value !== "")
        .map(([name, value]) => `${name}: ${value}`)
        .join("; ")
    )
    .filter(Boolean)
    .join("\n\n");
}
