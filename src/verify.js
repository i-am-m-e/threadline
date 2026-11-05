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

// A record's id, time, date and title are labels, not quantities: their numbers only count
// when the text uses them AS an id, time or date (see withoutOwnReferences). So "15 patients"
// doesn't pass because a record is timestamped 15:00, nor "4471 patients" because of HC-CMP-4471.
const LABEL_FIELDS = new Set(["source_id", "timestamp", "title", "location", "domain", "source_type"]);
const MONTHS = ["jan(?:uary)?", "feb(?:ruary)?", "mar(?:ch)?", "apr(?:il)?", "may", "june?", "july?", "aug(?:ust)?", "sep(?:t(?:ember)?)?", "oct(?:ober)?", "nov(?:ember)?", "dec(?:ember)?"];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The text with the records' own ids, times and dates taken out, so their digits aren't
 * mistaken for quantities. Times may be written on a 24- or 12-hour clock ("15:30", "3:30 PM",
 * "3 PM"); dates as "2026-09-20", "Sept 20", "September 20th" or "20 September".
 */
function withoutOwnReferences(text, records, { timesAndDates = true } = {}) {
  let out = String(text ?? "");
  for (const r of records) {
    if (r.source_id) out = out.replace(new RegExp(escapeRe(r.source_id), "g"), " ");
    const m = timesAndDates && typeof r.timestamp === "string" && r.timestamp.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    if (!m) continue;
    const [, year, month, day, hh, mm] = m;
    const d = Number(day);
    const monthName = MONTHS[Number(month) - 1];
    out = out
      .replace(new RegExp(`${year}-${month}-${day}`, "g"), " ")
      .replace(new RegExp(`\\b${monthName}\\.?\\s+0?${d}(?:st|nd|rd|th)?\\b`, "gi"), " ")
      .replace(new RegExp(`\\b0?${d}(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthName}\\b`, "gi"), " ");
    if (hh === undefined) continue;
    const h24 = Number(hh);
    const h12 = h24 % 12 || 12;
    out = out
      .replace(new RegExp(`\\b0?(?:${h24}|${h12}):${mm}(?:\\s*[ap]\\.?m\\.?)?`, "gi"), " ")
      .replace(new RegExp(`\\b${h12}\\s*[ap]\\.?m\\b\\.?`, "gi"), " ");
  }
  return out;
}

/**
 * The numbers a text may mention as quantities for this record: its values and the numbers in
 * its text (not its id, time or date: see LABEL_FIELDS), the same numbers as percents, and
 * hours/minutes conversions for numbers the record itself labels as hours or minutes.
 * Plus the domain's thresholds.
 */
