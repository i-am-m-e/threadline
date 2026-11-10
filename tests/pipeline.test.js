// The rules runPipeline enforces in code, rather than trusting the model.
// Each test replays the answers recorded on 2026-09-28 (with the step 2 fields added:
// tests/fixtures/step2/), with one thing changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecordFile, findTriggeredWindows } from "../src/records.js";
import { runPipeline } from "../src/pipeline.js";
import { SIGNALS_CONFIG } from "../src/config.js";
import { loadAnswerKey, loadEvalPack, loadRules, loadEvidenceLibrary, loadSchemas } from "../scripts/eval/packs.js";
import { fixtureSteps, replayAsk, askByStep } from "./helpers.js";

const rules = loadRules();
const records = loadEvalPack("healthcare", loadAnswerKey()).files.flatMap((f) => parseRecordFile(f.name, f.text));
const windows = findTriggeredWindows(records, rules);

/** Run the pipeline with the given answers (default: the recorded four). */
async function run({ answers, evidenceLibrary = loadEvidenceLibrary(), config = SIGNALS_CONFIG } = {}) {
  const s = fixtureSteps("rooming");
  const replay = replayAsk(answers ? answers(s) : [s.pattern, s.analysis, s.options, s.card]);
  const result = await runPipeline({ windows, records, rules, evidenceLibrary, schemas: loadSchemas(), config, ask: replay.ask });
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
    findings_checked: 6, findings_verified: 6, findings_removed: [], fixed_on_retry: 0, findings_labels_corrected: 0, policy_quote: "verified",
    analysis: { claims_checked: 4, claims_verified: 4, claims_removed: [], labels_corrected: 0 },
    map: { nodes_checked: 9, nodes_verified: 9, nodes_removed: [], labels_corrected: 2 },
    card: "verified",
    wording: { checked: 7, replaced: [], removed: [] },
    windows: { total: 1, cited: 1, uncited: [] },
    rationale: "ok",
    learn_more: "not checked",
    safety_not_fit: { asked: 0, left: [] },
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
  // The recorded energy rationale has 3 sentences, so the options step is retried once.
  const replay = replayAsk([s.pattern, s.analysis, s.options, s.options, s.card]);
  const result = await runPipeline({ windows: findTriggeredWindows(energyRecords, rules), records: energyRecords, rules,
    evidenceLibrary: loadEvidenceLibrary(), schemas: loadSchemas(), config: SIGNALS_CONFIG, ask: replay.ask });
  assert.equal(replay.calls.length, 5);
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

// ---------- Findings that claim a safety-relevant condition (issue 11, 2026-11-05) ----------
// A finding whose wording matches one of the domain's word-based safety conditions must cite a
// record that describes that same condition. The good-catch report EN-INC-20260920-06 says the
// crew did NOT begin work before zero-energy sign-off; in 2026-11-05-2 the model cited it for
// "Work started before zero-energy verification" in all 3 runs.

const energyRecords = loadEvalPack("energy", loadAnswerKey()).files.flatMap((f) => parseRecordFile(f.name, f.text));
const energyWindows = findTriggeredWindows(energyRecords, rules);
const goodCatch = (finding) => ({
  source_id: "EN-INC-20260920-06", trust_label: "Observed", finding,
  quote: "waited 90 minutes for zero-energy verification", record_values: [],
});
const withGoodCatch = (pattern, finding = "Work started before zero-energy verification") =>
  ({ ...pattern, supporting_evidence: [...pattern.supporting_evidence, goodCatch(finding)] });
/** Energy run with the given pattern answers (the recorded options step is retried once: 3-sentence rationale). */
async function runEnergy(patternAnswers) {
  const s = fixtureSteps("energy");
  const replay = replayAsk([...patternAnswers(s), s.analysis, s.options, s.options, s.card]);
  const result = await runPipeline({ windows: energyWindows, records: energyRecords, rules,
    evidenceLibrary: loadEvidenceLibrary(), schemas: loadSchemas(), config: SIGNALS_CONFIG, ask: replay.ask });
  return { result, replay };
}
const cites = (result, id) => result.steps.pattern.supporting_evidence.some((e) => e.source_id === id);

test("safety condition: a finding claiming one, citing a record that doesn't describe it, is named in the retry", async () => {
  const { replay } = await runEnergy((s) => [withGoodCatch(s.pattern), s.pattern]);
  const retry = lastMessage(replay, 1);
  assert.match(retry, /EN-INC-20260920-06: the finding says "Work started before zero-energy verification"/);
  assert.match(retry, /safety-relevant condition/);
  assert.match(retry, /doesn't describe it/);
  assert.match(retry, /list it under evidence_that_does_not_fit/);
});

test("safety condition: still claimed after the retry, the finding is removed and logged; nothing is added to 'does not fit'", async () => {
  const { result } = await runEnergy((s) => [withGoodCatch(s.pattern), withGoodCatch(s.pattern)]);
  assert.ok(!cites(result, "EN-INC-20260920-06"));
  assert.ok(cites(result, "EN-NM-20260920-01"), "the near miss that does describe it is kept");
  const removed = result.meta.verification.findings_removed;
  assert.equal(removed.length, 1);
  assert.equal(removed[0].source_id, "EN-INC-20260920-06");
  assert.match(removed[0].problem, /safety-relevant condition/);
  assert.match(removals(result, "pattern").map((l) => l.detail).join("\n"), /EN-INC-20260920-06: unverified, removed/);
  assert.deepEqual(result.steps.pattern.evidence_that_does_not_fit, [], "code doesn't add it to 'does not fit' itself");
});

test("safety condition: if the retry moves the record to 'does not fit', nothing is removed", async () => {
  const fixed = (s) => ({ ...s.pattern, evidence_that_does_not_fit: ["EN-INC-20260920-06: the crew did not begin work until sign-off."] });
  const { result } = await runEnergy((s) => [withGoodCatch(s.pattern), fixed(s)]);
  assert.ok(!cites(result, "EN-INC-20260920-06"));
  assert.deepEqual(result.meta.verification.findings_removed, []);
  assert.equal(result.meta.verification.fixed_on_retry, 1);
  assert.match(result.steps.pattern.evidence_that_does_not_fit[0], /^EN-INC-20260920-06/);
});

test("safety condition: findings citing a record that does describe it are kept (EN-NM-20260920-01, HC-INC-99102)", async () => {
  const energy = await runEnergy((s) => [s.pattern]);
  assert.ok(cites(energy.result, "EN-NM-20260920-01"));
  assert.deepEqual(energy.result.meta.verification.findings_removed, []);
  const healthcare = await run();
  assert.equal(healthcare.replay.calls.length, 4, "no retry");
  assert.ok(cites(healthcare.result, "HC-INC-99102"));
});

test("safety condition: a finding that claims no safety condition isn't affected", async () => {
  const { result, replay } = await runEnergy((s) => [withGoodCatch(s.pattern, "Crew waited for zero-energy verification.")]);
  assert.equal(replay.calls.length, 5, "no pattern retry");
  assert.ok(cites(result, "EN-INC-20260920-06"));
});

test("safety condition (known limit): matching is on words, so a negative finding is treated as a claim too", async () => {
  // "not started before zero-energy" still contains "started", "before" and "zero-energy".
  // Accepted by the founder (2026-11-05): it keeps the record out of support, which is right here.
  const negative = "Work was not started before zero-energy verification";
  const { result, replay } = await runEnergy((s) => [withGoodCatch(s.pattern, negative), withGoodCatch(s.pattern, negative)]);
  assert.match(lastMessage(replay, 1), /EN-INC-20260920-06: the finding says "Work was not started before zero-energy verification"/);
  assert.ok(!cites(result, "EN-INC-20260920-06"));
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

// ---------- The rest of the text that describes the records ----------

const wordingLog = (result) => result.log.filter((l) => l.type === "unverified_removed").map((l) => l.detail).join("\n");

test("the recorded runs' other wording verifies, with nothing replaced or removed", async () => {
  for (const runIndex of [0, 1]) {
    const s = fixtureSteps("rooming", runIndex);
    const ask = askByStep(s);
    const result = await runPipeline({ windows, records, rules, evidenceLibrary: loadEvidenceLibrary(), schemas: loadSchemas(), config: SIGNALS_CONFIG, ask });
    // (Run 2's options are retried for its 3-sentence rationale; that's not about wording.)
    assert.deepEqual(ask.calls.filter((c) => c !== "options"), ["pattern", "analysis", "card"], `rooming run ${runIndex}: no wording retry`);
    assert.deepEqual(result.meta.verification.wording.replaced, []);
    assert.deepEqual(result.meta.verification.wording.removed, []);
  }
  const { result } = await run();
  assert.equal(result.meta.verification.wording.checked, 7, "statement, 3 vignette parts, 1 compounding factor, 2 policy-gap parts");
});

test("pattern statement with an invented number: named in the retry, then replaced by a plain line", async () => {
  const wrong = (s) => ({ ...s.pattern, pattern_statement: "Records suggest waits of 140 minutes." });
  const first = await run({ answers: (s) => [wrong(s), s.pattern, s.analysis, s.options, s.card] });
  assert.match(lastMessage(first.replay, 1), /pattern_statement: "Records suggest waits of 140 minutes\." mentions 140/);

  const { result } = await run({ answers: (s) => [wrong(s), wrong(s), s.analysis, s.options, s.card] });
  assert.equal(result.steps.pattern.pattern_statement, "Records suggest a possible pattern: Rooming during slow physician pace at Synthetic UCC A.");
  assert.match(wordingLog(result), /pattern_statement: unverified, replaced/);
  assert.equal(result.meta.verification.wording.replaced[0].field, "pattern_statement");
});

test("a vignette part with an invented number is replaced, the others kept", async () => {
  const wrong = (s) => ({ ...s.pattern, possible_vignette: { ...s.pattern.possible_vignette, observed_effects: "A patient waited 140 minutes." } });
  const { result } = await run({ answers: (s) => [wrong(s), wrong(s), s.analysis, s.options, s.card] });
  const v = result.steps.pattern.possible_vignette;
  assert.doesNotMatch(v.observed_effects, /140/);
  assert.match(v.observed_effects, /wording was removed/);
  assert.equal(v.situation, fixtureSteps("rooming").pattern.possible_vignette.situation);
});

test("an 'evidence that does not fit' item with an invented number is removed", async () => {
  const wrong = (s) => ({ ...s.pattern, evidence_that_does_not_fit: ["A compliment about a 15-minute wait (HC-CMP-4475)", "A 140-minute wait in triage"] });
  const { result } = await run({ answers: (s) => [wrong(s), wrong(s), s.analysis, s.options, s.card] });
  assert.deepEqual(result.steps.pattern.evidence_that_does_not_fit, ["A compliment about a 15-minute wait (HC-CMP-4475)"], "the compliment's 15 is in its record; 140 isn't in any");
  assert.equal(result.meta.verification.wording.removed[0].list, "evidence_that_does_not_fit");
});

test("a 'where small variations combine' item with an invented number is removed", async () => {
  const wrong = (s) => ({ ...s.analysis, compounding_factors: [...s.analysis.compounding_factors, "Three discharges delayed by 140 minutes"] });
  const { result } = await run({ answers: (s) => [s.pattern, wrong(s), wrong(s), s.options, s.card] });
  assert.deepEqual(result.steps.analysis.compounding_factors, fixtureSteps("rooming").analysis.compounding_factors);
});

test("'policy expects' with an invented number is replaced by the verified policy quote", async () => {
  const wrong = (s) => withGap(s.analysis, { what_policy_expects: "A monitored bed within 10 minutes of arrival." });
  const { result } = await run({ answers: (s) => [s.pattern, wrong(s), wrong(s), s.options, s.card] });
  const gap = result.steps.analysis.policy_practice_gap;
  assert.equal(gap.what_policy_expects, "“require immediate access to a monitored bed on arrival” (quoted from the policy)");
});

test("'records suggest' with an invented number is replaced by a plain line", async () => {
  const wrong = (s) => withGap(s.analysis, { what_records_suggest: "Occupancy reached 99%." });
  const { result } = await run({ answers: (s) => [s.pattern, wrong(s), wrong(s), s.options, s.card] });
  assert.match(result.steps.analysis.policy_practice_gap.what_records_suggest, /wording was removed/);
});

test("if the policy quote is unverified too, 'policy expects' gets the plain line, never the unverified quote", async () => {
  const wrong = (s) => withGap(s.analysis, { what_policy_expects: "A monitored bed within 10 minutes.", policy_quote: "a monitored bed within 10 minutes" });
  const { result } = await run({ answers: (s) => [s.pattern, wrong(s), wrong(s), s.options, s.card] });
  const gap = result.steps.analysis.policy_practice_gap;
  assert.equal(gap.policy_quote, "");
  assert.match(gap.what_policy_expects, /wording was removed/);
  assert.doesNotMatch(gap.what_policy_expects, /10 minutes/);
});

test("wording checked against all the step's records says so in the reason", async () => {
  const wrong = (s) => ({ ...s.pattern, pattern_statement: "Records suggest waits of 140 minutes." });
  const { replay } = await run({ answers: (s) => [wrong(s), s.pattern, s.analysis, s.options, s.card] });
  assert.match(lastMessage(replay, 1), /mentions 140, which isn't in this Thread's records/);
});

// ---------- Model weaknesses from the 2026-09-28 results ----------

// The healthcare Thread after the second flow file: two time windows (Sept 20 and Sept 22).
const bothFiles = [...loadEvalPack("healthcare", loadAnswerKey()).files, ...loadEvalPack("healthcare_update", loadAnswerKey()).files]
  .flatMap((f) => parseRecordFile(f.name, f.text));
const twoWindows = findTriggeredWindows(bothFiles, rules);
const runUpdate = (steps) => {
  const ask = askByStep(steps);
  return runPipeline({ windows: twoWindows, records: bothFiles, rules, evidenceLibrary: loadEvidenceLibrary(), schemas: loadSchemas(), config: SIGNALS_CONFIG, ask })
    .then((result) => ({ result, calls: ask.calls }));
};

test("update runs: a time window with no cited record gets the retry, naming the window", async () => {
  assert.equal(twoWindows.length, 2);
  const { result, calls } = await runUpdate(fixtureSteps("rooming", 1)); // the recorded update run cites only Sept 20
  assert.deepEqual(calls.filter((c) => c === "pattern"), ["pattern", "pattern"]);
  assert.deepEqual(result.meta.verification.windows, { total: 2, cited: 1, uncited: ["2026-09-22 14:00 to 16:00"] });
  assert.match(logText(result, "pattern"), /2026-09-22 14:00 to 16:00: still no cited record after the retry/);
});

test("update runs: citing a record from each window passes without a retry", async () => {
  const s = fixtureSteps("rooming", 1);
  s.pattern.supporting_evidence.push({ source_id: "HC-FLOW-20260922-1500", trust_label: "Observed", finding: "Bed occupancy was 94% on Sept 22.",
    quote: "", record_values: [{ field: "bed_occupancy", value: 0.94 }] });
  const { result, calls } = await runUpdate(s);
  assert.deepEqual(calls.filter((c) => c === "pattern"), ["pattern"]);
  assert.deepEqual(result.meta.verification.windows, { total: 2, cited: 2, uncited: [] });
});

test("a single-window run passes the window check", async () => {
  const { result } = await run();
  assert.deepEqual(result.meta.verification.windows, { total: 1, cited: 1, uncited: [] });
});

test("a recommendation rationale over 2 sentences gets the retry, then is cut to 2 sentences", async () => {
  const s = fixtureSteps("rooming", 1); // its recorded rationale has 3 sentences
  const { result, calls } = await runUpdate(s);
  assert.deepEqual(calls.filter((c) => c === "options"), ["options", "options"]);
  const rationale = result.steps.options.recommendation.rationale;
  assert.equal(rationale, s.options.recommendation.rationale.split(/(?<=[.!?])\s+(?=[A-Z])/).slice(0, 2).join(" "));
  assert.equal(result.meta.verification.rationale, "shortened");
  assert.match(logText(result, "options"), /rationale: still 3 sentences after the retry; shortened to the first 2/);
});

test("a rationale of 2 sentences or fewer is left alone", async () => {
  const { result } = await run();
  assert.equal(result.meta.verification.rationale, "ok");
});

// ---------- Review fixes ----------

test("review card: stating how many records support the pattern is allowed (the prompt asks for it)", async () => {
  const counting = (s) => ({ ...s.card, noticed: "Threadline noticed a pattern across 6 records from 3 source types in 1 time window." });
  const { replay, result } = await run({ answers: (s) => [s.pattern, s.analysis, s.options, counting(s)] });
  assert.equal(replay.calls.length, 4, "no retry");
  assert.equal(result.meta.verification.card, "verified");
});

test("review card: if replacing its wording takes it over 80 words, that's noted, not hidden", async () => {
  const long = (s) => ({ ...s.card, noticed: "Threadline noticed 140.", why_it_may_matter: "word ".repeat(37).trim() }); // 79 words before the replacement
  const { result } = await run({ answers: (s) => [s.pattern, s.analysis, s.options, long(s), long(s)] });
  assert.equal(result.meta.verification.card, "replaced");
  assert.match(logText(result, "reviewCard"), /the card is \d+ words after the replacement \(limit 80\)/);
});

test("map: removals that leave fewer than 6 nodes are accepted and noted, not padded", async () => {
  const wrong = (s) => ({ ...s.analysis, graph: { ...s.analysis.graph, nodes: s.analysis.graph.nodes.map((n, i) => (i < 4 ? { ...n, label: `Waited ${140 + i} minutes` } : n)) } });
  const { result } = await run({ answers: (s) => [s.pattern, wrong(s), wrong(s), s.options, s.card] });
  assert.equal(result.steps.analysis.graph.nodes.length, 5);
  assert.match(logText(result, "analysis"), /the map has 5 nodes after removals \(usually 6 to 12\)/);
});

test("the policy gap must cite a policy, not another kind of record", async () => {
  const notAPolicy = (s) => withGap(s.analysis, { policy_source_id: "HC-INC-99102", policy_quote: "no available monitored bed when an EMS" });
  const first = await run({ answers: (s) => [s.pattern, notAPolicy(s), s.analysis, s.options, s.card] });
  assert.match(lastMessage(first.replay, 2), /policy_source_id: HC-INC-99102 is an incident report, not a policy/);

  const { result } = await run({ answers: (s) => [s.pattern, notAPolicy(s), notAPolicy(s), s.options, s.card] });
  assert.equal(result.steps.analysis.policy_practice_gap.policy_source_id, "");
  assert.equal(result.meta.verification.policy_quote, "removed");
});

test("a finding's trust label must fit its record too (corrected in code)", async () => {
  const mislabelled = (s) => withEvidence(s.pattern, "HC-FLOW-20260920-1600", { trust_label: "Historical" });
  const { result } = await run({ answers: (s) => [mislabelled(s), s.analysis, s.options, s.card] });
  assert.equal(result.steps.pattern.supporting_evidence.find((e) => e.source_id === "HC-FLOW-20260920-1600").trust_label, "Observed");
  assert.equal(result.meta.verification.findings_labels_corrected, 1);
});

test("'fixed or dropped on retry' counts findings, not record ids", async () => {
  // The first answer cites the incident twice, one finding wrong; the retry drops the wrong one.
  const twice = (s) => ({ ...s.pattern, supporting_evidence: [...s.pattern.supporting_evidence,
    { source_id: "HC-INC-99102", trust_label: "Observed", finding: "Two beds were free for 140 minutes.", quote: "no available monitored bed when an EMS", record_values: [] }] });
  const { result } = await run({ answers: (s) => [twice(s), s.pattern, s.analysis, s.options, s.card] });
  assert.equal(result.meta.verification.fixed_on_retry, 1);
  assert.equal(result.meta.verification.findings_removed.length, 0);
});

// ---------- "Learn more" options must be about gathering information (switch, off by default) ----------

const learnOn = { ...SIGNALS_CONFIG, learnMoreCheck: true };
const typed = (s, i, change) => ({ ...s.options, options: s.options.options.map((o, j) => (j === i ? { ...o, ...change } : o)) });

test("the Learn more check is a setting, off by default, with its list of information-gathering words", () => {
  assert.equal(SIGNALS_CONFIG.learnMoreCheck, false);
  for (const w of ["track", "review", "observe", "ask", "huddle", "collect", "measure"]) assert.ok(SIGNALS_CONFIG.learnMoreWords.includes(w), w);
  assert.ok(!SIGNALS_CONFIG.learnMoreWords.includes("monitor"), "ambiguous: left off on purpose");
});

test("Learn more check off: a 'Learn more' option that's really a change is left as it is", async () => {
  const gamed = (s) => typed(s, 1, { type: "Learn more", description: "Implement reserve monitored beds for acute arrivals." });
  const { replay, result } = await run({ answers: (s) => [s.pattern, s.analysis, gamed(s), s.card] });
  assert.equal(replay.calls.length, 4);
  assert.equal(result.steps.options.options[1].type, "Learn more");
});

test("Learn more check on: a genuine one passes (\"Collect data on…\")", async () => {
  const { replay, result } = await run({ config: learnOn });
  assert.equal(replay.calls.length, 4);
  assert.equal(result.meta.verification.learn_more, "ok");
});

test("Learn more check on: a 'Learn more' option that's really a change gets the retry, then is relabelled", async () => {
  const gamed = (s) => typed(s, 1, { type: "Learn more", description: "Implement reserve monitored beds for acute arrivals." });
  const first = await run({ config: learnOn, answers: (s) => [s.pattern, s.analysis, gamed(s), s.options, s.card] });
  assert.match(lastMessage(first.replay, 3), /O2 is typed "Learn more" but its description doesn't gather information/);

  const { result } = await run({ config: learnOn, answers: (s) => [s.pattern, s.analysis, gamed(s), gamed(s), s.card] });
  assert.equal(result.steps.options.options[1].type, "Process adjustment");
  assert.equal(result.meta.verification.learn_more, "relabelled");
  assert.match(logText(result, "options"), /O2: type "Learn more" → "Process adjustment"/);
});

test("Learn more check on: if no genuine Learn more option is left, that's noted, not a failure", async () => {
  const allGamed = (s) => typed(s, 0, { description: "Implement a new escalation process for high occupancy." });
  const { result } = await run({ config: learnOn, answers: (s) => [s.pattern, s.analysis, allGamed(s), allGamed(s), s.card] });
  assert.ok(!result.steps.options.options.some((o) => o.type === "Learn more"));
  assert.match(logText(result, "options"), /no genuine "Learn more" option is left/);
});

test("Learn more check on, recorded energy run: 'Enhance pre-shift coordination' (an 'Implement…' change typed Learn more) is caught", async () => {
  const energyRecords = loadEvalPack("energy", loadAnswerKey()).files.flatMap((f) => parseRecordFile(f.name, f.text));
  const ask = askByStep(fixtureSteps("energy"));
  const result = await runPipeline({ windows: findTriggeredWindows(energyRecords, rules), records: energyRecords, rules,
    evidenceLibrary: loadEvidenceLibrary(), schemas: loadSchemas(), config: learnOn, ask });
  const o2 = result.steps.options.options.find((o) => o.option_id === "O2");
  assert.equal(o2.title, "Enhance pre-shift coordination");
  assert.equal(o2.type, "Process adjustment");
  assert.match(logText(result, "options"), /no genuine "Learn more" option is left/);
});

// ---------- Numbers by reference (switch, off by default) ----------

const refOn = { ...SIGNALS_CONFIG, numbersByReference: true };

test("numbers by reference is a setting, off by default; then no prompt mentions it", async () => {
  assert.equal(SIGNALS_CONFIG.numbersByReference, false);
  const { replay, result } = await run();
  for (const p of replay.prompts) assert.doesNotMatch(p, /NUMBERS BY REFERENCE/);
  assert.equal(result.meta.verification.references, undefined);
});

test("by reference on: Prompts 1, 2 and 4 explain how to write references", async () => {
  const { replay } = await run({ config: refOn });
  const [pattern, analysis, options, card] = replay.prompts;
  for (const p of [pattern, analysis, card]) assert.match(p, /NUMBERS BY REFERENCE[\s\S]*\{SOURCE_ID\.field\}/);
  assert.doesNotMatch(options, /NUMBERS BY REFERENCE/);
});

test("by reference on: references are checked, then filled in with the records' real values", async () => {
  const withRefs = (s) => withEvidence(s.pattern, "HC-FLOW-20260920-1600", {
    finding: "Occupancy reached {HC-FLOW-20260920-1600.bed_occupancy%} and room time {HC-FLOW-20260920-1600.room_to_physician_minutes} minutes at {HC-FLOW-20260920-1600.time}.",
  });
  const { replay, result } = await run({ config: refOn, answers: (s) => [withRefs(s), s.analysis, s.options, s.card] });
  assert.equal(replay.calls.length, 4, "no retry");
  const finding = result.steps.pattern.supporting_evidence.find((e) => e.source_id === "HC-FLOW-20260920-1600").finding;
  assert.equal(finding, "Occupancy reached 96% and room time 90 minutes at 16:00.");
  assert.deepEqual(result.meta.verification.references, { resolved: 3, unresolved: 0 });
});

test("by reference on: a flow figure typed as digits gets the retry, showing how to write it", async () => {
  const typed = (s) => withEvidence(s.pattern, "HC-FLOW-20260920-1600", { finding: "Occupancy reached 96%." });
  const { replay } = await run({ config: refOn, answers: (s) => [typed(s), s.pattern, s.analysis, s.options, s.card] });
  assert.match(lastMessage(replay, 1), /mentions 96[\s\S]*\{HC-FLOW-20260920-1600\.bed_occupancy%\}/);
});

test("by reference on: a reference to a record the claim can't cite gets the retry", async () => {
  const wrongRef = (s) => withCondition(s.analysis, 0, { condition: "Occupancy at {HC-FLOW-20260922-1500.bed_occupancy%}" });
  const { replay } = await run({ config: refOn, answers: (s) => [s.pattern, wrongRef(s), s.analysis, s.options, s.card] });
  assert.match(lastMessage(replay, 2), /HC-FLOW-20260922-1500 isn't a record this can cite/);
});

test("by reference on: the recorded first run (thresholds and incident/complaint figures only) still passes as it is", async () => {
  const { replay, result } = await run({ config: refOn });
  assert.equal(replay.calls.length, 4);
  assert.deepEqual(result.meta.verification.findings_removed, []);
});

// ---------- A safety record listed under "evidence that does not fit" (issue 1, 2026-11-09) ----------
// A record that safetyConditionsIn() matched to a safety-relevant condition, listed as not
// fitting, gets one retry. If the retry doesn't fix it, the answer is accepted as the model
// wrote it and noted (code never moves a record into support). In 2026-11-05-3 run 1 the model
// listed HC-INC-99102 (no monitored bed for a CTAS 2 arrival) as not fitting.

const MONITORED_BED = "No monitored bed for a CTAS 1 or 2 arrival";
/** The pattern with one record taken out of support and an entry added to "does not fit". */
const listedNotFit = (pattern, id, entry = id) => ({
  ...pattern,
  supporting_evidence: pattern.supporting_evidence.filter((e) => e.source_id !== id),
  evidence_that_does_not_fit: [...pattern.evidence_that_does_not_fit, entry],
});
const withNotFit = (pattern, entry) => ({ ...pattern, evidence_that_does_not_fit: [...pattern.evidence_that_does_not_fit, entry] });

test("safety record as not fitting: named in the retry with its condition; fixed on the retry, nothing is noted", async () => {
  const { result, replay } = await run({ answers: (s) => [listedNotFit(s.pattern, "HC-INC-99102"), s.pattern, s.analysis, s.options, s.card] });
  const retry = lastMessage(replay, 1);
  assert.match(retry, /evidence_that_does_not_fit: HC-INC-99102 describes a safety-relevant condition \("No monitored bed for a CTAS 1 or 2 arrival"\)/);
  assert.match(retry, /Cite it under supporting_evidence/);
  assert.ok(cites(result, "HC-INC-99102"));
  assert.deepEqual(result.meta.verification.safety_not_fit, { asked: 1, left: [] });
});

test("safety record as not fitting: still there after the retry, it is accepted as written and noted, and the run carries on", async () => {
  const wrong = (s) => listedNotFit(s.pattern, "HC-INC-99102");
  const { result } = await run({ answers: (s) => [wrong(s), wrong(s), s.analysis, s.options, s.card] });
  assert.deepEqual(result.steps.pattern.evidence_that_does_not_fit, ["HC-INC-99102"], "the entry stays where the model put it");
  assert.ok(!cites(result, "HC-INC-99102"), "code doesn't move the record into support");
  assert.deepEqual(result.meta.verification.safety_not_fit, { asked: 1, left: [{ source_id: "HC-INC-99102", label: MONITORED_BED }] });
  assert.match(logText(result, "pattern"), /HC-INC-99102 describes a safety-relevant condition .* still listed as not fitting after the retry \(accepted as the model wrote it\)/);
  assert.deepEqual(result.meta.verification.findings_removed, []);
  assert.ok(result.steps.card, "the later steps still ran");
});

test("safety record as not fitting: an entry with no record id is matched on its wording", async () => {
  const wrong = (s) => listedNotFit(s.pattern, "HC-INC-99102", "A CTAS 2 patient arrived, but there was no monitored bed available.");
  const { result, replay } = await run({ answers: (s) => [wrong(s), s.pattern, s.analysis, s.options, s.card] });
  assert.match(lastMessage(replay, 1), /evidence_that_does_not_fit: "A CTAS 2 patient arrived, but there was no monitored bed available\." describes a safety-relevant condition \("No monitored bed for a CTAS 1 or 2 arrival"\), which HC-INC-99102 records/);
  assert.deepEqual(result.meta.verification.safety_not_fit, { asked: 1, left: [] });
});

test("safety record as not fitting: number-based conditions count too (a flow row with a wait over 60 minutes)", async () => {
  const { replay } = await run({ answers: (s) => [withNotFit(s.pattern, "HC-FLOW-20260920-1600: seems unrelated"), s.pattern, s.analysis, s.options, s.card] });
  assert.match(lastMessage(replay, 1), /evidence_that_does_not_fit: HC-FLOW-20260920-1600 describes a safety-relevant condition \("Waits after rooming over 60 minutes"\)/);
});

test("safety record as not fitting: records that describe no safety condition can be listed freely", async () => {
  const pattern = (s) => ({ ...s.pattern, evidence_that_does_not_fit: ["HC-CMP-4475", "HC-CMP-4480: the parking machine", "HC-INC-99110"] });
  const { result, replay } = await run({ answers: (s) => [pattern(s), s.analysis, s.options, s.card] });
  assert.equal(replay.calls.length, 4, "no retry");
  assert.deepEqual(result.meta.verification.safety_not_fit, { asked: 0, left: [] });
});

test("safety record as not fitting: an entry that names another record is judged by that record, not its wording (the good catch)", async () => {
  // Rightly listed as not fitting, with a reason that happens to use the condition's words.
  const entry = "EN-INC-20260920-06: work was not started before zero-energy verification on Line A.";
  const { result, replay } = await runEnergy((s) => [withNotFit(s.pattern, entry)]);
  assert.equal(replay.calls.length, 5, "no pattern retry");
  assert.deepEqual(result.meta.verification.safety_not_fit, { asked: 0, left: [] });
});

test("safety record as not fitting (known limit): with no record id, a negative entry is matched on its words too", async () => {
  // Same limit as the finding check: words, not meaning. Entries have begun with an id since 2b7fbdf.
  const entry = "A crew waited and work was not started before zero-energy verification.";
  const { replay } = await runEnergy((s) => [withNotFit(s.pattern, entry), s.pattern]);
  assert.match(lastMessage(replay, 1), /describes a safety-relevant condition \("Work started before zero-energy verification"\), which EN-NM-20260920-01 records/);
});

// ---------- The safety condition's label as the finding (2026-11-09) ----------

test("a finding worded with the safety condition's own label is kept, with no retry (HC-INC-99102)", async () => {
  const labelled = (s) => withEvidence(s.pattern, "HC-INC-99102", { finding: "No monitored bed for a CTAS 1 or 2 arrival" });
  const { result, replay } = await run({ answers: (s) => [labelled(s), s.analysis, s.options, s.card] });
  assert.equal(replay.calls.length, 4, "no retry");
  assert.ok(cites(result, "HC-INC-99102"));
  assert.deepEqual(result.meta.verification.findings_removed, []);
});

test("listed as not fitting, then moved into support with the label on the retry: kept (the 2026-11-09 failure)", async () => {
  const moved = (s) => withEvidence(s.pattern, "HC-INC-99102", { finding: "no monitored bed for a CTAS 1 or 2 arrival" });
  const { result } = await run({ answers: (s) => [listedNotFit(s.pattern, "HC-INC-99102"), moved(s), s.analysis, s.options, s.card] });
  assert.ok(cites(result, "HC-INC-99102"));
  assert.deepEqual(result.meta.verification.findings_removed, []);
  assert.deepEqual(result.meta.verification.safety_not_fit, { asked: 1, left: [] });
});

test("the pattern statement may quote the label too, and isn't replaced", async () => {
  const statement = "Records suggest long waits after rooming and no monitored bed for a CTAS 1 or 2 arrival.";
  const { result, replay } = await run({ answers: (s) => [{ ...s.pattern, pattern_statement: statement }, s.analysis, s.options, s.card] });
  assert.equal(replay.calls.length, 4, "no retry");
  assert.equal(result.steps.pattern.pattern_statement, statement);
});
