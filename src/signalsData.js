// signalsData.js — the numbers, chart, quotes and actions on the Thread page.
//
// Spec: docs/specs/2026-11-12-signals-redesign.md, section 3. The rule that matters most:
// every number, chart, date and count is worked out here, by code, from the records and the
// Thread's own fields. Nothing is taken from the model's wording. The only model text these
// functions pass on is text that is shown as a draft anyway (a quote that code has checked
// word for word against its record, or the draft's note on a record that doesn't fit).
//
// Plain code, no AI, no drawing: signals-ui.js draws what these return.

import { isFlow, isPolicy, isQualitative, fieldName, safetyConditionsIn, SOURCE_TYPE_NAMES } from "./records.js";
import { quoteProblem } from "./verify.js";
import { isOpen, current } from "./threads.js";
import { whenText } from "./signalsFormat.js";

const HOUR = 60 * 60 * 1000;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const capital = (s) => s.replace(/^./, (c) => c.toUpperCase());
const timeOf = (r) => new Date(r.timestamp).getTime();
const compare = (a, op, b) => (op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : op === "<=" ? a <= b : a === b);
const holds = (record, c) => typeof record[c.metric] === "number" && compare(record[c.metric], c.op, c.value);

/** The trigger this Thread came from: its conditions, e.g. bed occupancy > 0.9 and room-to-physician > 45. */
function triggerConditions(thread, rules) {
  return rules?.[thread.domain]?.triggers?.find((t) => t.pattern_type === thread.pattern_type)?.all ?? [];
}

// How one trigger metric is named and written: minutes as "96 min", a share as "96%".
function describe(condition) {
  const minutes = condition.metric.endsWith("_minutes");
  const share = condition.value > 0 && condition.value < 1;
  const round = (v) => Math.round(v * 100) / 100;
  return {
    ...condition,
    minutes,
    label: fieldName(minutes ? condition.metric.replace(/_minutes$/, "") : condition.metric),
    number: (v) => (share ? Math.round(v * 100) : round(v)),
    text: (v) => (share ? `${Math.round(v * 100)}%` : minutes ? `${round(v)} min` : String(round(v))),
    low: condition.op.startsWith("<"), // a trigger for values that are too LOW
  };
}

// The minutes metric leads (it is the one charted); the others keep the trigger's order.
function metricsOf(thread, rules) {
  const all = triggerConditions(thread, rules).map(describe);
  const lead = all.find((m) => m.minutes) ?? all[0];
  return lead ? [lead, ...all.filter((m) => m !== lead)] : [];
}

const SIDE = { ">": "above", ">=": "at or above", "<": "below", "<=": "at or below" };
const windowRecords = (thread, byId) => thread.windows.flatMap((w) => w.source_ids.map((id) => byId.get(id)).filter(Boolean));
const daysOf = (thread, now) => [...new Set(thread.windows.map((w) => whenText(w.start.slice(0, 10), now)))];

/**
 * The number tiles: the peak of each trigger metric (with its trigger underneath), how many
 * occasions, and how many records are cited. Each has a one-line explanation for hover help.
 * @returns {Array<{label, value, unit, under, help}>}
 */
