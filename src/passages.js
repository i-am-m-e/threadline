// passages.js — splits documents into numbered passages so the AI can cite them.
//
// How citations work:
//   1. Each document is cut into passages of roughly a paragraph (splitIntoPassages).
//   2. Every passage in the thread gets a number, and the AI is told:
//      "cite passages like [3]" (buildSourcesPrompt).
//   3. When a reply comes back, we find the [3]-style markers (findCitations)
//      and turn them into clickable citations on screen.
//
// Nothing here touches the screen or the AI directly, which keeps it easy to test.

const TARGET_PASSAGE_CHARS = 600; // longest a passage usually gets
const MIN_PASSAGE_CHARS = 80;     // shorter paragraphs (like headings) join the next one

/**
 * Cut a document's text into passages.
 * PDF text has a "\f" (form feed) between pages, so we can say which page a passage is on.
 *
 * @param {string} text
 * @returns {Array<{index: number, page: number | null, start: number, end: number, text: string}>}
 *          start/end are character positions in `text`, used to highlight the passage later.
 */
export function splitIntoPassages(text) {
  const passages = [];
  const pageTexts = text.split("\f");
  const hasPages = pageTexts.length > 1;
  let pageStart = 0;

  pageTexts.forEach((pageText, pageIndex) => {
    // Where we can cut: at paragraph breaks (best, so each section gets its own
    // number, which helps small models cite the right one) or at sentence ends.
    const endsOf = (pattern) => [...pageText.matchAll(pattern)].map((m) => m.index + m[0].length);
    const paragraphCuts = endsOf(/\n\s*\n/g);
    const sentenceCuts = endsOf(/[.!?]["')\]]*\s+/g);

    let start = 0;
    while (start < pageText.length) {
      const limit = start + TARGET_PASSAGE_CHARS;
      const within = (p) => p > start && p <= limit;
      // 1. the first paragraph break that isn't too early,
      // 2. else the last sentence end that fits,
      // 3. else (one enormous sentence) the last space that fits.
      let end =
        paragraphCuts.find((p) => within(p) && p - start >= MIN_PASSAGE_CHARS) ??
        (limit >= pageText.length ? pageText.length : sentenceCuts.filter(within).pop());
      if (!end) end = pageText.lastIndexOf(" ", limit) > start ? pageText.lastIndexOf(" ", limit) : limit;

      const raw = pageText.slice(start, end);
      const trimmed = raw.trim();
      if (trimmed) {
        const from = pageStart + start + (raw.length - raw.trimStart().length);
        passages.push({
          index: passages.length,
          page: hasPages ? pageIndex + 1 : null,
          start: from,
          end: from + trimmed.length,
          text: trimmed,
        });
      }
      start = end;
    }
    pageStart += pageText.length + 1; // +1 for the "\f" we split on
  });

  return passages;
}

/** A short human label for a passage, like: p. 4 · "The warehouse in Denver stores…" */
export function passageLabel(passage) {
  const words = passage.text.replace(/\s+/g, " ").split(" ");
  const snippet = words.slice(0, 7).join(" ") + (words.length > 7 ? "…" : "");
  return (passage.page ? `p. ${passage.page} · ` : "") + `“${snippet}”`;
}

/**
 * Build the instructions + numbered passages we send to the AI.
 *
 * @param {Array<{id: string, name: string, text: string}>} documents  In the order they were added.
 * @param {number} maxCharsPerDocument  Passages past this point are left out (small models run out of room).
 * @returns {{ prompt: string, numbers: Object<string, {docId: string, index: number}> }}
 *          `numbers` maps each passage number the AI sees to where that passage lives.
 */
export function buildSourcesPrompt(documents, maxCharsPerDocument) {
  const numbers = {};
  let n = 0;
  const sections = documents.map((doc) => {
    const lines = splitIntoPassages(doc.text)
      .filter((p) => p.start < maxCharsPerDocument)
      .map((p) => {
        n += 1;
        numbers[n] = { docId: doc.id, index: p.index };
        return `[${n}]${p.page ? ` (page ${p.page})` : ""} ${p.text.replace(/\s+/g, " ")}`;
      });
    return `Document: "${doc.name}"\n${lines.join("\n")}`;
  });

  // The rules go AFTER the documents: small models follow what they read last best.
  const prompt =
    `You are Threadline, an assistant that answers questions using the user's documents.\n\n` +
    sections.join("\n\n") +
    `\n\nAnswer using the numbered passages above. After each sentence that uses a passage, ` +
    `write that passage's number in square brackets, like [2]. Every fact from the documents ` +
    `needs a citation. Check the number matches the passage you used. ` +
    `If the documents don't cover the question, say so plainly instead of guessing.`;

  return { prompt, numbers };
}

/** A short reminder added to the user's latest question (small models forget the rules). */
export const CITE_REMINDER = "\n\n(Cite passage numbers like [2].)";

// Matches [3], [3, 5], [3][5] (as two matches) and [Passage 3]. It skips Markdown
// links like [3](https://…) because a link has "(" straight after the "]".
const CITATION_PATTERN = /\[(?:passages?\s*)?(\d+(?:\s*[,;]\s*\d+)*)\](?!\()/gi;

/**
 * Find citation markers in a reply.
 * @param {string} text
 * @returns {Array<{match: string, at: number, numbers: number[]}>}
 */
export function findCitations(text) {
  return [...text.matchAll(CITATION_PATTERN)].map((m) => ({
    match: m[0],
    at: m.index,
    numbers: m[1].split(/[,;]/).map((s) => Number(s.trim())),
  }));
}

/**
 * Replace citation markers with the output of `makeMarker(number)`, in one pass.
 * Numbers the AI made up (not in `known`) are left as plain text.
 */
export function replaceCitations(text, known, makeMarker) {
  return text.replace(CITATION_PATTERN, (whole, list) => {
    const numbers = list.split(/[,;]/).map((s) => Number(s.trim()));
    if (!numbers.every((num) => num in known)) return whole;
    return numbers.map(makeMarker).join("");
  });
}
