// signalsMap.js — what the Map tab draws: the timeline and the drivers view.
//
// Spec: docs/specs/2026-11-12-signals-redesign.md, section 4.
//  • Timeline: worked out by code from the records' own timestamps and values. Lanes for flow
//    data, incidents, complaints and policy; the pattern window shaded; a flow card per hour;
//    each incident or complaint at its own time, with the record's own title and words.
//  • Drivers: outcome, primary drivers, secondary drivers, possible changes. It only ARRANGES
//    the analysis the Thread already holds (contributing conditions, pressure map, options);
//    the counts beside each item are worked out here from the records.
//
// Plain code, no AI, no drawing: signals-ui.js draws what these return.

import { isFlow, isPolicy, isQualitative, fieldName, policiesFor, safetyConditionsIn, SOURCE_TYPE_NAMES } from "./records.js";
import { current } from "./threads.js";
import { whenText, trustKind } from "./signalsFormat.js";
import { metricsOf, triggerConditions, holds, recordsThatDontFit } from "./signalsData.js";

const HOUR = 60 * 60 * 1000;
const HOURS_AROUND = 2;   // hours shown before and after a window (the engine looks this far for nearby records)
const CARD_HOURS = 1.5;   // how much of the axis an incident or complaint card covers
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const capital = (s) => s.replace(/^./, (c) => c.toUpperCase());
const timeOf = (r) => new Date(r.timestamp).getTime();
const kindOf = (r) => (isFlow(r) ? "flow record" : SOURCE_TYPE_NAMES[r.source_type] ?? r.source_type);

// A time on the axis, as written in the records (local time): "3 pm", "3:30 pm".
function clockText(ms) {
  const d = new Date(ms);
  const [h, m] = [d.getHours(), d.getMinutes()];
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
}
const hourStart = (stamp) => {
  const d = new Date(stamp);
  d.setMinutes(0, 0, 0);
  return d.getTime();
};

// "2 incident reports, 3 complaints": how many records of each kind, in the order first seen.
function kindCounts(list) {
  const kinds = new Map();
  for (const r of list) kinds.set(kindOf(r), (kinds.get(kindOf(r)) ?? 0) + 1);
  return [...kinds].map(([kind, n]) => plural(n, kind)).join(", ");
}

// Cards close together in time go on separate rows, so they never sit on top of each other.
function intoRows(items) {
  const lastInRow = [];
  for (const item of items) {
    let row = lastInRow.findIndex((at) => item.at - at >= CARD_HOURS);
    if (row === -1) row = lastInRow.length;
    lastInRow[row] = item.at;
    item.row = row;
  }
  return Math.max(1, lastInRow.length);
}

/**
 * The timeline: one occasion per time window. Positions (`at`, `window.from`, `window.to`) are
 * in hours from the start of the axis, which runs from two hours before the window to two
 * hours after it.
 * @returns {{ occasions: Array<{ when, hours, ticks, window: {from, to, label}, summary,
 *   lanes: Array<{ id, label, rows, items: Array<{ key, at, row, title, text, time, note, relation, safety, source_ids, value?, label?, others?, crossed? }> }> }> }}
 */