export function numberTiles(thread, records, rules, now = new Date()) {
  const byId = new Map(records.map((r) => [r.source_id, r]));
  const inWindows = windowRecords(thread, byId);
  const tiles = metricsOf(thread, rules).map((m) => {
    const values = inWindows.map((r) => r[m.metric]).filter((v) => typeof v === "number");
    const peak = values.length ? (m.low ? Math.min(...values) : Math.max(...values)) : null;
    const unit = `${m.minutes ? "min " : m.text(0.5).endsWith("%") ? "% " : ""}at ${m.low ? "lowest" : "peak"}`;
    return {
      label: m.label,
      value: peak === null ? "—" : String(m.number(peak)),
      unit: peak === null ? "records not found" : unit,
      under: `Trigger is ${SIDE[m.op] ?? "at"} ${m.text(m.value)}`,
      help: `${m.label}${m.minutes ? ", in minutes," : ""} at the ${m.low ? "lowest" : "worst"} hour in the pattern's time windows. From the flow records.`,
    };
  });

  const days = daysOf(thread, now);
  tiles.push({
    label: "Occasions",
    value: String(thread.windows.length),
    unit: thread.windows.length === 1 ? "occasion" : "occasions",
    under: days.length <= 3 ? days.join(", ").replace(/, ([^,]*)$/, " and $1") : `${days[0]} to ${days.at(-1)}`,
    help: "Separate times the triggers were crossed. Counted by code; it does not change confidence.",
  });

  const cited = [...new Set(current(thread).steps.pattern.supporting_evidence.map((e) => e.source_id))].filter((id) => !byId.get(id) || !isPolicy(byId.get(id)));
  const kinds = new Map();
  for (const id of cited) {
    const r = byId.get(id);
    const kind = !r ? "record not found" : isFlow(r) ? "flow record" : SOURCE_TYPE_NAMES[r.source_type] ?? r.source_type;
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  tiles.push({
    label: "Evidence",
    value: String(cited.length),
    unit: cited.length === 1 ? "record" : "records",
    under: [...kinds].map(([kind, n]) => (kind === "record not found" ? `${n} not found` : plural(n, kind))).join(", "),
    help: "Records cited for this pattern, not counting policy.",
  });
  return tiles;
}

const hourLabel = (stamp) => {
  const [h, m] = stamp.slice(11, 16).split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "am" : "pm"}`;
};

/**
 * The chart: the leading trigger metric by hour for each occasion, with the trigger value, and
 * which hours crossed every trigger (drawn darker). The hour before and after each window is
 * included when the records have it, so the rise and fall can be seen.
 * @returns {{ title, trigger: {value, text}, max, note, occasions: Array<{day, hours: Array<{label, value, crossed, inWindow, others, source_id}>}> }}
 */
export function chartData(thread, records, rules, now = new Date()) {
  const conditions = triggerConditions(thread, rules);
  const [lead, ...rest] = metricsOf(thread, rules);
  if (!lead) return { title: "", trigger: null, max: 0, note: "", occasions: [] };
  const byId = new Map(records.map((r) => [r.source_id, r]));
  const occasions = thread.windows.map((w) => {
    const inside = w.source_ids.map((id) => byId.get(id)).filter(Boolean);
    if (inside.length === 0) return { day: whenText(w.start.slice(0, 10), now), hours: [] };
    const like = inside[0];
    const from = Math.min(...inside.map(timeOf)) - HOUR;
    const to = Math.max(...inside.map(timeOf)) + HOUR;
    const around = records.filter((r) => r.source_type === like.source_type && r.location === like.location && r.domain === like.domain &&
      timeOf(r) >= from && timeOf(r) <= to && typeof r[lead.metric] === "number");
    const hours = [...new Map(around.map((r) => [r.source_id, r])).values()].sort((a, b) => timeOf(a) - timeOf(b)).map((r) => ({
      label: hourLabel(r.timestamp),
      value: lead.number(r[lead.metric]),
      crossed: conditions.every((c) => holds(r, c)),
      inWindow: w.source_ids.includes(r.source_id),
      others: rest.filter((m) => typeof r[m.metric] === "number").map((m) => m.text(r[m.metric])),
      source_id: r.source_id,
    }));
    return { day: whenText(w.start.slice(0, 10), now), hours };
  }).filter((o) => o.hours.length > 0);

  const crossedText = conditions.length === 1 ? "the trigger" : conditions.length === 2 ? "both triggers" : "all the triggers";
  const under = rest.map((m) => m.label.toLowerCase()).join(" and ");
  return {
    title: `${lead.label}${lead.minutes ? ", minutes" : ""} by hour`,
    trigger: { value: lead.number(lead.value), text: `dashed line = trigger (${lead.text(lead.value)})` },
    max: Math.max(lead.number(lead.value), ...occasions.flatMap((o) => o.hours.map((h) => h.value))),
    note: `Darker bars are the hours that crossed ${crossedText}.${under ? ` The small figure under each hour is ${under}.` : ""}`,
    occasions,
  };
}

/**
 * Key quotes: the quotes cited from incident, complaint and near-miss records. Each is checked
 * again here, word for word against its record (verify.js); one that isn't there is left out.
 * A record that matches one of the domain's safety-relevant conditions is tagged, and comes first.
 */
export function keyQuotes(thread, records, rules, now = new Date()) {
  const byId = new Map(records.map((r) => [r.source_id, r]));
  const pack = rules?.[thread.domain] ?? {};
  const seen = new Set();
  const quotes = [];
  for (const e of current(thread).steps.pattern.supporting_evidence) {
    const record = byId.get(e.source_id);
    const quote = String(e.quote ?? "").trim();
    if (!record || !isQualitative(record) || !quote || seen.has(`${e.source_id} ${quote}`)) continue;
    if (quoteProblem(quote, record) !== null) continue;
    seen.add(`${e.source_id} ${quote}`);
    quotes.push({
      kind: capital(SOURCE_TYPE_NAMES[record.source_type] ?? record.source_type),
      when: whenText(record.timestamp, now),
      quote,
      source_id: record.source_id,
      safety: safetyConditionsIn([record], pack).length > 0,
      trust_label: e.trust_label,
      time: timeOf(record),
    });
  }
  return quotes.sort((a, b) => Number(b.safety) - Number(a.safety) || a.time - b.time).map(({ time, ...q }) => q);
}

const LOOKS_LIKE_AN_ID = /^[A-Z]{2,}(?:-[A-Za-z0-9]+)+$/;
const NOT_FIT_TAG = "Not counted as support";

/**
 * Records the draft listed as not fitting the pattern. The engine often gives only an ID, so
 * each row carries the record's own title, words and time; the draft's wording, if it wrote
 * any, is kept as a note. Code can't tell which way a record points, so the tag only says what
 * is known: it wasn't counted as support. (People mark relevance in the corrections stage.)
 * @returns {Array<{source_id, kind, title, text, when, note, tag}>}
 */
export function recordsThatDontFit(thread, records, now = new Date()) {
  const byId = new Map(records.map((r) => [r.source_id, r]));
  const named = (entry) => records.filter((r) => new RegExp(`(?<![\\w-])${r.source_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(entry)).map((r) => r.source_id);
  const rows = [];
  for (const raw of current(thread).steps.pattern.evidence_that_does_not_fit ?? []) {
    const entry = String(raw ?? "").trim();
    if (!entry) continue;
    const ids = [...new Set(named(entry))];
    if (ids.length === 0) {
      rows.push(LOOKS_LIKE_AN_ID.test(entry)
        ? { source_id: entry, kind: "", title: "Record not found in the processed folder", text: "", when: "", note: "", tag: NOT_FIT_TAG }
        : { source_id: null, kind: "", title: "", text: "", when: "", note: entry, tag: NOT_FIT_TAG });
      continue;
    }
    for (const id of ids) {
      const r = byId.get(id);
      rows.push({
        source_id: id,
        kind: isFlow(r) ? "Flow record" : capital(SOURCE_TYPE_NAMES[r.source_type] ?? r.source_type),
        title: r.title ?? "",
        text: r.text ?? "",
        when: whenText(r.timestamp, now),
        note: entry === id ? "" : entry,
        tag: NOT_FIT_TAG,
      });
    }
  }
  return rows;
}

