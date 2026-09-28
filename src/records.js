// records.js — reading operational records and checking triggers (Layer 1).
//
// Everything here is plain code, no AI: it reads CSV/JSON records, works out which
// hours break the domain's trigger thresholds (from domain_rules.json), groups them
// into time windows, and finds the incident/complaint records near each window.
// Only when a trigger fires does the (slower) AI pipeline run.
//
// Systems, not people: records describe flows, queues, capacity and events. There
// are no fields about individuals, and nothing here scores anyone.

const FLOW_TYPES = new Set(["emr_flow", "permit_log"]);
const QUALITATIVE_TYPES = new Set(["incident_report", "complaint", "near_miss"]);
const TWO_HOURS = 2 * 60 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

export const isFlow = (r) => FLOW_TYPES.has(r.source_type);
export const isQualitative = (r) => QUALITATIVE_TYPES.has(r.source_type);
export const isPolicy = (r) => r.source_type === "policy";

// Plain-language names for source types (for cards and badges).
export const SOURCE_TYPE_NAMES = {
  emr_flow: "EMR flow export",
  permit_log: "permit log",
  incident_report: "incident report",
  complaint: "complaint",
  near_miss: "near-miss report",
  policy: "policy",
};

// ---------- Reading files ----------

/**
 * Turn one file into records. CSV: one record per row. JSON: one record (or a list).
 * Numbers in CSV become numbers; "true"/"false" become true/false. Each record keeps
 * the file it came from. Derived metrics (like permits per inspector) are added here.
 */
export function parseRecordFile(fileName, text) {
  let records;
  if (fileName.toLowerCase().endsWith(".csv")) {
    records = parseCsv(text);
  } else if (fileName.toLowerCase().endsWith(".json")) {
    const data = JSON.parse(text);
    records = Array.isArray(data) ? data : [data];
  } else {
    throw new Error(`"${fileName}" isn't a CSV or JSON record file.`);
  }
  for (const r of records) {
    if (!r.source_id || !r.source_type || !r.timestamp) {
      throw new Error(`A record in "${fileName}" is missing source_id, source_type or timestamp.`);
    }
    r.file = fileName;
    addDerivedMetrics(r);
  }
  return records;
}

// A simple CSV reader for our record files: a header row, then one row per record.
// Handles quoted values containing commas ("a, b").
export function parseCsv(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  const split = (line) => {
    const cells = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"' && quoted) { cell += '"'; i++; }
      else if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { cells.push(cell); cell = ""; }
      else cell += ch;
    }
    cells.push(cell);
    return cells.map((c) => c.trim());
  };
  const header = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    return Object.fromEntries(header.map((name, i) => [name, typed(cells[i] ?? "")]));
  });
}

const typed = (v) => (v === "true" ? true : v === "false" ? false : v !== "" && !isNaN(Number(v)) ? Number(v) : v);

// Metrics worked out from others. Energy triggers use "permits per inspector".
function addDerivedMetrics(r) {
  if (typeof r.active_permits === "number" && typeof r.inspectors_on_duty === "number" && r.inspectors_on_duty > 0) {
    r.permits_per_inspector = Math.round((r.active_permits / r.inspectors_on_duty) * 100) / 100;
  }
}

/**
 * A record file as readable text (for "Discuss in a thread"): one paragraph per record,
 * naming each field, e.g. "Timestamp: 2026-09-20T15:00; Bed occupancy: 0.93; …".
 * Returns the text and the trust label for the chat's source-type picker.
 */
export function recordFileAsText(fileName, raw) {
  const records = parseRecordFile(fileName, raw);
  const nice = (key) => key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const skip = new Set(["file", "synthetic", "text", "title"]);
  const paragraphs = records.map((r) => {
    const fields = Object.entries(r).filter(([k]) => !skip.has(k)).map(([k, v]) => `${nice(k)}: ${v}`).join("; ");
    return [r.title, r.text, fields].filter(Boolean).join("\n");
  });
  return {
    text: `Synthetic records from ${fileName}\n\n${paragraphs.join("\n\n")}`,
    trustLabel: records.every(isPolicy) ? "Authoritative" : "Observed",
  };
}

