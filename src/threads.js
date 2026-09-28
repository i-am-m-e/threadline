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

// ---------------------------------------------------------------------------
// Human actions (each is a button in the interface)
// ---------------------------------------------------------------------------
// Roles only, never names. Front-line leads confirm whether the pattern is real;
// managers decide what to do. Every action records the role, the time and a note.

export const ROLES = ["Front-line lead", "Manager"];

// Which statuses a person can move a Thread to, from each status.
const ALLOWED = {
  "Inferred": ["Under review", "Not confirmed"],
  "Flagged": ["Under review", "Not confirmed"],
  "Under review": ["Validated pattern", "Not confirmed"],
  "Validated pattern": ["Decision recorded"],
  "Decision recorded": ["Outcome review due"],
  "Outcome review due": ["Closed"],
  "Not confirmed": [],
  "Closed": [],
};

export const canMove = (thread, to) => ALLOWED[thread.status]?.includes(to) ?? false;

/** Move a Thread to a new status because a person pressed a button. */
function humanStatus(thread, to, role, note, now = new Date()) {
  if (!ROLES.includes(role)) throw new Error("Choose your role before acting on a Thread.");
  if (!canMove(thread, to)) throw new Error(`A Thread can't move from "${thread.status}" to "${to}".`);
  thread.status = to;
  thread.updated_at = now.toISOString();
  thread.history.push({ time: now.toISOString(), status: to, by: role, note });
}

const requireRole = (role, allowed, action) => {
  if (!ROLES.includes(role)) throw new Error("Choose your role before acting on a Thread.");
  if (!allowed.includes(role)) throw new Error(`"${action}" is for the ${allowed.join(" or ")} role.`);
};
const requireText = (text, what) => {
  const clean = String(text ?? "").trim();
  if (!clean) throw new Error(`Please give ${what}.`);
  return clean.slice(0, 1000);
};

// ----- Manager -----
export function sendForValidation(thread, role, now = new Date()) {
  requireRole(role, ["Manager"], "Send for front-line validation");
  humanStatus(thread, "Under review", role, "Sent for front-line validation", now);
}

export function notARealPattern(thread, role, reason, now = new Date()) {
  requireRole(role, ["Manager"], "Not a real pattern");
  const why = requireText(reason, "a reason");
  thread.rejections.push({ kind: "Not a real pattern", reason: why, role, time: now.toISOString(), pattern_type: thread.pattern_type });
  humanStatus(thread, "Not confirmed", role, `Not a real pattern: ${why}`, now);
}

export function requestMoreInformation(thread, role, text, now = new Date()) {
  requireRole(role, ["Manager"], "Request more information");
  const request = requireText(text, "what information you need");
  thread.information_requests.push({ text: request, role, time: now.toISOString() });
  thread.updated_at = now.toISOString();
  thread.history.push({ time: now.toISOString(), status: thread.status, by: role, note: `Requested more information: ${request}` });
}

/**
 * Accept the recommendation, or choose another option (or "none"). Only once the pattern
 * is validated. Records the decision (option, role, date) and sets the outcome review date
 * from the option's revisit_after_days. It records a decision only: nothing is applied.
 */
export function recordDecision(thread, role, optionId, now = new Date()) {
  requireRole(role, ["Manager"], "Record a decision");
  if (thread.status !== "Validated pattern") {
    throw new Error("A decision can only be recorded once a front-line lead has validated the pattern.");
  }
  const options = current(thread).steps.options.options;
  const option = optionId === "none" ? null : options.find((o) => o.option_id === optionId);
  if (optionId !== "none" && !option) throw new Error(`There's no option "${optionId}".`);
  const days = option?.revisit_after_days ?? 14;
  const due = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  thread.decision = {
    option_id: optionId,
    option_title: option?.title ?? "No option chosen",
    was_recommended: optionId === current(thread).steps.options.recommendation.leading_option_id,
    role,
    date: now.toISOString(),
    revisit_or_stop_if: option?.revisit_or_stop_if ?? "",
  };
  humanStatus(thread, "Decision recorded", role, `Decision: ${thread.decision.option_title}`, now);
  thread.outcome_review_due = due.toISOString().slice(0, 10);
  humanStatus(thread, "Outcome review due", role, `Outcome review due ${thread.outcome_review_due} (${days} days)`, now);
}

/** At outcome review: what happened and whether it helped, then close the Thread. */
export function closeWithOutcome(thread, role, { whatHappened, helped }, now = new Date()) {
  requireRole(role, ["Manager"], "Close with outcome");
  const happened = requireText(whatHappened, "what happened");
  if (!["Yes", "Partly", "No", "Too early to tell"].includes(helped)) throw new Error("Say whether it helped.");
  thread.outcome = { what_happened: happened, helped, role, date: now.toISOString() };
  humanStatus(thread, "Closed", role, `Outcome: ${helped}. ${happened}`, now);
}

// ----- Front-line lead -----
export function confirmPattern(thread, role, now = new Date()) {
  requireRole(role, ["Front-line lead"], "Confirm pattern");
  humanStatus(thread, "Validated pattern", role, "Front-line lead confirmed the pattern", now);
}

export function doesNotMatch(thread, role, reason, now = new Date()) {
  requireRole(role, ["Front-line lead"], "Doesn't match what I see");
  const why = requireText(reason, "a one-line reason");
  thread.rejections.push({ kind: "Doesn't match what I see", reason: why, role, time: now.toISOString(), pattern_type: thread.pattern_type });
  humanStatus(thread, "Not confirmed", role, `Doesn't match what I see: ${why}`, now);
}

/** Context from a front-line role (trust label Experiential). Status doesn't change. */
export function addContext(thread, role, text, now = new Date()) {
  if (!ROLES.includes(role)) throw new Error("Choose your role before acting on a Thread.");
  const note = requireText(text, "some context");
  thread.context_notes.push({ text: note, role, time: now.toISOString(), trust_label: "Experiential" });
  thread.updated_at = now.toISOString();
  thread.history.push({ time: now.toISOString(), status: thread.status, by: role, note: "Added context" });
}

/**
 * How often each pattern type was rejected, and why (for tuning trigger thresholds).
 * @returns {Object<string, {"Doesn't match what I see": number, "Not a real pattern": number, reasons: string[]}>}
 */
export function rejectionCounts(threads) {
  const counts = {};
  for (const r of threads.flatMap((t) => t.rejections)) {
    counts[r.pattern_type] ??= { "Doesn't match what I see": 0, "Not a real pattern": 0, reasons: [] };
    counts[r.pattern_type][r.kind] += 1;
    counts[r.pattern_type].reasons.push(r.reason);
  }
  return counts;
}

/** The only status change the pipeline is allowed to make. */
export function pipelineStatus(thread, status, note, now = new Date()) {
  if (!["Inferred", "Flagged"].includes(status)) {
    throw new Error(`The pipeline may only set Inferred or Flagged, not "${status}".`);
  }
  thread.status = status;
  thread.history.push({ time: now.toISOString(), status, by: "Threadline", note });
}
