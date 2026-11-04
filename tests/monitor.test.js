// "Check now": new files create or update Threads; failures keep their files for a retry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkForSignals } from "../src/monitor.js";
import { SIGNALS_CONFIG } from "../src/config.js";
import { loadAnswerKey, loadEvalPack, loadRules, loadEvidenceLibrary, loadSchemas } from "../scripts/eval/packs.js";
import { memoryIo } from "../scripts/eval/memoryIo.js";
import { fixtureSteps, replayAsk } from "./helpers.js";

const key = loadAnswerKey();
const base = { rules: loadRules(), schemas: loadSchemas(), config: SIGNALS_CONFIG, evidenceLibrary: loadEvidenceLibrary() };
const fourAnswers = (run) => {
  const s = fixtureSteps("rooming", run);
  return [s.pattern, s.analysis, s.options, s.card];
};

test("the healthcare pack creates one Thread, and the second file updates it", async () => {
  const mem = memoryIo();
  mem.put(loadEvalPack("healthcare", key).files);
  const first = await checkForSignals({ ...base, io: mem.io, ask: replayAsk(fourAnswers(0)).ask });
  assert.equal(first.created.length, 1);
  assert.deepEqual(first.errors, []);

  mem.put(loadEvalPack("healthcare_update", key).files);
  const second = await checkForSignals({ ...base, io: mem.io, ask: replayAsk(fourAnswers(1)).ask });
  assert.deepEqual(second.updated, first.created);
  const threads = mem.threads();
  assert.equal(threads.length, 1);
  assert.equal(threads[0].runs.length, 2);
  assert.ok(threads[0].history.some((h) => h.type === "update"));
});

test("a failed run reports the error and leaves its files waiting in incoming", async () => {
  const mem = memoryIo();
  const files = loadEvalPack("healthcare", key).files;
  mem.put(files);
  const summary = await checkForSignals({ ...base, io: mem.io, ask: replayAsk([new Error("model stalled")]).ask });
  assert.equal(summary.errors.length, 1);
  assert.match(summary.errors[0], /model stalled/);
  assert.equal(mem.threads().length, 0);
  assert.ok(mem.incoming().length > 0);
});

// ---------- Recurrence: seen on 10+ occasions → flagged for review, confidence unchanged ----------

// Synthetic flow rows for this test only: one triggering afternoon per day at Synthetic UCC A.
// Room-to-physician 50 minutes is above the 45-minute trigger but below the 60-minute safety
// condition, and there are no incident or complaint records: Low confidence, no safety condition.
const header = "source_id,source_type,domain,location,timestamp,bed_occupancy,room_to_physician_minutes,waiting_room_count,synthetic";
const days = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => {
  const d = String(from + i).padStart(2, "0");
  return `HC-FLOW-TEST-202608${d},emr_flow,Healthcare,Synthetic UCC A,2026-08-${d}T15:00,0.95,50,10,true`;
});
const flowFile = (name, rows) => ({ name, text: [header, ...rows].join("\n") });
const policyFile = () => loadEvalPack("healthcare", key).files.find((f) => f.name === "Policy_CTAS_Escalation.json");

test("a Thread reaching 10 occasions is flagged for review even at Low confidence, saying why", async () => {
  const mem = memoryIo();
  mem.put([flowFile("Flow_Aug_1-9.csv", days(1, 9)), policyFile()]);
  await checkForSignals({ ...base, io: mem.io, ask: replayAsk(fourAnswers(0)).ask });
  let [thread] = mem.threads();
  assert.equal(thread.windows.length, 9);
  assert.equal(thread.runs.at(-1).steps.pattern.confidence, "Low");
  assert.equal(thread.status, "Inferred", "9 occasions: listed, not flagged");

  mem.put([flowFile("Flow_Aug_10.csv", days(10, 10))]);
  await checkForSignals({ ...base, io: mem.io, ask: replayAsk(fourAnswers(0)).ask });
  [thread] = mem.threads();
  assert.equal(thread.windows.length, 10);
  assert.equal(thread.status, "Flagged");
  assert.equal(thread.runs.at(-1).steps.pattern.confidence, "Low", "recurrence never changes confidence");
  assert.match(thread.history.at(-1).note, /^Recurring: seen on 10 occasions \(10\+\)/);
  assert.equal(thread.runs.at(-1).steps.card.evidence_badge, "Based on 0 records", "no record survived the checks: no dangling list");
});
