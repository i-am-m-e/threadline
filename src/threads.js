// threads.js — Signals Threads: creating them, updating them, and their status rules.
//
// A Thread is one operational pattern Threadline noticed (e.g. "Rooming during slow
// physician pace" at Synthetic UCC A), with everything behind it: the pipeline's
// drafts, the records it cites, notes from people, decisions and a full history.
//
// STATUS RULES (spec section 10)
//   Inferred → Flagged → Under review → Validated pattern | Not confirmed →
//   Decision recorded → Outcome review due → Closed
// The pipeline may only ever set Inferred or Flagged (pipelineStatus below).
// Every later status needs a person to press a button (humanStatus below, which
// requires the role that pressed it).

export const STATUSES = [
  "Inferred", "Flagged", "Under review", "Validated pattern", "Not confirmed",
  "Decision recorded", "Outcome review due", "Closed",
];

// Threads that new evidence can still be added to.
export const isOpen = (t) => !["Closed", "Not confirmed"].includes(t.status);

/**
 * A new Thread from a pipeline result.
 * @param {object} result  From runPipeline().
 * @param {object} info
 * @param {Array}  info.windows  The triggered windows (with flowRecords).
 * @param {string[]} info.files  The record files that led to it.
 * @param {string[]} info.existingIds  Ids already used (to number this one).
 * @param {boolean} info.qualifiesForFlag  Medium+ confidence and a safety-relevant condition.
 */
export function createThread(result, { windows, files, existingIds, qualifiesForFlag, now = new Date() }) {
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  let n = 1;
  while (existingIds.includes(`THR-${day}-${n}`)) n++;
  const time = now.toISOString();
  const thread = {
    id: `THR-${day}-${n}`,
    domain: result.meta.domain,
    pattern_type: result.meta.pattern_type,
    location: result.meta.location,
    status: "Inferred",
    created_at: time,
    updated_at: time,
    windows: windows.map(windowSummary),
    files: [...files],
    runs: [{ time, ...result }], // every pipeline run; the last one is current
    context_notes: [],           // "Add context": trust label Experiential, with role and time
    rejections: [],              // "Doesn't match" / "Not a real pattern" reasons
    information_requests: [],    // "Request more information" notes
    decision: null,              // { option_id, option_title, role, date }
    outcome: null,               // { what_happened, helped, role, date }
    notification: null,          // "flag" or "digest" (step 8)
    history: [{ time, status: "Inferred", by: "Threadline", note: `Noticed from ${files.join(", ")}` }],
  };
  if (qualifiesForFlag) pipelineStatus(thread, "Flagged", "Medium or higher confidence with a safety-relevant condition", now);
  return thread;
}

/**
 * New records matched an open Thread (same pattern type, domain and location): add them,
 * keep the new pipeline run, and record the update in the history. Status is only ever
 * raised Inferred → Flagged here; anything a person decided stays as it is.
 */
export function updateThread(thread, result, { windows, files, qualifiesForFlag, now = new Date() }) {
  const time = now.toISOString();
  const before = current(thread).steps.pattern.confidence;
  thread.runs.push({ time, ...result });
  thread.windows = windows.map(windowSummary);
  thread.files = [...new Set([...thread.files, ...files])];
  thread.updated_at = time;
  const after = result.steps.pattern.confidence;
  thread.history.push({
    time, status: thread.status, by: "Threadline", type: "update",
    note: `New records from ${files.join(", ")}; analysis re-run; confidence ${before} → ${after}`,
  });
  if (qualifiesForFlag && thread.status === "Inferred") {
    pipelineStatus(thread, "Flagged", "Medium or higher confidence with a safety-relevant condition", now);
  }
  return thread;
}

/** The Thread's latest pipeline run. */
export const current = (thread) => thread.runs[thread.runs.length - 1];

const windowSummary = (w) => ({ start: w.start, end: w.end, source_ids: w.flowRecords.map((r) => r.source_id) });

/** The only status change the pipeline is allowed to make. */
export function pipelineStatus(thread, status, note, now = new Date()) {
  if (!["Inferred", "Flagged"].includes(status)) {
    throw new Error(`The pipeline may only set Inferred or Flagged, not "${status}".`);
  }
  thread.status = status;
  thread.history.push({ time: now.toISOString(), status, by: "Threadline", note });
}
