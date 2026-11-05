// Recurrence (founder decisions 2026-11-04): how many occasions a pattern has been seen,
// shown beside confidence, with bands at a regular interval (every 10: 10+, 20+, 30+…) that
// raise priority, and a flag for review at 10+. Recurrence never changes the confidence label.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recurrence, confidenceText, byPriority, flagReason } from "../src/recurrence.js";
import { SIGNALS_CONFIG } from "../src/config.js";

const every = 10;
const threadWith = (id, occasions, confidence = "Low") => ({
  id, windows: Array.from({ length: occasions }, (_, i) => ({ start: `2026-09-${String(i + 1).padStart(2, "0")}T15:00` })),
  runs: [{ steps: { pattern: { confidence } } }],
});

test("the bands are a setting: every 10 occasions; the flag point is 10", () => {
  assert.equal(SIGNALS_CONFIG.recurrenceEvery, 10);
  assert.equal(SIGNALS_CONFIG.recurrenceFlagAt, 10);
});

test("the count is listed from the first occasion", () => {
  assert.deepEqual(recurrence(1, every), { occasions: 1, band: null, text: "seen on 1 occasion" });
  assert.deepEqual(recurrence(2, every), { occasions: 2, band: null, text: "seen on 2 occasions" });
  assert.deepEqual(recurrence(9, every), { occasions: 9, band: null, text: "seen on 9 occasions" });
});

test("bands come every 10 occasions, with no upper limit", () => {
  assert.equal(recurrence(10, every).band, 10);
  assert.equal(recurrence(10, every).text, "seen on 10 occasions (10+)");
  assert.equal(recurrence(19, every).band, 10);
  assert.equal(recurrence(20, every).band, 20);
  assert.equal(recurrence(49, every).band, 40);
  assert.equal(recurrence(70, every).band, 70);
  assert.equal(recurrence(253, every).text, "seen on 253 occasions (250+)");
});

test("an interval of 5 gives 5+, 10+, 15+…", () => {
  assert.equal(recurrence(4, 5).band, null);
  assert.equal(recurrence(5, 5).text, "seen on 5 occasions (5+)");
  assert.equal(recurrence(17, 5).band, 15);
});

test("recurrence is shown beside confidence and never changes it", () => {
  assert.equal(confidenceText(threadWith("a", 2, "Medium"), every), "Medium confidence, seen on 2 occasions");
  assert.equal(confidenceText(threadWith("b", 5, "Low"), every), "Low confidence, seen on 5 occasions");
  const t = threadWith("c", 75, "Low");
  assert.equal(confidenceText(t, every), "Low confidence, seen on 75 occasions (70+)");
  assert.equal(t.runs[0].steps.pattern.confidence, "Low");
});

test("a higher band comes first in the list; otherwise the order is kept", () => {
  const list = [threadWith("few", 3), threadWith("many", 55), threadWith("some", 12), threadWith("few2", 1), threadWith("most", 80)];
  assert.deepEqual(byPriority(list, every).map((t) => t.id), ["most", "many", "some", "few", "few2"]);
});

test("flag reasons: Medium+ confidence with a safety-relevant condition, as before", () => {
  assert.match(flagReason({ confidence: "Medium", safetyConditions: 1, occasions: 1 }, { every, flagAt: 10 }), /safety-relevant/);
  assert.equal(flagReason({ confidence: "Low", safetyConditions: 1, occasions: 1 }, { every, flagAt: 10 }), null);
  assert.equal(flagReason({ confidence: "High", safetyConditions: 0, occasions: 1 }, { every, flagAt: 10 }), null);
});

test("flag reasons: reaching 10+ occasions flags for review even at Low confidence without a safety condition", () => {
  assert.equal(flagReason({ confidence: "Low", safetyConditions: 0, occasions: 9 }, { every, flagAt: 10 }), null);
  assert.equal(flagReason({ confidence: "Low", safetyConditions: 0, occasions: 12 }, { every, flagAt: 10 }),
    "Recurring: seen on 12 occasions (10+). Confidence is unchanged; a person should review why it keeps happening.");
});

// ---------- A short line for many time windows ----------
import { windowsText } from "../src/recurrence.js";

const win = (day, from = "15:00", to = "18:00") => ({ start: `2026-08-${day}T${from}`, end: `2026-08-${day}T${to}` });

test("up to 3 time windows are listed in full", () => {
  assert.deepEqual(windowsText([win("01"), win("02", "14:00", "16:00")]), {
    short: "Time windows: 2026-08-01 15:00 to 18:00; 2026-08-02 14:00 to 16:00",
    full: "2026-08-01 15:00 to 18:00; 2026-08-02 14:00 to 16:00",
  });
  assert.equal(windowsText([win("01")]).short, "Time window: 2026-08-01 15:00 to 18:00");
});

test("more than 3 time windows become a count and a date range (the full list is kept for hover)", () => {
  const many = Array.from({ length: 12 }, (_, i) => win(String(i + 1).padStart(2, "0")));
  const t = windowsText(many);
  assert.equal(t.short, "12 time windows, 2026-08-01 to 2026-08-12");
  assert.match(t.full, /^2026-08-01 15:00 to 18:00; .*; 2026-08-12 15:00 to 18:00$/);
});