// ---------- Triggers ----------

const compare = (a, op, b) => (op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : op === "<=" ? a <= b : a === b);
const conditionHolds = (record, c) => typeof record[c.metric] === "number" && compare(record[c.metric], c.op, c.value);

/**
 * Check every flow record against the domain's triggers and group the hours that fire
 * into windows (consecutive hours at the same location).
 *
 * @param {Array} records  All records (only flow records are checked).
 * @param {object} rules   The whole domain_rules.json.
 * @returns {Array<{domain, pattern_type, location, start, end, flowRecords}>}
 */
export function findTriggeredWindows(records, rules) {
  const windows = [];
  for (const [domain, pack] of Object.entries(rules)) {
    for (const trigger of pack.triggers ?? []) {
      const firing = records
        .filter((r) => r.domain === domain && r.source_type === trigger.source_type)
        .filter((r) => trigger.all.every((c) => conditionHolds(r, c)))
        .sort((a, b) => time(a) - time(b));
      for (const r of firing) {
        const open = windows.find(
          (w) => w.pattern_type === trigger.pattern_type && w.location === r.location && time(r) - time(w.flowRecords.at(-1)) <= ONE_HOUR
        );
        if (open) {
          open.flowRecords.push(r);
          open.end = r.timestamp;
        } else {
          windows.push({ domain, pattern_type: trigger.pattern_type, location: r.location, start: r.timestamp, end: r.timestamp, flowRecords: [r] });
        }
      }
    }
  }
  return windows;
}

/** Incident, complaint and near-miss records at the same location within ±2 hours of a window. */
export function qualitativeNear(window, records) {
  const from = time({ timestamp: window.start }) - TWO_HOURS;
  const to = time({ timestamp: window.end }) + TWO_HOURS;
  return records.filter((r) => isQualitative(r) && r.location === window.location && time(r) >= from && time(r) <= to);
}

/** The domain's policies at that location (or with no location). */
export function policiesFor(domain, location, records) {
  return records.filter((r) => isPolicy(r) && r.domain === domain && (!r.location || r.location === location));
}

/**
 * Which of the domain's safety-relevant conditions show up in these records?
 * A condition is either a metric threshold (checked on flow records) or groups of
 * words that must all appear (one word from each group) in a record's text.
 * @returns {Array<{id, label, source_ids}>}
 */
export function safetyConditionsIn(records, pack) {
  const hits = [];
  for (const condition of pack.safety_relevant_conditions ?? []) {
    const matching = records.filter((r) => {
      if (condition.metric) return conditionHolds(r, condition);
      const text = `${r.title ?? ""} ${r.text ?? ""}`.toLowerCase();
      return (condition.text_groups ?? []).every((group) => group.some((w) => text.includes(w.toLowerCase())));
    });
    if (matching.length > 0) hits.push({ id: condition.id, label: condition.label, source_ids: matching.map((r) => r.source_id) });
  }
  return hits;
}

// ---------- Confidence, by the spec's own definition ----------

/**
 * The most confidence the cited evidence can support (spec, Prompt 1 rule 5):
 *   High   = at least two source types agree in more than one time window
 *            (read strictly: at least 2 windows that each have 2+ source types)
 *   Medium = two source types agree in one window
 *   Low    = one source type, or a single short window
 * @param {Array<Array>} citedRecordsByWindow  For each window, the records the model cited in it.
 */
export function maxConfidence(citedRecordsByWindow) {
  const agreeing = citedRecordsByWindow.filter((recs) => new Set(recs.map((r) => r.source_type)).size >= 2).length;
  if (agreeing >= 2) return "High";
  if (agreeing === 1) return "Medium";
  return "Low";
}

export const CONFIDENCE_ORDER = ["Low", "Medium", "High"];
export const lowerOf = (a, b) => (CONFIDENCE_ORDER.indexOf(a) <= CONFIDENCE_ORDER.indexOf(b) ? a : b);

// Timestamps like "2026-09-20T15:30" are read as local time.
export const time = (r) => new Date(r.timestamp).getTime();
