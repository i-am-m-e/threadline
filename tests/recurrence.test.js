// Recurrence (founder decision 2026-11-04): how many occasions a pattern has been seen,
// shown beside confidence, with bands (10+, 50+, 70+) that raise priority and can flag a
// Thread for review. Recurrence never changes the confidence label.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recurrence, confidenceText, byPriority, flagReason } from "../src/recurrence.js";
import { SIGNALS_CONFIG } from "../src/config.js";

const bands = [10, 50, 70];
const threadWith = (id, occasions, confidence = "Low") => ({
  id, windows: Array.from({ length: occasions }, (_, i) => ({ start: `2026-09-${String(i + 1).padStart(2, "0")}T15:00` })),
  runs: [{ steps: { pattern: { confidence } } }],
});

test("the bands are a setting: 10+, 50+ and 70+ occasions", () => {
  assert.deepEqual(SIGNALS_CONFIG.recurrenceBands, [10, 50, 70]);
  assert.equal(SIGNALS_CONFIG.recurrenceFlagAt, 10);
});

test("the count is listed from the first occasion", () => {
  assert.deepEqual(recurrence(1, bands), { occasions: 1, band: null, text: "seen on 1 occasion" });
  assert.deepEqual(recurrence(2, bands), { occasions: 2, band: null, text: "seen on 2 occasions" });
  assert.deepEqual(recurrence(9, bands), { occasions: 9, band: null, text: "seen on 9 occasions" });
});

test("bands start at 10, 50 and 70 occasions", () => {
  assert.equal(recurrence(10, bands).band, 10);
  assert.equal(recurrence(10, bands).text, "seen on 10 occasions (10+)");
  assert.equal(recurrence(49, bands).band, 10);
  assert.equal(recurrence(50, bands).band, 50);
  assert.equal(recurrence(69, bands).band, 50);
  assert.equal(recurrence(70, bands).band, 70);
  assert.equal(recurrence(250, bands).text, "seen on 250 occasions (70+)");
});

test("bands work in any order in the setting", () => {
  assert.equal(recurrence(55, [70, 10, 50]).band, 50);
});

test("recurrence is shown beside confidence and never changes it", () => {
  assert.equal(confidenceText(threadWith("a", 2, "Medium"), bands), "Medium confidence, seen on 2 occasions");
  assert.equal(confidenceText(threadWith("b", 5, "Low"), bands), "Low confidence, seen on 5 occasions");
  const t = threadWith("c", 75, "Low");
  assert.equal(confidenceText(t, bands), "Low confidence, seen on 75 occasions (70+)");
  assert.equal(t.runs[0].steps.pattern.confidence, "Low");
});

test("a higher band comes first in the list; otherwise the order is kept", () => {
  const list = [threadWith("few", 3), threadWith("many", 55), threadWith("some", 12), threadWith("few2", 1), threadWith("most", 80)];
  assert.deepEqual(byPriority(list, bands).map((t) => t.id), ["most", "many", "some", "few", "few2"]);
});

test("flag reasons: Medium+ confidence with a safety-relevant condition, as before", () => {
  assert.match(flagReason({ confidence: "Medium", safetyConditions: 1, occasions: 1 }, { bands, flagAt: 10 }), /safety-relevant/);
  assert.equal(flagReason({ confidence: "Low", safetyConditions: 1, occasions: 1 }, { bands, flagAt: 10 }), null);
  assert.equal(flagReason({ confidence: "High", safetyConditions: 0, occasions: 1 }, { bands, flagAt: 10 }), null);
});

test("flag reasons: reaching 10+ occasions flags for review even at Low confidence without a safety condition", () => {
  assert.equal(flagReason({ confidence: "Low", safetyConditions: 0, occasions: 9 }, { bands, flagAt: 10 }), null);
  assert.equal(flagReason({ confidence: "Low", safetyConditions: 0, occasions: 12 }, { bands, flagAt: 10 }),
    "Recurring: seen on 12 occasions (10+). Confidence is unchanged; a person should review why it keeps happening.");
});