export function timelineData(thread, records, rules, now = new Date()) {
  const conditions = triggerConditions(thread, rules);
  const [lead, ...rest] = metricsOf(thread, rules);
  const pack = rules?.[thread.domain] ?? {};
  const byId = new Map(records.map((r) => [r.source_id, r]));
  const cited = new Set(current(thread).steps.pattern.supporting_evidence.map((e) => e.source_id));
  const notFit = new Set(recordsThatDontFit(thread, records, now).map((r) => r.source_id).filter(Boolean));
  const crossedText = conditions.length === 1 ? "the trigger" : conditions.length === 2 ? "both triggers" : "all the triggers";
  const here = (r) => r.domain === thread.domain && r.location === thread.location;
  const nearMisses = records.some((r) => here(r) && r.source_type === "near_miss");
  const policies = policiesFor(thread.domain, thread.location, records);

  const occasions = thread.windows.map((w) => {
    const from = hourStart(w.start) - HOURS_AROUND * HOUR;
    const to = hourStart(w.end) + HOURS_AROUND * HOUR;
    const hours = (to - from) / HOUR;
    const at = (r) => (timeOf(r) - from) / HOUR;
    const shown = (r) => here(r) && timeOf(r) >= from && timeOf(r) < to;

    const like = w.source_ids.map((id) => byId.get(id)).find(Boolean);
    const flow = !like || !lead ? [] : records
      .filter((r) => shown(r) && r.source_type === like.source_type && typeof r[lead.metric] === "number")
      .sort((a, b) => timeOf(a) - timeOf(b))
      .map((r) => ({
        key: r.source_id, at: at(r), row: 0, relation: "flow",
        title: `${lead.text(r[lead.metric])} ${lead.label.toLowerCase()}`,
        value: lead.text(r[lead.metric]), label: lead.label.toLowerCase(),
        others: rest.filter((m) => typeof r[m.metric] === "number").map((m) => `${m.text(r[m.metric])} ${m.label.toLowerCase()}`),
        crossed: conditions.every((c) => holds(r, c)),
        time: clockText(timeOf(r)), text: "", note: "", safety: false, source_ids: [r.source_id],
      }));

    const events = records.filter((r) => shown(r) && isQualitative(r)).sort((a, b) => timeOf(a) - timeOf(b));
    const eventItem = (r) => {
      const relation = cited.has(r.source_id) ? "cited" : notFit.has(r.source_id) ? "not-fit" : "not-cited";
      return {
        key: r.source_id, at: at(r), row: 0, relation,
        title: r.title ?? capital(kindOf(r)), text: r.text ?? "", time: clockText(timeOf(r)),
        note: relation === "cited" ? r.source_id : relation === "not-fit" ? "Not counted as support" : "Not cited in the draft",
        safety: safetyConditionsIn([r], pack).length > 0, source_ids: [r.source_id],
      };
    };
    const incidents = events.filter((r) => r.source_type !== "complaint").map(eventItem);
    const complaints = events.filter((r) => r.source_type === "complaint").map(eventItem);
    const policy = like ? policies.map((r) => ({
      key: r.source_id, at: 0, row: 0, relation: "policy", title: r.title ?? "Policy", text: r.text ?? "", time: "",
      note: "Applies throughout", safety: false, source_ids: [r.source_id],
    })) : [];
    policy.forEach((p, i) => { p.row = i; });

    const crossed = flow.filter((f) => f.crossed).length;
    const citedNearby = events.filter((r) => cited.has(r.source_id)).length;
    const summary = flow.length === 0
      ? "The flow records for these hours weren't found in the processed folder."
      : `${plural(crossed, "hour")} crossed ${crossedText}. ${events.length
        ? `Nearby: ${kindCounts(events)} (${citedNearby} cited in the draft).`
        : "No incident, complaint or near-miss records nearby."}`;

    return {
      when: whenText(w, now),
      hours,
      ticks: Array.from({ length: hours + 1 }, (_, i) => clockText(from + i * HOUR)),
      window: { from: (hourStart(w.start) - from) / HOUR, to: (hourStart(w.end) - from) / HOUR + 1, label: `Pattern window: ${crossedText} crossed` },
      summary,
      lanes: [
        { id: "flow", label: "Flow data", rows: 1, items: flow },
        { id: "incidents", label: nearMisses ? "Incidents and near misses" : "Incidents", rows: intoRows(incidents), items: incidents },
        { id: "complaints", label: "Complaints", rows: intoRows(complaints), items: complaints },
        { id: "policy", label: "Policy", rows: Math.max(1, policy.length), items: policy },
      ],
    };
  });
  return { occasions };
}

// What sits under a driver's title: the one record's ID, or how many records of each kind.
function recordsLine(ids, byId) {
  const unique = [...new Set(ids ?? [])];
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  const found = unique.map((id) => byId.get(id)).filter(Boolean);
  const missing = unique.length - found.length;
  return [kindCounts(found), missing ? `${missing} not found` : ""].filter(Boolean).join(", ");
}

/**
 * The drivers view, read left to right: what is happening, what drives it, what could change it.
 * Titles of drivers and changes are the draft's own wording (already shown elsewhere as a draft);
 * the outcome and every count are worked out here. Items with no record behind them, and
 * anything Inferred or Suggested, are dashed.
 * @returns {{ columns: Array<{ id, label, items: Array<{ id, title, sub, trust_label, dashed, source_ids, option_id?, evidence_ids?, recommended? }> }> }}
 */
