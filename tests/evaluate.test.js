// The scorecard runner, with a stand-in model and a temporary output folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvaluation, OLLAMA_MESSAGE } from "../scripts/evaluate.js";
import { fixtureSteps, replayAsk } from "./helpers.js";

const four = (run) => {
  const s = fixtureSteps("rooming", run);
  return [s.pattern, s.analysis, s.options, s.card];
};
// The recorded update run cites only Sept 20 (window retry) and its rationale has 3 sentences
// (options retry), so the update stage takes six answers.
const update = () => {
  const s = fixtureSteps("rooming", 1);
  return [s.pattern, s.pattern, s.analysis, s.options, s.options, s.card];
};
const healthcareRun = () => [...four(0), ...update()]; // the pack, then the update file
const outDir = () => mkdtempSync(join(tmpdir(), "threadline-eval-"));
const options = (ask, dir) => ({ packs: ["healthcare"], runs: 2, ask, outDir: dir, checkOllama: async () => {}, now: new Date("2026-11-04T12:00:00"), gitCommit: "abc1234" });

test("writes the scorecard, settings and one file per run", async () => {
  const dir = outDir();
  const replay = replayAsk([...healthcareRun(), ...healthcareRun()]);
  await runEvaluation(options(replay.ask, dir));
  for (const f of ["scorecard.md", "settings.json", "runs/healthcare-1.json", "runs/healthcare-2.json"]) assert.ok(existsSync(join(dir, f)), f);
  const card = readFileSync(join(dir, "scorecard.md"), "utf8");
  assert.match(card, /Answer key: draft/);
  assert.match(card, /\| Findings checked against their source \| 12 of 12 verified \(0 removed as unverified; 0 fixed or dropped on retry\) \|/);
  assert.match(card, /\| Policy quote verified \| 2 of 2 runs \|/);
  assert.match(card, /\| Analysis claims checked against their records \| 8 of 8 verified \(0 removed as unverified; 0 trust labels corrected\) \|/);
  assert.match(card, /\| Map nodes checked against their records \| 18 of 18 verified \(0 removed as unverified; 4 trust labels corrected\) \|/);
  assert.match(card, /\| Review card wording verified \| 2 of 2 runs \|/);
  assert.match(card, /\| Other wording checked for numbers \| 14 of 14 verified \(0 replaced, 0 removed\) \|/);
  assert.match(card, /## Healthcare pack[\s\S]*\| Time windows with a cited record \| 2 of 2 \|/);
  assert.match(card, /## Healthcare update[\s\S]*\| Time windows with a cited record \| 2 of 4 \(uncited: 2026-09-22 14:00 to 16:00 in runs 1, 2\) \|/);
  assert.match(card, /## Healthcare update[\s\S]*\| Recommendation rationale shortened to two sentences \| 2 of 2 runs \|/);
  assert.match(card, /abc1234/);
  const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
  assert.equal(settings.answer_key_status, "draft");
  assert.equal(settings.runs, 2);
});

test("a run that fails is listed as failed and the next run still happens", async () => {
  const dir = outDir();
  const replay = replayAsk([new Error("model stalled"), ...healthcareRun()]);
  const { summary } = await runEvaluation(options(replay.ask, dir));
  const scored = summary.stages.healthcare.scored;
  assert.equal(scored.length, 2);
  assert.equal(scored[0].passed, false);
  assert.match(scored[0].error, /model stalled/);
  assert.ok(scored[1].confidence, "run 2 was scored");
  assert.match(readFileSync(join(dir, "scorecard.md"), "utf8"), /Run 1: no_step_errors: .*model stalled/);
});

test("stops before any run when Ollama can't be reached", async () => {
  const dir = outDir();
  const replay = replayAsk([]);
  await assert.rejects(
    runEvaluation({ ...options(replay.ask, dir), checkOllama: async () => { throw new Error("connect ECONNREFUSED"); } }),
    (err) => err.message === OLLAMA_MESSAGE,
  );
  assert.equal(replay.calls.length, 0);
  assert.deepEqual(readdirSync(dir), []);
});

test("a second scorecard on the same day gets its own folder instead of overwriting the first", async () => {
  const baseDir = outDir();
  const run = (ask) => runEvaluation({ ...options(ask, undefined), runs: 1, baseDir });
  const first = await run(replayAsk(healthcareRun()).ask);
  const second = await run(replayAsk(healthcareRun()).ask);
  assert.match(first.scorecardPath, /2026-11-04\/scorecard\.md$/);
  assert.match(second.scorecardPath, /2026-11-04-2\/scorecard\.md$/);
});

test("findings removed as unverified are counted and listed on the scorecard", async () => {
  const dir = outDir();
  const [pattern, ...rest] = four(0);
  const bad = { ...pattern, supporting_evidence: pattern.supporting_evidence.map((e) =>
    (e.source_id === "HC-CMP-4471" ? { ...e, quote: "waited two hours in the exam room" } : e)) };
  const replay = replayAsk([bad, bad, ...rest, ...update()]);
  await runEvaluation({ ...options(replay.ask, dir), runs: 1 });
  const card = readFileSync(join(dir, "scorecard.md"), "utf8");
  assert.match(card, /\| Findings checked against their source \| 5 of 6 verified \(1 removed as unverified; 0 fixed or dropped on retry\) \|/);
  assert.match(card, /\*\*Removed or replaced as unverified\*\*\n- Run 1: HC-CMP-4471: .*isn't in that record/);
});

test("run numbers for uncited windows count failed runs too", async () => {
  const dir = outDir();
  // Run 1 fails at its first step (so its update stage is skipped); run 2 completes.
  const replay = replayAsk([new Error("model stalled"), ...healthcareRun()]);
  await runEvaluation(options(replay.ask, dir));
  const card = readFileSync(join(dir, "scorecard.md"), "utf8");
  assert.match(card, /## Healthcare update[\s\S]*\| Time windows with a cited record \| 1 of 2 \(uncited: 2026-09-22 14:00 to 16:00 in run 2\) \|/);
});

test("the scorecard can be run with numbers by reference, and says so", async () => {
  const dir = outDir();
  await runEvaluation({ ...options(replayAsk(healthcareRun()).ask, dir), runs: 1, byReference: true });
  const card = readFileSync(join(dir, "scorecard.md"), "utf8");
  assert.match(card, /- Numbers by reference: on/);
  assert.match(card, /\| References filled in \| \d+ \(0 not found\) \|/);
  assert.equal(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).numbers_by_reference, true);
});

test("without the option the scorecard says numbers by reference is off", async () => {
  const dir = outDir();
  await runEvaluation({ ...options(replayAsk(healthcareRun()).ask, dir), runs: 1 });
  const card = readFileSync(join(dir, "scorecard.md"), "utf8");
  assert.match(card, /- Numbers by reference: off/);
  assert.doesNotMatch(card, /References filled in/);
});
