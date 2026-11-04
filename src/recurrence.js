// recurrence.js — how often a pattern has been seen (founder decision 2026-11-04).
//
// An "occasion" is one triggered time window in a Thread. The count is shown beside
// confidence from the first occasion ("Medium confidence, seen on 2 occasions").
// Bands (SIGNALS_CONFIG.recurrenceBands, default 10+, 50+, 70+) raise a Thread's place in
// the list, and reaching SIGNALS_CONFIG.recurrenceFlagAt (default 10) can flag a Thread for
// review even at Low confidence.
//
// Recurrence NEVER changes the confidence label: confidence keeps its three levels and its
// rule. "Low confidence, seen on 5 occasions" means: this keeps happening and nobody has
// confirmed why yet. Plain code, no AI.

/**
 * @param {number} occasions
 * @param {number[]} bands  e.g. [10, 50, 70]
 * @returns {{ occasions: number, band: number|null, text: string }}
 */
export function recurrence(occasions, bands) {
  const band = [...bands].sort((a, b) => b - a).find((b) => occasions >= b) ?? null;
  const text = `seen on ${occasions} occasion${occasions === 1 ? "" : "s"}${band ? ` (${band}+)` : ""}`;
  return { occasions, band, text };
}

const occasionsOf = (thread) => thread.windows?.length ?? 0;
const confidenceOf = (thread) => thread.runs.at(-1).steps.pattern.confidence;

/** "Medium confidence, seen on 2 occasions" for a Thread. */
export function confidenceText(thread, bands) {
  return `${confidenceOf(thread)} confidence, ${recurrence(occasionsOf(thread), bands).text}`;
}

/** Threads in a higher recurrence band first; within a band, the order is kept. */
export function byPriority(threads, bands) {
  const bandOf = (t) => recurrence(occasionsOf(t), bands).band ?? 0;
  return threads.map((t, i) => ({ t, i })).sort((a, b) => bandOf(b.t) - bandOf(a.t) || a.i - b.i).map((x) => x.t);
}

/**
 * Why a Thread should be flagged, or null if it shouldn't:
 *  • Medium or higher confidence with a safety-relevant condition (spec section 11), or
 *  • it has been seen on `flagAt` or more occasions, whatever its confidence.
 * The daily flag cap still applies (notify.js).
 * @param {{ confidence: string, safetyConditions: number, occasions: number }} facts
 * @param {{ bands: number[], flagAt: number }} settings
 */
export function flagReason({ confidence, safetyConditions, occasions }, { bands, flagAt }) {
  if (["Medium", "High"].includes(confidence) && safetyConditions > 0) {
    return "Medium or higher confidence with a safety-relevant condition";
  }
  if (flagAt && occasions >= flagAt) {
    return `Recurring: ${recurrence(occasions, bands).text}. Confidence is unchanged; a person should review why it keeps happening.`;
  }
  return null;
}
