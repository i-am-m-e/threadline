// Scoring a run against data/eval/answer-key.json, using the Thread recorded on 2026-09-28.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreRun, consistency } from "../scripts/eval/score.js";
import { loadAnswerKey } from "../scripts/eval/packs.js";
import { readJson, clone } from "./helpers.js";

const answerKey = loadAnswerKey();
/** The recorded rooming Thread as it stood after its first run (before the update file). */
function firstRunThread() {
  const t = clone(readJson("docs/test-results/2026-09-28/rooming-thread.json"));
  t.runs = t.runs.slice(0, 1);
  return t;
}
const check = (scored, id) => [...scored.hard, ...scored.soft].find((c) => c.id === id);
const score = (thread, packKey = "healthcare", extra = {}) => scoreRun({ packKey, answerKey, threads: [thread], seconds: 1, ...extra });

test("the recorded run cites both required qualitative records and a flow record", () => {
  const s = score(firstRunThread());
  assert.equal(check(s, "pattern_must_cite_all").pass, true);
  assert.equal(check(s, "pattern_must_cite_at_least_one_of").pass, true);
  assert.equal(s.confidence, "Medium");
});

test("citing an unrelated decoy fails, naming the decoy", () => {
  const t = firstRunThread();
  t.runs[0].steps.pattern.supporting_evidence.push({ source_id: "HC-INC-99110", trust_label: "Observed", finding: "x" });
  const c = check(score(t), "must_not_cite_anywhere");
  assert.equal(c.pass, false);
  assert.match(c.detail, /HC-INC-99110/);
});

test("a decoy cited in the analysis graph also counts as cited", () => {
  const t = firstRunThread();
  t.runs[0].steps.analysis.graph.nodes[0].source_ids.push("HC-INC-99110");
  assert.equal(check(score(t), "must_not_cite_anywhere").pass, false);
});

test("citing the parking complaint as support fails", () => {
  const t = firstRunThread();
  t.runs[0].steps.pattern.supporting_evidence.push({ source_id: "HC-CMP-4480", trust_label: "Observed", finding: "x" });
  assert.equal(check(score(t), "must_not_cite_as_support").pass, false);
});

test("mentioning the parking complaint as a possible confounder is recognised", () => {
  const t = firstRunThread();
  t.runs[0].steps.pattern.evidence_that_does_not_fit.push("The parking complaint may be a possible confounder.");
  assert.equal(check(score(t), "may_mention_as_possible_confounder").pass, true);
});

test("the update must not create a second Thread", () => {
  const a = clone(readJson("docs/test-results/2026-09-28/rooming-thread.json"));
  const b = { ...clone(a), id: "THR-OTHER-1" };
  const c = check(scoreRun({ packKey: "healthcare_update", answerKey, threads: [a, b], seconds: 1 }), "updates_existing_thread");
  assert.equal(c.pass, false);
  assert.match(c.detail, new RegExp(a.id));
  assert.match(c.detail, /THR-OTHER-1/);
});

test("the recorded update run passes the update checks", () => {
  const t = clone(readJson("docs/test-results/2026-09-28/rooming-thread.json"));
  const s = scoreRun({ packKey: "healthcare_update", answerKey, threads: [t], seconds: 1 });
  assert.equal(check(s, "updates_existing_thread").pass, true);
  assert.equal(check(s, "acceptable_pattern_confidence").pass, true);
});

test("a run that failed is scored as failed, without throwing", () => {
  const s = scoreRun({ packKey: "healthcare", answerKey, threads: [], error: "StepError: options", seconds: 3 });
  assert.equal(s.passed, false);
  const c = check(s, "no_step_errors");
  assert.equal(c.pass, false);
  assert.match(c.detail, /StepError/);
});

test("retries and code adjustments are counted from the run's log", () => {
  const t = firstRunThread();
  t.runs[0].log = [{ step: "options", type: "problems", detail: "x" }, { step: "pattern", type: "adjusted", detail: "y" }, { step: "pattern", type: "adjusted", detail: "z" }];
  const s = score(t);
  assert.equal(s.retries, 1);
  assert.equal(s.adjustments, 2);
});

test("consistency: two of three runs agreeing on confidence is 2/3", () => {
  const runs = ["Medium", "Medium", "Low"].map((confidence) => ({ confidence, citedIds: ["A", "B"], leadingOptionType: "Learn more" }));
  const c = consistency(runs);
  assert.ok(Math.abs(c.confidenceAgreement - 2 / 3) < 1e-9);
  assert.equal(c.citationAgreement, 1);
  assert.equal(c.leadingOptionAgreement, 1);
});

test("consistency: citation agreement is the average overlap between runs", () => {
  const c = consistency([{ confidence: "Medium", citedIds: ["A", "B"] }, { confidence: "Medium", citedIds: ["A", "C"] }]);
  assert.ok(Math.abs(c.citationAgreement - 1 / 3) < 1e-9);
});

test("consistency ignores failed runs and is 1 with fewer than two successes", () => {
  const c = consistency([{ error: "x" }, { confidence: "Low", citedIds: ["A"] }]);
  assert.deepEqual(c, { confidenceAgreement: 1, citationAgreement: 1, leadingOptionAgreement: 1, successfulRuns: 1 });
});
