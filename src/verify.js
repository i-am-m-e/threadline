// verify.js — checking that what the model says is really in the record it cites.
//
// The source guard (llm.js) already removes record ids that don't exist. This file goes one
// step further: a real id with an invented finding should not pass either. Everything here is
// plain code, no AI. Each check returns a problem in plain words (for the model's retry and
// for the log), or null when all is well.
//
// Rules agreed with the founder: docs/specs/2026-11-04-step2-verify-findings.md.

const MIN_QUOTE_WORDS = 4;

/**
 * Make two pieces of text comparable: lower case, straight quotes, one kind of dash,
 * single spaces. Nothing else is changed, so other punctuation still has to match.
 */
export function normalizeText(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

// Quote marks around a quote, and closing punctuation at its end, don't count.
const trimQuote = (q) => q.replace(/^["'\s]+/, "").replace(/["'\s.,;:!?]+$/, "");

/**
 * Is `quote` an exact, continuous stretch of the record's text (not its title)?
 * @returns {string|null} The problem, or null if the quote is fine.
 */
export function quoteProblem(quote, record) {
  const id = record.source_id;
  const q = trimQuote(normalizeText(quote));
  if (!q) return `${id}: needs a quote copied exactly from that record's text.`;
  if (/\.\.\.|…/.test(q)) {
    return `${id}: the quote must be one continuous stretch of the record's text, without "..." joining pieces.`;
  }
  if (q.split(" ").length < MIN_QUOTE_WORDS) {
    return `${id}: the quote "${quote}" is too short; quote at least ${MIN_QUOTE_WORDS} words copied exactly from the record.`;
  }
  if (!normalizeText(record.text).includes(q)) {
    return `${id}: the quote "${quote}" isn't in that record. Copy the words exactly from its text.`;
  }
  return null;
}
