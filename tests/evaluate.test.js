// The scorecard runner, with a stand-in model and a temporary output folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvaluation, OLLAMA_MESSAGE } from "../scripts/evaluate.js";
import { recordedSteps, replayAsk } from "./helpers.js";

const four = (run) => {
  const s = recordedSteps("rooming", run);
  return [s.pattern, s.analysis, s.options, s.card];
};
const healthcareRun = () => [...four(0), ...four(1)]; // the pack, then the update file
const outDir = () => mkdtempSync(join(tmpdir(), "threadline-eval-"));
const options = (ask, dir) => ({ packs: ["healthcare"], runs: 2, ask, outDir: dir, checkOllama: async () => {}, now: new Date("2026-11-04T12:00:00"), gitCommit: "abc1234" });

test("writes the scorecard, settings and one file per run", async () => {
  const dir = outDir();
  const replay = replayAsk([...healthcareRun(), ...healthcareRun()]);
  await runEvaluation(options(replay.ask, dir));
  for (const f of ["scorecard.md", "settings.json", "runs/healthcare-1.json", "runs/healthcare-2.json"]) assert.ok(existsSync(join(dir, f)), f);
  const card = readFileSync(join(dir, "scorecard.md"), "utf8");
  assert.match(card, /Answer key: draft/);
  assert.match(card, /not checked yet \(step 2\)/);
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
