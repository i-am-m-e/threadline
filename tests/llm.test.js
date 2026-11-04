// Tests for src/llm.js: the checks every Signals answer goes through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateAgainstSchema, guardSources, findGuardrailProblems, runStep, StepError } from "../src/llm.js";
import { fixtureSteps, replayAsk, loadSchemas, clone } from "./helpers.js";

const schemas = loadSchemas();
const pattern = () => clone(fixtureSteps("rooming").pattern);

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

// ---------- Step 2: verification problems join the retry, then unverified items are removed ----------

// A stand-in for the real checks: any evidence item whose finding says "MADE UP" is unverified.
const toyVerify = (removed = []) => (output) =>
  output.supporting_evidence
    .filter((e) => e.finding.includes("MADE UP"))
    .map((e) => ({
      problem: `${e.source_id}: the finding isn't in that record.`,
      remove: () => {
        output.supporting_evidence.splice(output.supporting_evidence.indexOf(e), 1);
        removed.push(e.source_id);
        return `${e.source_id}: unverified, removed`;
      },
    }));
const withMadeUp = () => {
  const p = pattern();
  p.supporting_evidence[0].finding = "MADE UP finding";
  return p;
};

test("runStep verify: an unverified item is named in the one retry; a fixed answer is kept whole", async () => {
  const removed = [];
  const replay = replayAsk([withMadeUp(), pattern()]);
  const { output, log } = await runStep({ ...stepArgs(replay.ask), verify: toyVerify(removed) });
  assert.equal(replay.calls.length, 2);
  assert.match(replay.calls[1].at(-1).content, /the finding isn't in that record/);
  assert.equal(output.supporting_evidence.length, pattern().supporting_evidence.length);
  assert.deepEqual(removed, []);
  assert.equal(log.filter((l) => l.type === "unverified_removed").length, 0);
});

test("runStep verify: still unverified after the retry → removed and logged, not a step failure", async () => {
  const removed = [];
  const replay = replayAsk([withMadeUp(), withMadeUp()]);
  const { output, log } = await runStep({ ...stepArgs(replay.ask), verify: toyVerify(removed) });
  assert.equal(replay.calls.length, 2, "no extra model call");
  assert.equal(output.supporting_evidence.length, pattern().supporting_evidence.length - 1);
  assert.deepEqual(removed, [pattern().supporting_evidence[0].source_id]);
  const removals = log.filter((l) => l.type === "unverified_removed");
  assert.equal(removals.length, 1);
  assert.match(removals[0].detail, /unverified, removed/);
  assert.equal(log.filter((l) => l.type === "problems").length, 1, "the retry is counted once, as before");
});

test("runStep verify: other problems on the second answer still fail the step", async () => {
  const bad = withMadeUp();
  bad.confidence = "Very high";
  const replay = replayAsk([withMadeUp(), bad]);
  await assert.rejects(runStep({ ...stepArgs(replay.ask), verify: toyVerify() }), (err) => err instanceof StepError);
});

test("runStep verify: checks run after the source guard has removed invented ids", async () => {
  const p = pattern();
  p.supporting_evidence[0] = { source_id: "HC-FAKE-1", trust_label: "Observed", finding: "MADE UP finding", quote: "", record_values: [] };
  const seen = [];
  const replay = replayAsk([p]);
  await runStep({ ...stepArgs(replay.ask), verify: (o) => { seen.push(...o.supporting_evidence.map((e) => e.source_id)); return []; } });
  assert.ok(!seen.includes("HC-FAKE-1"));
});

// Found on the founder's Mac (2026-11-04): an energy map label "Near Miss Report" was refused as a
// person's name ("Miss Report"). "Near miss" is a domain term, not a title.
for (const text of ["Near Miss Report", "near miss report", "Near-Miss Report", "near-miss Review", "EHS Near Miss Event"]) {
  test(`name scan allows "${text}"`, () => {
    assert.deepEqual(findGuardrailProblems({ label: text }), []);
  });
}

for (const text of ["Miss Smith", "Miss J. Smith", "reported by Miss Chen near the gate"]) {
  test(`name scan still catches "${text}"`, () => {
    assert.ok(findGuardrailProblems({ label: text }).length > 0);
  });
}
