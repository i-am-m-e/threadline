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

// ---------- Numbers in the finding's wording ----------

const NUMBER = /\d+(?:\.\d+)?/g;
const HOURS_IN_TEXT = /(\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?)\b/gi;
const MINUTES_IN_TEXT = /(\d+(?:\.\d+)?)\s*-?\s*(?:minutes?|mins?)\b/gi;
const SKIP_FIELDS = new Set(["file", "synthetic"]);
const same = (a, b) => Math.abs(a - b) < 1e-6;

/** Every number written in a piece of text, e.g. "At 15:30, 0.93" → [15, 30, 0.93]. */
export const numbersIn = (text) => (String(text).match(NUMBER) ?? []).map(Number);

// Minutes → hours, only for whole or half hours (90 → 1.5; 85 → nothing).
const asHours = (minutes) => (Number.isInteger((minutes / 60) * 2) ? [minutes / 60] : []);
// A fraction may be written as a percent, exactly or rounded (0.955 → 95.5 and 96).
const asPercent = (v) => (v > 0 && v < 1 ? [v * 100, Math.round(v * 100)] : []);

/**
 * The numbers a finding may mention for this record: every number in the record (its
 * values, text, time and id), the same numbers as percents, and hours/minutes conversions
 * for numbers the record itself labels as hours or minutes. Plus the domain's thresholds.
 */
function allowedNumbers(record, thresholds) {
  const base = [...thresholds];
  const converted = [];
  for (const [field, value] of Object.entries(record)) {
    if (SKIP_FIELDS.has(field)) continue;
    if (typeof value === "number") {
      base.push(value);
      if (field.endsWith("_minutes")) converted.push(...asHours(value));
    } else if (typeof value === "string") {
      base.push(...numbersIn(value));
      for (const m of value.matchAll(HOURS_IN_TEXT)) converted.push(Number(m[1]) * 60);
      for (const m of value.matchAll(MINUTES_IN_TEXT)) converted.push(...asHours(Number(m[1])));
    }
  }
  return [...base, ...base.flatMap(asPercent), ...converted];
}

/**
 * Every number in a finding's wording must be in the record it cites (see allowedNumbers).
 * Numbers written as words ("two") aren't checked, and units aren't compared.
 * @param {string} finding
 * @param {object} record
 * @param {number[]} thresholds  The domain's own thresholds (see thresholdsOf).
 * @returns {string[]} Problems (at most one per record), empty if all is well.
 */
export function numberProblems(finding, record, thresholds) {
  const allowed = allowedNumbers(record, thresholds);
  const missing = [...new Set(numbersIn(finding))].filter((n) => !allowed.some((a) => same(a, n)));
  if (missing.length === 0) return [];
  return [`${record.source_id}: the finding mentions ${missing.join(", ")}, which ${missing.length === 1 ? "isn't" : "aren't"} in that record. Use the record's own numbers.`];
}

/** The numbers in a domain's trigger and safety thresholds, e.g. 0.9, 45, 60. */
export function thresholdsOf(pack) {
  const conditions = [...(pack.triggers ?? []).flatMap((t) => t.all ?? []), ...(pack.safety_relevant_conditions ?? [])];
  return [...new Set(conditions.map((c) => c.value).filter((v) => typeof v === "number"))];
}
