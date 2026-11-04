// The rules runPipeline enforces in code, rather than trusting the model.
// Each test replays the answers recorded on 2026-09-28 (with the step 2 fields added:
// tests/fixtures/step2/), with one thing changed.
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

// ---------- Step 2: every finding is checked against the record it cites ----------

const withEvidence = (pattern, sourceId, change) => ({
  ...pattern,
  supporting_evidence: pattern.supporting_evidence.map((e) => (e.source_id === sourceId ? { ...e, ...change } : e)),
});
const withGap = (analysis, change) => ({ ...analysis, policy_practice_gap: { ...analysis.policy_practice_gap, ...change } });
const removals = (result, step) => result.log.filter((l) => l.step === step && l.type === "unverified_removed");

test("findings that match their records pass, and the tally says so", async () => {
  const { result, replay } = await run();
  assert.equal(replay.calls.length, 4, "no retry needed");
  assert.deepEqual(result.meta.verification, {
    findings_checked: 6, findings_verified: 6, findings_removed: [], fixed_on_retry: 0, policy_quote: "verified",
    analysis: { claims_checked: 4, claims_verified: 4, claims_removed: [], labels_corrected: 0 },
    map: { nodes_checked: 9, nodes_verified: 9, nodes_removed: [], labels_corrected: 2 },
    card: "verified",
  });
});

test("a real record id with an invented number is caught and named in the retry", async () => {
  const wrong = (s) => withEvidence(s.pattern, "HC-CMP-4471", { finding: "Patient waited 95 minutes after rooming." });
  const { result, replay } = await run({ answers: (s) => [wrong(s), s.pattern, s.analysis, s.options, s.card] });
  assert.match(lastMessage(replay, 1), /HC-CMP-4471: the finding mentions 95/);
  assert.equal(result.meta.verification.findings_verified, 6);
  assert.equal(result.meta.verification.fixed_on_retry, 1);
});

test("a flow finding with the wrong value is caught and named in the retry", async () => {
  const wrong = (s) => withEvidence(s.pattern, "HC-FLOW-20260920-1600", { record_values: [{ field: "room_to_physician_minutes", value: 120 }] });
  const { replay } = await run({ answers: (s) => [wrong(s), s.pattern, s.analysis, s.options, s.card] });
  assert.match(lastMessage(replay, 1), /room_to_physician_minutes is 90 in that record, not 120/);
});

