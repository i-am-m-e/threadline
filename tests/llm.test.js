// Tests for src/llm.js: the checks every Signals answer goes through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAgainstSchema, guardSources, findGuardrailProblems, runStep, StepError } from "../src/llm.js";
import { recordedSteps, replayAsk, loadSchemas, clone } from "./helpers.js";

const schemas = loadSchemas();
const pattern = () => clone(recordedSteps("rooming").pattern);

test("schema check: a recorded pattern answer is valid", () => {
  assert.deepEqual(validateAgainstSchema(pattern(), schemas.pattern), []);
});

test("schema check: an unknown confidence value is refused", () => {
  const p = pattern();
  p.confidence = "Very high";
  assert.ok(validateAgainstSchema(p, schemas.pattern).some((m) => m.includes("is not one of Low, Medium, High")));
});

test("schema check: a missing field is refused", () => {
  const p = pattern();
  delete p.pattern_statement;
  assert.ok(validateAgainstSchema(p, schemas.pattern).some((m) => m.includes('missing "pattern_statement"')));
});

test("schema check: an extra field is refused", () => {
  const p = pattern();
  p.surprise = "x";
  assert.ok(validateAgainstSchema(p, schemas.pattern).some((m) => m.includes("unexpected field")));
});

test("schema check: a number where text is expected is refused", () => {
  const p = pattern();
  p.location = 7;
  assert.ok(validateAgainstSchema(p, schemas.pattern).some((m) => m.includes("expected string")));
});

test("schema check: an unsupported schema rule throws instead of being skipped", () => {
  assert.throws(() => validateAgainstSchema("x", { type: "string", pattern: "^a" }), /isn't supported/);
});

test("source guard: evidence citing an invented record is removed", () => {
  const out = { supporting_evidence: [{ source_id: "HC-FAKE-1", trust_label: "Observed", finding: "x" }, { source_id: "HC-A", trust_label: "Observed", finding: "y" }] };
  const changes = guardSources(out, { sourceIds: new Set(["HC-A"]) });
  assert.deepEqual(out.supporting_evidence.map((e) => e.source_id), ["HC-A"]);
  assert.equal(changes.length, 1);
  assert.match(changes[0].detail, /HC-FAKE-1/);
});

test("source guard: a claim left with no real sources becomes Inferred", () => {
  const out = { condition: { source_ids: ["HC-FAKE-1"], trust_label: "Observed" } };
  guardSources(out, { sourceIds: new Set(["HC-A"]) });
  assert.deepEqual(out.condition.source_ids, []);
  assert.equal(out.condition.trust_label, "Inferred");
});

test("source guard: an invented policy id is blanked", () => {
  const out = { gap: { policy_source_id: "POL-FAKE" } };
  const changes = guardSources(out, { sourceIds: new Set(["HC-A"]) });
  assert.equal(out.gap.policy_source_id, "");
  assert.ok(changes.some((c) => c.detail.includes("POL-FAKE")));
});

test("source guard: invented evidence ids are removed", () => {
  const out = { option: { evidence_ids: ["EV-1", "EV-FAKE"] } };
  const changes = guardSources(out, { evidenceIds: new Set(["EV-1"]) });
  assert.deepEqual(out.option.evidence_ids, ["EV-1"]);
  assert.ok(changes.some((c) => c.detail.includes("EV-FAKE")));
});

for (const text of ["Dr. Patel", "RN J. Miller", "J. Miller", "at-risk behaviour", "reckless"]) {
  test(`name and blame scan catches "${text}"`, () => {
    assert.ok(findGuardrailProblems({ note: `Seen with ${text} on shift.` }).length > 0);
  });
}

for (const text of ["Inspector Capacity", "Charge Nurse", "Operator Workload", "U.S. Standards"]) {
  test(`name and blame scan allows "${text}"`, () => {
    assert.deepEqual(findGuardrailProblems({ note: `${text} review` }), []);
  });
}

const stepArgs = (ask) => ({
  name: "pattern", prompt: "PROMPT", schema: schemas.pattern, model: "test", temperature: 0,
  sourceIds: new Set(pattern().supporting_evidence.map((e) => e.source_id)), ask,
});

test("runStep: a bad first answer gets exactly one retry listing the problem", async () => {
  const bad = pattern();
  bad.confidence = "Very high";
  const replay = replayAsk([bad, pattern()]);
  const { output } = await runStep(stepArgs(replay.ask));
  assert.equal(output.confidence, pattern().confidence);
  assert.equal(replay.calls.length, 2);
  assert.match(replay.calls[1].at(-1).content, /is not one of Low, Medium, High/);
});

test("runStep: two bad answers raise a StepError with the problems", async () => {
  const bad = pattern();
  bad.confidence = "Very high";
  const replay = replayAsk([bad, bad]);
  await assert.rejects(runStep(stepArgs(replay.ask)), (err) => err instanceof StepError && err.problems.length > 0);
});

test("runStep: an answer that isn't JSON is retried", async () => {
  const replay = replayAsk(["not json", pattern()]);
  await runStep(stepArgs(replay.ask));
  assert.match(replay.calls[1].at(-1).content, /The answer was not valid JSON\./);
});
