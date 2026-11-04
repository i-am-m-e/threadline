// The rules runPipeline enforces in code, rather than trusting the model.
// Each test replays the answers recorded on 2026-09-28, with one thing changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecordFile, findTriggeredWindows } from "../src/records.js";
import { runPipeline } from "../src/pipeline.js";
import { SIGNALS_CONFIG } from "../src/config.js";
import { loadAnswerKey, loadEvalPack, loadRules, loadEvidenceLibrary, loadSchemas } from "../scripts/eval/packs.js";
import { fixtureSteps, replayAsk } from "./helpers.js";

const rules = loadRules();
const records = loadEvalPack("healthcare", loadAnswerKey()).files.flatMap((f) => parseRecordFile(f.name, f.text));
const windows = findTriggeredWindows(records, rules);

/** Run the pipeline with the given answers (default: the recorded four). */
async function run({ answers, evidenceLibrary = loadEvidenceLibrary() } = {}) {
  const s = fixtureSteps("rooming");
  const replay = replayAsk(answers ? answers(s) : [s.pattern, s.analysis, s.options, s.card]);
  const result = await runPipeline({ windows, records, rules, evidenceLibrary, schemas: loadSchemas(), config: SIGNALS_CONFIG, ask: replay.ask });
  return { result, replay };
}
const logText = (result, step) => result.log.filter((l) => l.step === step).map((l) => l.detail).join("\n");
const lastMessage = (replay, call) => replay.calls[call].at(-1).content;

test("a High pattern confidence from one time window is lowered to Medium, and logged", async () => {
  const { result } = await run({ answers: (s) => [{ ...s.pattern, confidence: "High" }, s.analysis, s.options, s.card] });
  assert.equal(result.steps.pattern.confidence, "Medium");
  assert.match(logText(result, "pattern"), /confidence High → Medium/);
});

test("the domain comes from the trigger, not the model", async () => {
  const { result } = await run({ answers: (s) => [{ ...s.pattern, domain: "Energy" }, s.analysis, s.options, s.card] });
  assert.equal(result.steps.pattern.domain, "Healthcare");
  assert.match(logText(result, "pattern"), /domain "Energy" → "Healthcare"/);
});

test('a pattern statement not starting "Records suggest" is retried', async () => {
  const { replay } = await run({ answers: (s) => [{ ...s.pattern, pattern_statement: "Staff were slow." }, s.pattern, s.analysis, s.options, s.card] });
  assert.equal(replay.calls.length, 5);
  assert.match(lastMessage(replay, 1), /must begin with "Records suggest"/);
});

test('options without a "Learn more" option are retried', async () => {
  const noLearnMore = (s) => ({ ...s.options, options: s.options.options.map((o) => ({ ...o, type: "Process adjustment" })) });
  const { replay } = await run({ answers: (s) => [s.pattern, s.analysis, noLearnMore(s), s.options, s.card] });
  assert.match(lastMessage(replay, 3), /"Learn more"/);
});

test("options proposing to monitor individuals are retried", async () => {
  const monitoring = (s) => ({ ...s.options, options: s.options.options.map((o, i) => (i === 1 ? { ...o, description: "Monitor individual nurses each shift." } : o)) });
  const { replay } = await run({ answers: (s) => [s.pattern, s.analysis, monitoring(s), s.options, s.card] });
  assert.match(lastMessage(replay, 3), /Don't propose monitoring/);
});

test("the recommendation can't be more confident than the pattern", async () => {
  const high = (s) => ({ ...s.options, recommendation: { ...s.options.recommendation, confidence: "High" } });
  const { result } = await run({ answers: (s) => [s.pattern, s.analysis, high(s), s.card] });
  assert.ok(result.steps.evidence.length > 0, "this test needs library evidence to be selected");
  assert.equal(result.steps.pattern.confidence, "Medium");
  assert.equal(result.steps.options.recommendation.confidence, "Medium");
});

test('with no library evidence, options say "No library evidence" and the recommendation is Low', async () => {
  const noEvidence = (s) => ({ ...s.options, options: s.options.options.map((o) => ({ ...o, evidence_ids: [] })), recommendation: { ...s.options.recommendation, confidence: "Medium" } });
  const { result } = await run({ evidenceLibrary: [], answers: (s) => [s.pattern, s.analysis, noEvidence(s), s.card] });
  for (const o of result.steps.options.options) {
    assert.equal(o.evidence_strength, "None");
    assert.match(o.local_fit, /^No library evidence/);
  }
  assert.equal(result.steps.options.recommendation.confidence, "Low");
});

test('a card not beginning "Threadline noticed" is retried', async () => {
  const { replay } = await run({ answers: (s) => [s.pattern, s.analysis, s.options, { ...s.card, noticed: "Beds were full." }, s.card] });
  assert.match(lastMessage(replay, 4), /must begin with "Threadline noticed"/);
});

test("a card over 80 words is retried, naming the count", async () => {
  const long = (s) => ({ ...s.card, why_it_may_matter: "word ".repeat(80).trim() });
  const { replay } = await run({ answers: (s) => [s.pattern, s.analysis, s.options, long(s), s.card] });
  assert.match(lastMessage(replay, 4), /The card has \d+ words; the limit is 80/);
});

test("the card's evidence badge and confidence come from code", async () => {
  const { result } = await run({ answers: (s) => [s.pattern, s.analysis, s.options, { ...s.card, evidence_badge: "Based on 99 records", confidence: "High" }] });
  assert.match(result.steps.card.evidence_badge, /^Based on \d+ records: /);
  assert.notEqual(result.steps.card.evidence_badge, "Based on 99 records");
  assert.equal(result.steps.card.confidence, result.steps.pattern.confidence);
});