test("a finding still unverified after the retry is removed and logged, and the run carries on", async () => {
  const wrong = (s) => withEvidence(s.pattern, "HC-CMP-4471", { quote: "waited two hours in the exam room" });
  const { result } = await run({ answers: (s) => [wrong(s), wrong(s), s.analysis, s.options, s.card] });
  const cited = result.steps.pattern.supporting_evidence.map((e) => e.source_id);
  assert.ok(!cited.includes("HC-CMP-4471"));
  assert.equal(removals(result, "pattern").length, 1);
  assert.match(removals(result, "pattern")[0].detail, /HC-CMP-4471: unverified, removed/);
  const v = result.meta.verification;
  assert.equal(v.findings_checked, 6);
  assert.equal(v.findings_verified, 5);
  assert.equal(v.findings_removed.length, 1);
  assert.equal(v.findings_removed[0].source_id, "HC-CMP-4471");
  assert.match(v.findings_removed[0].problem, /isn't in that record/);
});

test("confidence is worked out from the findings that are left after removals", async () => {
  const wrong = (s) => withEvidence(withEvidence(s.pattern, "HC-CMP-4471", { quote: "waited two hours in the exam room" }), "HC-INC-99102", { quote: "no beds anywhere in the whole department" });
  const { result } = await run({ answers: (s) => [wrong(s), wrong(s), s.analysis, s.options, s.card] });
  assert.equal(result.meta.verification.findings_removed.length, 2);
  assert.equal(result.steps.pattern.confidence, "Low", "only flow records are left: one source type");
});

test("an invented policy quote is caught in the retry, then blanked with its policy id", async () => {
  const wrong = (s) => withGap(s.analysis, { policy_quote: "must be seen by a physician within 30 minutes" });
  const first = await run({ answers: (s) => [s.pattern, wrong(s), s.analysis, s.options, s.card] });
  assert.match(lastMessage(first.replay, 2), /policy_practice_gap: HC-POL-CTAS-ESC: the quote .* isn't in that record/);
  assert.equal(first.result.meta.verification.policy_quote, "verified");

  const { result } = await run({ answers: (s) => [s.pattern, wrong(s), wrong(s), s.options, s.card] });
  assert.equal(result.steps.analysis.policy_practice_gap.policy_source_id, "");
  assert.equal(result.steps.analysis.policy_practice_gap.policy_quote, "");
  assert.equal(removals(result, "analysis").length, 1);
  assert.equal(result.meta.verification.policy_quote, "removed");
});

test("the energy pack's findings verify too, including permits per inspector (worked out by code)", async () => {
  const energyRecords = loadEvalPack("energy", loadAnswerKey()).files.flatMap((f) => parseRecordFile(f.name, f.text));
  const s = fixtureSteps("energy");
  const replay = replayAsk([s.pattern, s.analysis, s.options, s.card]);
  const result = await runPipeline({ windows: findTriggeredWindows(energyRecords, rules), records: energyRecords, rules,
    evidenceLibrary: loadEvidenceLibrary(), schemas: loadSchemas(), config: SIGNALS_CONFIG, ask: replay.ask });
  assert.equal(replay.calls.length, 4);
  assert.equal(result.meta.verification.findings_verified, 12);
  assert.equal(result.meta.verification.policy_quote, "verified");
});

test("Prompt 1 asks for a quote or record values; Prompt 2 asks for a policy quote", async () => {
  const { replay } = await run();
  assert.match(replay.prompts[0], /"quote": ""/);
  assert.match(replay.prompts[0], /"record_values": \[/);
  assert.match(replay.prompts[0], /copied exactly/);
  assert.match(replay.prompts[1], /"policy_quote": ""/);
  assert.match(replay.prompts[1], /copied exactly/);
});

// ---------- Analysis claims: contributing conditions and the pressure map ----------

const withCondition = (analysis, i, change) => ({ ...analysis, contributing_conditions: analysis.contributing_conditions.map((c, j) => (j === i ? { ...c, ...change } : c)) });
const withPressure = (analysis, i, change) => ({ ...analysis, pressure_map: analysis.pressure_map.map((p, j) => (j === i ? { ...p, ...change } : p)) });

test("the recorded analysis claims pass, and the tally says so", async () => {
  const { result } = await run();
  assert.deepEqual(result.meta.verification.analysis, { claims_checked: 4, claims_verified: 4, claims_removed: [], labels_corrected: 0 });
});

test("an analysis claim with an invented number is named in the retry", async () => {
  const wrong = (s) => withCondition(s.analysis, 1, { condition: "Room-to-physician times of 140 minutes" });
  const { replay, result } = await run({ answers: (s) => [s.pattern, wrong(s), s.analysis, s.options, s.card] });
  assert.match(lastMessage(replay, 2), /"Room-to-physician times of 140 minutes" mentions 140/);
  assert.equal(result.meta.verification.analysis.claims_verified, 4);
});

test("an analysis claim still unverified after the retry is removed and logged", async () => {
  const wrong = (s) => withPressure(s.analysis, 0, { pressure_carried: "Escalating 12 times an hour" });
  const { result } = await run({ answers: (s) => [s.pattern, wrong(s), wrong(s), s.options, s.card] });
  assert.equal(result.steps.analysis.pressure_map.length, 1);
  const a = result.meta.verification.analysis;
  assert.equal(a.claims_checked, 4);
  assert.equal(a.claims_verified, 3);
  assert.match(a.claims_removed[0].problem, /mentions 12/);
  assert.ok(result.log.some((l) => l.step === "analysis" && l.type === "unverified_removed" && /pressure_map/.test(l.detail)));
});

test("a trust label that doesn't fit the cited records is corrected in code and logged (no retry)", async () => {
  const mislabelled = (s) => withPressure(withCondition(s.analysis, 0, { trust_label: "Authoritative" }), 1, { trust_label: "Experiential" });
  const { replay, result } = await run({ answers: (s) => [s.pattern, mislabelled(s), s.options, s.card] });
  assert.equal(replay.calls.length, 4, "no retry");
  assert.equal(result.steps.analysis.contributing_conditions[0].trust_label, "Observed", "it cites flow records, not a policy");
  assert.equal(result.steps.analysis.pressure_map[1].trust_label, "Authoritative", "it cites the policy; only people add Experiential");
  assert.equal(result.meta.verification.analysis.labels_corrected, 2);
  assert.match(logText(result, "analysis"), /trust_label "Authoritative" → "Observed"/);
});

test("a claim citing no records becomes Inferred", async () => {
  const noSources = (s) => withCondition(s.analysis, 0, { source_ids: [], trust_label: "Observed" });
  const { result } = await run({ answers: (s) => [s.pattern, noSources(s), s.options, s.card] });
  assert.equal(result.steps.analysis.contributing_conditions[0].trust_label, "Inferred");
});

test("Prompt 1 doesn't limit the domain to Healthcare or Energy", async () => {
  const { replay } = await run();
  assert.doesNotMatch(replay.prompts[0], /"Healthcare" \| "Energy"/);
});

// ---------- The Thread map's nodes and the review card ----------

const withNode = (analysis, i, change) => ({ ...analysis, graph: { ...analysis.graph, nodes: analysis.graph.nodes.map((n, j) => (j === i ? { ...n, ...change } : n)) } });

test("map nodes: the recorded run's labels verify; its two role nodes labelled Experiential with no sources become Inferred", async () => {
  const { result, replay } = await run();
  assert.equal(replay.calls.length, 4, "no retry");
  assert.deepEqual(result.meta.verification.map, { nodes_checked: 9, nodes_verified: 9, nodes_removed: [], labels_corrected: 2 });
  const roles = result.steps.analysis.graph.nodes.filter((n) => n.node_type === "role");
  assert.deepEqual(roles.map((n) => n.trust_label), ["Inferred", "Inferred"]);
  assert.match(logText(result, "analysis"), /graph\.nodes: "Charge Nurse": trust_label "Experiential" → "Inferred"/);
});

test("map nodes: a label with an invented number is named in the retry", async () => {
  const wrong = (s) => withNode(s.analysis, 6, { label: "Patient waited 140 minutes" });
  const { replay } = await run({ answers: (s) => [s.pattern, wrong(s), s.analysis, s.options, s.card] });
  assert.match(lastMessage(replay, 2), /graph\.nodes: "Patient waited 140 minutes" mentions 140/);
});

test("map nodes: a node still unverified after the retry is removed, with its lines", async () => {
  const wrong = (s) => withNode(s.analysis, 6, { label: "Patient waited 140 minutes" });
  const { result } = await run({ answers: (s) => [s.pattern, wrong(s), wrong(s), s.options, s.card] });
  const { nodes, edges } = result.steps.analysis.graph;
  const goneId = fixtureSteps("rooming").analysis.graph.nodes[6].id;
  assert.ok(!nodes.some((n) => n.id === goneId));
  assert.ok(!edges.some((e) => e.source === goneId || e.target === goneId));
  assert.equal(result.meta.verification.map.nodes_removed.length, 1);
});

test("review card: the recorded card verifies", async () => {
  const { result } = await run();
  assert.equal(result.meta.verification.card, "verified");
});

test("review card: a number that isn't in the cited records is named in the retry", async () => {
  const wrong = (s) => ({ ...s.card, why_it_may_matter: "Patients waited up to 140 minutes." });
  const { replay, result } = await run({ answers: (s) => [s.pattern, s.analysis, s.options, wrong(s), s.card] });
  assert.match(lastMessage(replay, 4), /card\.why_it_may_matter: "Patients waited up to 140 minutes\." mentions 140/);
  assert.equal(result.meta.verification.card, "verified");
});

test("review card: still unverified after the retry → that wording is replaced and logged, not kept", async () => {
  const wrong = (s) => ({ ...s.card, noticed: "Threadline noticed waits of 140 minutes." });
  const { result } = await run({ answers: (s) => [s.pattern, s.analysis, s.options, wrong(s), wrong(s)] });
  const card = result.steps.card;
  assert.match(card.noticed, /^Threadline noticed a possible pattern/);
  assert.doesNotMatch(card.noticed, /140/);
  assert.equal(result.meta.verification.card, "replaced");
  assert.ok(result.log.some((l) => l.step === "reviewCard" && l.type === "unverified_removed" && /card\.noticed/.test(l.detail)));
});