export function driversData(thread, records, rules, now = new Date()) {
  const run = current(thread);
  const analysis = run.steps.analysis ?? {};
  const byId = new Map(records.map((r) => [r.source_id, r]));
  const item = (id, title, sub, trust_label, source_ids = [], more = {}) => ({
    id, title, sub, trust_label, dashed: trustKind(trust_label).dashed || (source_ids.length === 0 && !more.option_id), source_ids, ...more,
  });

  const [lead] = metricsOf(thread, rules);
  const windowIds = thread.windows.flatMap((w) => w.source_ids);
  const values = lead ? windowIds.map((id) => byId.get(id)?.[lead.metric]).filter((v) => typeof v === "number") : [];
  const peak = values.length ? (lead.low ? Math.min(...values) : Math.max(...values)) : null;
  const outcome = item("outcome", thread.pattern_type,
    [peak === null ? "" : `${lead.label} ${lead.low ? "down to" : "up to"} ${lead.text(peak)}`, plural(thread.windows.length, "occasion")].filter(Boolean).join(" · "),
    "Observed", windowIds);

  const primary = (analysis.contributing_conditions ?? []).map((c, i) =>
    item(`condition-${i}`, c.condition, recordsLine(c.source_ids, byId) || "No record cited", c.trust_label, c.source_ids ?? []));

  const secondary = [
    ...(analysis.pressure_map ?? []).map((p, i) =>
      item(`pressure-${i}`, `${p.role}: ${p.pressure_carried}${p.shifting_to ? ` (appears to shift to ${p.shifting_to})` : ""}`,
        `Pressure map · ${recordsLine(p.source_ids, byId) || "no record cited"}`, p.trust_label, p.source_ids ?? [])),
    ...(analysis.compounding_factors ?? []).map((words, i) =>
      item(`compounding-${i}`, words, "Where small variations combine · no record cited", "Inferred")),
  ];

  const { options = [], recommendation } = run.steps.options ?? {};
  const changes = options.map((o) => {
    const recommended = o.option_id === recommendation?.leading_option_id;
    return item(`option-${o.option_id}`, o.title, `${o.type}${recommended ? " · recommended" : ""}`, "Suggested", [],
      { option_id: o.option_id, evidence_ids: o.evidence_ids ?? [], recommended });
  });

  return { columns: [
    { id: "outcome", label: "Outcome", items: [outcome] },
    { id: "primary", label: "Primary drivers", items: primary },
    { id: "secondary", label: "Secondary drivers", items: secondary },
    { id: "changes", label: "Possible changes", items: changes },
  ] };
}

const NOT_VALUES = new Set(["source_id", "source_type", "domain", "location", "timestamp", "file", "synthetic", "title", "text"]);

/**
 * The records behind a selected item, for the panel beside the map: each record's kind, time,
 * own title and words, and (for a flow record) its values, the trigger metrics first.
 * @returns {Array<{ source_id, found, kind, when, title, text, values: Array<{label, text}> }>}
 */
export function recordDetails(sourceIds, thread, records, rules, now = new Date()) {
  const byId = new Map(records.map((r) => [r.source_id, r]));
  const metrics = metricsOf(thread, rules);
  return [...new Set(sourceIds ?? [])].map((id) => {
    const r = byId.get(id);
    if (!r) return { source_id: id, found: false, kind: "", when: "", title: "Record not found in the processed folder", text: "", values: [] };
    const values = [];
    if (isFlow(r)) {
      for (const m of metrics) if (typeof r[m.metric] === "number") values.push({ label: m.label, text: m.text(r[m.metric]) });
      const done = new Set(metrics.map((m) => m.metric));
      for (const [k, v] of Object.entries(r)) {
        if (!NOT_VALUES.has(k) && !done.has(k) && ["number", "string"].includes(typeof v)) values.push({ label: fieldName(k), text: String(v) });
      }
    }
    return {
      source_id: id, found: true,
      kind: capital(kindOf(r)),
      when: isPolicy(r) ? "" : whenText(r.timestamp, now),
      title: r.title ?? "", text: r.text ?? "", values,
    };
  });
}