const ACTIONS = {
  send: "Send for front-line validation",
  accept: "Accept recommendation",
  choose: "Choose another option",
  review: "Start outcome review",
  outcome: "Record outcome",
  info: "Need more information",
  notreal: "Not a real pattern",
  confirm: "Confirm pattern",
  context: "Add context",
  mismatch: "Doesn't match what I see",
};
const MANAGER = {
  "Inferred": ["send", "info", "notreal"],
  "Flagged": ["send", "info", "notreal"],
  "Under review": ["info", "notreal"],
  "Validated pattern": ["accept", "choose", "info"],
  "Decision recorded": ["review", "info"],
  "Outcome review due": ["outcome", "info"],
};
const MAIN = new Set(["send", "accept", "review", "outcome", "confirm"]);

/**
 * The buttons for the header: the current role's actions for the Thread's status, with at most
 * one main action (blue). This only decides what is OFFERED; threads.js still checks the role
 * and the status when a button is pressed.
 * @returns {{ actions: Array<{id, label, primary}>, note: string }}
 */
export function headerActions(thread, role) {
  const list = (ids) => ids.map((id) => ({ id, label: ACTIONS[id], primary: MAIN.has(id) }));
  if (role === "Manager") {
    const waiting = ["Inferred", "Flagged", "Under review"].includes(thread.status);
    return { actions: list(MANAGER[thread.status] ?? []), note: waiting ? "You can choose an approach once a front-line lead has confirmed the pattern." : "" };
  }
  if (role === "Front-line lead") {
    if (thread.status === "Under review") return { actions: list(["confirm", "context", "mismatch"]), note: "" };
    const waiting = ["Inferred", "Flagged"].includes(thread.status);
    return { actions: list(isOpen(thread) ? ["context"] : []), note: waiting ? "Waiting for a manager to send this for front-line validation." : "" };
  }
  return { actions: [], note: "Choose a role (top right) to act on this Thread." };
}

/** One line for the History row: "flagged Nov 10 · updated once", from the Thread's own history. */
export function historySummary(thread, now = new Date()) {
  const history = thread.history ?? [];
  if (history.length === 0) return "";
  const day = (iso) => {
    const d = new Date(iso);
    return whenText(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, now);
  };
  const flagged = history.find((h) => h.status === "Flagged");
  const updates = history.filter((h) => h.type === "update").length;
  const first = flagged ? `flagged ${day(flagged.time)}` : `noticed ${day(history[0].time)}`;
  const times = updates === 0 ? "not updated yet" : updates === 1 ? "updated once" : updates === 2 ? "updated twice" : `updated ${updates} times`;
  return `${first} · ${times}`;
}
