// "Check now": new files create or update Threads; failures keep their files for a retry.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkForSignals } from "../src/monitor.js";
import { SIGNALS_CONFIG } from "../src/config.js";
import { loadAnswerKey, loadEvalPack, loadRules, loadEvidenceLibrary, loadSchemas } from "../scripts/eval/packs.js";
import { memoryIo } from "../scripts/eval/memoryIo.js";
import { recordedSteps, replayAsk } from "./helpers.js";

const key = loadAnswerKey();
const base = { rules: loadRules(), schemas: loadSchemas(), config: SIGNALS_CONFIG, evidenceLibrary: loadEvidenceLibrary() };
const fourAnswers = (run) => {
  const s = recordedSteps("rooming", run);
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
