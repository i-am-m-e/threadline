// Flags, the daily cap and the digest (spec section 11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { routeAlerts } from "../src/notify.js";

const DAY1 = new Date("2026-11-04T10:00:00");
const DAY2 = new Date("2026-11-05T10:00:00");
const flagged = (id) => ({ id, status: "Flagged", domain: "Healthcare" });

test("over the daily cap, a qualifying Thread goes to the digest marked over_cap", () => {
  const state = {};
  const threads = ["T1", "T2", "T3", "T4"].map(flagged);
  const notified = routeAlerts(threads.map((thread) => ({ thread, kind: "new" })), state, 3, DAY1);
  assert.deepEqual(notified.map((t) => t.id), ["T1", "T2", "T3"]);
  assert.equal(state.digest.length, 1);
  assert.equal(state.digest[0].thread_id, "T4");
  assert.equal(state.digest[0].over_cap, true);
});

test("the cap resets the next day", () => {
  const state = {};
  const threads = ["T1", "T2", "T3", "T4"].map(flagged);
  routeAlerts(threads.map((thread) => ({ thread, kind: "new" })), state, 3, DAY1);
  const notified = routeAlerts([{ thread: threads[3], kind: "updated" }], state, 3, DAY2);
  assert.deepEqual(notified.map((t) => t.id), ["T4"]);
});

test("a Thread is never flagged twice", () => {
  const state = {};
  const t = flagged("T1");
  routeAlerts([{ thread: t, kind: "new" }], state, 3, DAY1);
  assert.deepEqual(routeAlerts([{ thread: t, kind: "updated" }], state, 3, DAY2), []);
});

// ---------- Recurrence in the notification ----------
import { notificationBody } from "../src/notify.js";

const flaggedThread = (note, occasions, confidence) => ({
  pattern_type: "Rooming during slow physician pace", location: "Synthetic UCC A",
  windows: Array.from({ length: occasions }, () => ({})),
  runs: [{ steps: { pattern: { confidence } } }],
  history: [{ status: "Inferred", by: "Threadline" }, { status: "Flagged", by: "Threadline", note }],
});

test("a safety flag's notification gives confidence, occasions and 'safety-relevant'", () => {
  const body = notificationBody(flaggedThread("Medium or higher confidence with a safety-relevant condition", 1, "Medium"), [10, 50, 70]);
  assert.equal(body, "Rooming during slow physician pace at Synthetic UCC A (Medium confidence, seen on 1 occasion; safety-relevant). Review it in Signals.");
});

test("a recurrence flag's notification says it keeps recurring, with the confidence unchanged", () => {
  const body = notificationBody(flaggedThread("Recurring: seen on 12 occasions (10+). Confidence is unchanged…", 12, "Low"), [10, 50, 70]);
  assert.equal(body, "Rooming during slow physician pace at Synthetic UCC A (Low confidence, seen on 12 occasions (10+); recurring). Review it in Signals.");
});
