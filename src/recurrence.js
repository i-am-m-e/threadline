// recurrence.js — how often a pattern has been seen (founder decision 2026-11-04).
//
// An "occasion" is one triggered time window in a Thread. The count is shown beside
// confidence from the first occasion ("Medium confidence, seen on 2 occasions").
// Bands come at a regular interval (SIGNALS_CONFIG.recurrenceEvery, default every 10: 10+,
// 20+, 30+…, no upper limit) and raise a Thread's place in the list. Reaching
// SIGNALS_CONFIG.recurrenceFlagAt (default 10) can flag a Thread for review even at Low
// confidence.
//
// Recurrence NEVER changes the confidence label: confidence keeps its three levels and its
// rule. "Low confidence, seen on 5 occasions" means: this keeps happening and nobody has
// confirmed why yet. Plain code, no AI.

/**
 * @param {number} occasions
 * @param {number} every  The band interval, e.g. 10 → every at 10+, 20+, 30+…
 * @returns {{ occasions: number, band: number|null, text: string }}
 */
export function recurrence(occasions, every) {
  const band = every > 0 && occasions >= every ? Math.floor(occasions / every) * every : null;
  const text = `seen on ${occasions} occasion${occasions === 1 ? "" : "s"}${band ? ` (${band}+)` : ""}`;
  return { occasions, band, text };
}

const occasionsOf = (thread) => thread.windows?.length ?? 0;
const confidenceOf = (thread) => thread.runs.at(-1).steps.pattern.confidence;

/** "Medium confidence, seen on 2 occasions" for a Thread. */
export function confidenceText(thread, every) {
  return `${confidenceOf(thread)} confidence, ${recurrence(occasionsOf(thread), every).text}`;
}

/** Threads in a higher recurrence band first; within a band, the order is kept. */
export function byPriority(threads, every) {
  const bandOf = (t) => recurrence(occasionsOf(t), every).band ?? 0;
  return threads.map((t, i) => ({ t, i })).sort((a, b) => bandOf(b.t) - bandOf(a.t) || a.i - b.i).map((x) => x.t);
}

/**
 * Why a Thread should be flagged, or null if it shouldn't:
 *  • Medium or higher confidence with a safety-relevant condition (spec section 11), or
 *  • it has been seen on `flagAt` or more occasions, whatever its confidence.
 * The daily flag cap still applies (notify.js).
 * @param {{ confidence: string, safetyConditions: number, occasions: number }} facts
 * @param {{ every: number, flagAt: number }} settings
 */
export function flagReason({ confidence, safetyConditions, occasions }, { every, flagAt }) {
  if (["Medium", "High"].includes(confidence) && safetyConditions > 0) {
    return "Medium or higher confidence with a safety-relevant condition";
  }
  if (flagAt && occasions >= flagAt) {
    return `Recurring: ${recurrence(occasions, every).text}. Confidence is unchanged; a person should review why it keeps happening.`;
  }
  return null;
}

/**
 * The Thread's time windows as a short line for the header, and the full list (for hover).
 * Up to 3 windows are listed; more become a count and a date range.
 * @param {Array<{start: string, end: string}>} windows  e.g. { start: "2026-08-01T15:00", end: "2026-08-01T18:00" }
 */
export function windowsText(windows) {
  const one = (w) => `${w.start.replace("T", " ")} to ${w.end.slice(11)}`;
  const full = windows.map(one).join("; ");
  if (windows.length <= 3) return { short: `Time window${windows.length === 1 ? "" : "s"}: ${full}`, full };
  const days = windows.map((w) => w.start.slice(0, 10)).sort();
  return { short: `${windows.length} time windows, ${days[0]} to ${days.at(-1)}`, full };
}