function allowedNumbers(record, thresholds, { byReference = false } = {}) {
  const base = [...thresholds];
  const converted = [];
  for (const [field, value] of Object.entries(record)) {
    if (SKIP_FIELDS.has(field) || LABEL_FIELDS.has(field)) continue;
    if (typeof value === "number") {
      if (byReference && isFlow(record)) continue; // by reference, a flow row's figures are written {ID.field}
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
export function numberProblems(finding, record, thresholds, { byReference = false } = {}) {
  const { stripped, problems } = byReference ? checkReferences(finding, [record]) : { stripped: finding, problems: [] };
  const allowed = allowedNumbers(record, thresholds, { byReference });
  const missing = [...new Set(numbersIn(withoutOwnReferences(stripped, [record], { timesAndDates: !byReference })))]
    .filter((n) => !allowed.some((a) => same(a, n)));
  const out = problems.map((p) => `${record.source_id}: ${p}`);
  if (missing.length) {
    out.push(`${record.source_id}: the finding mentions ${missing.join(", ")}, which ${missing.length === 1 ? "isn't" : "aren't"} in that record. ` +
      (byReference ? referenceHint(missing, [record]) : "Use the record's own numbers."));
  }
  return out;
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
export function evidenceProblems(item, record, thresholds, { byReference = false } = {}) {
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
  problems.push(...numberProblems(item.finding ?? "", record, thresholds, { byReference }));
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
export function claimNumberProblems(text, records, thresholds, { where = "the records it cites", byReference = false } = {}) {
  const { stripped, problems } = byReference ? checkReferences(text, records) : { stripped: text, problems: [] };
  const refProblems = problems.map((p) => `"${text}": ${p}`);
  const allowed = [...thresholds, ...records.flatMap((r) => allowedNumbers(r, [], { byReference }))];
  const withPercents = [...allowed, ...thresholds.flatMap(asPercent)];
  const missing = [...new Set(numbersIn(withoutOwnReferences(stripped, records, { timesAndDates: !byReference })))]
    .filter((n) => !withPercents.some((a) => same(a, n)));
  if (missing.length === 0) return refProblems;
  const all = records.map((r) => r.source_id);
  const ids = all.length > 3 ? `${all.slice(0, 3).join(", ")} and ${all.length - 3} more` : all.join(", ");
  return [...refProblems, `"${text}" mentions ${missing.join(", ")}, which ${missing.length === 1 ? "isn't" : "aren't"} in ${where} (${ids}).` +
    (byReference ? ` ${referenceHint(missing, records)}` : "")];
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


// ---------- Numbers by reference (SIGNALS_CONFIG.numbersByReference) ----------
// The model writes figures from flow rows, and every time and date, as references that code
// fills in after all the checks: {ID.field} (a number field), {ID.field%} (the same as a
// percent), {ID.time}, {ID.date}. A misstated figure is then impossible by construction.

const REFERENCE = /\{([A-Za-z0-9][A-Za-z0-9_-]*)\.([a-z][a-z0-9_]*)(%?)\}/g;
const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The value a reference stands for, as people read it, or null if it doesn't resolve. */
function referenceValue(record, field, percent) {
  if (!record) return null;
  const ts = typeof record.timestamp === "string" && record.timestamp.match(/^\d{4}-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/);
  const asDate = () => (ts ? `${MONTH_ABBR[Number(ts[1]) - 1]} ${Number(ts[2])}` : null);
  if (field === "time") return ts?.[3] ?? null;
  if (field === "date") return asDate();
  // Every record's own field is literally called "timestamp" (records.js requires it), so that is
  // the name the model sees in the prompt and reaches for. Accept it as well as {ID.time}/{ID.date}:
  // the time when the record has one, otherwise the date.
  if (field === "timestamp") return ts ? (ts[3] ?? asDate()) : null;
  const v = record[field];
  if (typeof v !== "number" || SKIP_FIELDS.has(field)) return null;
  if (percent) return `${v > 0 && v <= 1 ? Math.round(v * 100) : v}%`;
  return String(v);
}

/** The fields of a record that a {ID.field} reference can actually resolve to. */
const numberFieldsOf = (record) => Object.entries(record)
  .filter(([field, v]) => typeof v === "number" && !SKIP_FIELDS.has(field))
  .map(([field]) => field);

/** Problems with a text's references (each must name a record it can cite, and a real field). */
function checkReferences(text, records) {
  const problems = [];
  const stripped = String(text ?? "").replace(REFERENCE, (whole, id, field, percent) => {
    const record = records.find((r) => r.source_id === id);
    if (!record) problems.push(`${whole}: ${id} isn't a record this can cite.`);
    else if (referenceValue(record, field, percent) === null) {
      // Name the forms that do work, and this record's own number fields: without them the model
      // has nothing to correct towards and repeats the same reference on every retry.
      const fields = numberFieldsOf(record);
      problems.push(`${whole}: ${id} has no number field "${field}". ` +
        `Write its time or date as {${id}.time} or {${id}.date}` +
        (fields.length ? `; its number fields are ${fields.join(", ")}.` : "."));
    }
    return " ";
  });
  return { stripped, problems };
}

/** How to write a typed figure as a reference, using the first field it matches. */
function referenceHint(missing, records) {
  for (const n of missing) {
    for (const r of records) {
      for (const [field, v] of Object.entries(r)) {
        if (typeof v === "number" && !SKIP_FIELDS.has(field) && (same(v, n) || asPercent(v).some((p) => same(p, n)))) {
          return `Write figures from a flow row as references, like {${r.source_id}.${field}${same(v, n) ? "" : "%"}}.`;
        }
      }
    }
  }
  return "Write figures from flow rows, and times and dates, as references like {ID.field}, {ID.time} or {ID.date}.";
}

// Fields that are never filled in: quotes must stay exactly as the record wrote them, and ids are ids.
const NO_RESOLVE = new Set(["quote", "policy_quote", "source_id", "source_ids", "policy_source_id", "evidence_ids",
  "id", "source", "target", "option_id", "leading_option_id", "vignette_id", "field"]);

/**
 * Fill in every reference in the model's text with the record's value (a copy; the input is
 * unchanged). A reference that doesn't resolve becomes "[figure not found]".
 * @param {*} value  Any step output (or several).
 * @param {Map<string, object>} byId  Records by source_id.
 * @returns {{ value, resolved: number, unresolved: number }}
 */
export function resolveReferences(value, byId) {
  let resolved = 0;
  let unresolved = 0;
  const fill = (text) => text.replace(REFERENCE, (whole, id, field, percent) => {
    const v = referenceValue(byId.get(id), field, percent);
    if (v === null) { unresolved += 1; return "[figure not found]"; }
    resolved += 1;
    return v;
  });
  const walk = (node, key) => {
    if (typeof node === "string") return NO_RESOLVE.has(key) ? node : fill(node);
    if (Array.isArray(node)) return node.map((x) => walk(x, key));
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
    return node;
  };
  return { value: walk(value, null), resolved, unresolved };
}
