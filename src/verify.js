// verify.js — checking that what the model says is really in the record it cites.
//
// The source guard (llm.js) already removes record ids that don't exist. This file goes one
// step further: a real id with an invented finding should not pass either. Everything here is
// plain code, no AI. Each check returns a problem in plain words (for the model's retry and
// for the log), or null when all is well.
//
// Rules agreed with the founder: docs/specs/2026-11-04-step2-verify-findings.md.

import { isFlow, isPolicy } from "./records.js";

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
      // The record's own hour on a 12-hour clock ("15:00" may be written "3:00 PM").
      const hour = field === "timestamp" && value.match(/T(\d{2}):/);
      if (hour) converted.push(Number(hour[1]) % 12 || 12);
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

// ---------- Record values (flow records) ----------

// A claimed value matches the record's value exactly, or as a percent of a fraction (96 for 0.96).
const sameValue = (claimed, actual) => same(claimed, actual) || asPercent(actual).some((p) => same(p, claimed));

/**
 * Each { field, value } must be a field of the record with that value.
 * @returns {string[]} Problems, empty if all is well.
 */
export function recordValueProblems(recordValues, record) {
  const problems = [];
  for (const { field, value } of recordValues) {
    if (SKIP_FIELDS.has(field) || !(field in record)) {
      problems.push(`${record.source_id}: has no field "${field}". Use the field names exactly as they appear in the record.`);
    } else if (typeof record[field] !== "number" || !sameValue(value, record[field])) {
      problems.push(`${record.source_id}: ${field} is ${record[field]} in that record, not ${value}.`);
    }
  }
  return problems;
}

// ---------- One supporting-evidence item, and the policy gap ----------

/**
 * Check one supporting-evidence item against the record it cites:
 *  - flow records (CSV rows): at least one { field, value }, all matching; no quote (no text);
 *  - incident, complaint and near-miss records: a quote from the record's text; no record_values;
 *  - either way, every number in the finding's wording is in the record.
 * @returns {string[]} Problems, empty if the item is verified.
 */
export function evidenceProblems(item, record, thresholds) {
  const id = record.source_id;
  const values = item.record_values ?? [];
  const problems = [];
  if (isFlow(record)) {
    if (values.length === 0) problems.push(`${id}: needs record_values: the field and value this finding relies on, e.g. { "field": "room_to_physician_minutes", "value": 90 }.`);
    if ((item.quote ?? "").trim()) problems.push(`${id}: flow records have no text to quote; leave quote empty and use record_values.`);
    problems.push(...recordValueProblems(values, record));
  } else {
    const quote = quoteProblem(item.quote, record);
    if (quote) problems.push(quote);
    if (values.length > 0) problems.push(`${id}: this kind of record has no fields to check; leave record_values empty and quote its text.`);
  }
  problems.push(...numberProblems(item.finding ?? "", record, thresholds));
  return problems;
}

/**
 * The policy-practice gap must quote the policy it cites.
 * @param {object} gap  Prompt 2's policy_practice_gap.
 * @param {object} policy  The cited policy record.
 * @returns {string|null}
 */
export function policyQuoteProblem(gap, policy) {
  const problem = quoteProblem(gap.policy_quote, policy);
  return problem && `policy_practice_gap: ${problem}`;
}

// ---------- Analysis claims: contributing conditions and the pressure map ----------

/**
 * Every number in a claim's text must be in at least one of the records it cites (or be one
 * of the domain's thresholds). The same number rules as numberProblems.
 * @param {string} text
 * @param {Array} records  The records the claim cites (or, if it cites none, all the step's inputs).
 * @param {{where?: string}} [options]  How to name those records in the message.
 * @returns {string[]}
 */
export function claimNumberProblems(text, records, thresholds, { where = "the records it cites" } = {}) {
  const allowed = [...thresholds, ...records.flatMap((r) => allowedNumbers(r, []))];
  const withPercents = [...allowed, ...thresholds.flatMap(asPercent)];
  const missing = [...new Set(numbersIn(text))].filter((n) => !withPercents.some((a) => same(a, n)));
  if (missing.length === 0) return [];
  const all = records.map((r) => r.source_id);
  const ids = all.length > 3 ? `${all.slice(0, 3).join(", ")} and ${all.length - 3} more` : all.join(", ");
  return [`"${text}" mentions ${missing.join(", ")}, which ${missing.length === 1 ? "isn't" : "aren't"} in ${where} (${ids}).`];
}

/**
 * The trust label a claim can honestly carry, given the records it cites:
 *  • Inferred stays Inferred (the model is saying it's unconfirmed);
 *  • citing no records → Inferred;
 *  • Authoritative needs a policy; Observed needs a flow, incident, complaint or near-miss record;
 *  • Experiential and Historical come only from people (Add context, past decisions), so the
 *    model can't claim them: they become Observed or Authoritative from what's cited.
 * @returns {string} The same label if it fits, otherwise the one that does.
 */
export function fittingTrustLabel(label, records) {
  if (label === "Inferred") return label;
  if (records.length === 0) return "Inferred";
  const hasPolicy = records.some(isPolicy);
  const hasObserved = records.some((r) => !isPolicy(r));
  if (label === "Authoritative") return hasPolicy ? label : "Observed";
  if (label === "Observed") return hasObserved ? label : "Authoritative";
  return hasObserved ? "Observed" : "Authoritative";
}
