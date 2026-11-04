// evaluate.js — the Signals scorecard.
//
//   npm run eval                          both packs, 3 runs each, the model in src/config.js
//   npm run eval -- --pack healthcare     one pack (healthcare | energy | all)
//   npm run eval -- --runs 1              a quick check
//   npm run eval -- --model qwen3:8b      try another Ollama model
//
// Each run uses the app's real "Check now" logic (src/monitor.js) and real prompts, against
// local Ollama, on the evaluation packs in data/eval/. The healthcare pack is followed by the
// second flow file, to check that it updates the same Thread. Each run starts from an empty,
// in-memory data folder: nothing touches the app's own data.
//
// Results go to docs/eval/<date>/: scorecard.md (read this), settings.json, and runs/ with
// every run's full output.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { checkForSignals } from "../src/monitor.js";
import { SIGNALS_CONFIG } from "../src/config.js";
import { ROOT, loadAnswerKey, loadEvalPack, loadRules, loadEvidenceLibrary, loadSchemas } from "./eval/packs.js";
import { memoryIo } from "./eval/memoryIo.js";
import { scoreRun, consistency } from "./eval/score.js";
import { renderScorecard } from "./eval/report.js";

export const OLLAMA_MESSAGE = "Couldn't reach Ollama. Is it running? (Try opening the Ollama app.)";
const STAGES = { healthcare: ["healthcare", "healthcare_update"], energy: ["energy"] };

async function defaultCheckOllama() {
  const res = await fetch("http://localhost:11434/api/tags");
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
}

function currentCommit() {
  try { return execSync("git rev-parse --short HEAD", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); }
  catch { return "unknown"; }
}

// docs/eval/<date>, or <date>-2, <date>-3… so an earlier scorecard is never overwritten.
function freshFolder(baseDir, date) {
  let dir = join(baseDir, date);
  for (let n = 2; existsSync(dir); n++) dir = join(baseDir, `${date}-${n}`);
  return dir;
}

const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Run the evaluation and write the scorecard.
 * @param {object} args
 * @param {string[]} [args.packs]   "healthcare", "energy" and/or "all"
 * @param {number} [args.runs]
 * @param {string} [args.model]     Ollama model id (default: SIGNALS_CONFIG.model)
 * @param {Function} [args.ask]     Stand-in for the model (tests); default is the real model
 * @param {string} [args.outDir]    Exact folder to write to (tests). Default: a new folder in baseDir
 * @param {string} [args.baseDir]   Default docs/eval. Results go to <date>/, or <date>-2/, -3/… if that exists
 * @param {Date} [args.now]
 * @param {Function} [args.checkOllama]
 * @param {string} [args.gitCommit]
 * @param {(message: string) => void} [args.onProgress]
 * @returns {Promise<{ summary: object, scorecardPath: string }>}
 */
export async function runEvaluation({
  packs = ["all"], runs = 3, model, ask, outDir, baseDir = join(ROOT, "docs/eval"), now = new Date(),
  checkOllama = defaultCheckOllama, gitCommit = currentCommit(), onProgress = () => {},
} = {}) {
  try { await checkOllama(); } catch { throw new Error(OLLAMA_MESSAGE); }

  const answerKey = loadAnswerKey();
  const base = { rules: loadRules(), schemas: loadSchemas(), evidenceLibrary: loadEvidenceLibrary() };
  const config = { ...SIGNALS_CONFIG, model: model ?? SIGNALS_CONFIG.model };
  const packNames = packs.includes("all") ? Object.keys(STAGES) : packs;
  for (const p of packNames) if (!STAGES[p]) throw new Error(`Unknown pack "${p}". Use healthcare, energy or all.`);
  const date = localDate(now);
  const dir = outDir ?? freshFolder(baseDir, date);
  mkdirSync(join(dir, "runs"), { recursive: true });

  const stages = {};
  for (const pack of packNames) {
    for (let n = 1; n <= runs; n++) {
      const mem = memoryIo();
      const record = { pack, run: n, stages: [] };
      let earlierFailed = false;
      for (const stage of STAGES[pack]) {
        let error;
        const started = Date.now();
        if (earlierFailed) {
          error = "Skipped because the earlier stage of this run failed.";
        } else {
          onProgress(`${pack}, run ${n} of ${runs}: ${stage}`);
          mem.put(loadEvalPack(stage, answerKey).files);
          try {
            const summary = await checkForSignals({ ...base, config, io: mem.io, ask,
              onProgress: (m) => onProgress(`  ${m}`) });
            if (summary.errors.length) error = summary.errors.join("; ");
          } catch (err) {
            error = err.message;
          }
        }
        const scored = scoreRun({ packKey: stage, answerKey, threads: mem.threads(), error, seconds: (Date.now() - started) / 1000 });
        if (error) earlierFailed = true;
        (stages[stage] ??= { scored: [] }).scored.push(scored);
        record.stages.push(scored);
      }
      record.threads = mem.threads();
      writeFileSync(join(dir, "runs", `${pack}-${n}.json`), JSON.stringify(record, null, 2));
    }
  }
  for (const s of Object.values(stages)) s.consistency = consistency(s.scored);

  const summary = {
    date, model: config.model, temperatures: config.temperatures, runs, gitCommit,
    answerKeyStatus: answerKey.status ?? "unknown", stages,
  };
  const scorecardPath = join(dir, "scorecard.md");
  writeFileSync(scorecardPath, renderScorecard(summary));
  writeFileSync(join(dir, "settings.json"), JSON.stringify({
    date, model: config.model, temperatures: config.temperatures, runs, packs: packNames,
    git_commit: gitCommit, answer_key_status: summary.answerKeyStatus,
  }, null, 2));
  return { summary, scorecardPath };
}

// ---- Command line ----
function parseArgs(argv) {
  const args = { packs: ["all"], runs: 3 };
  for (let i = 0; i < argv.length; i++) {
    const [flag, value] = [argv[i], argv[i + 1]];
    if (flag === "--pack") { args.packs = [value]; i++; }
    else if (flag === "--runs") { args.runs = Number(value); i++; }
    else if (flag === "--model") { args.model = value; i++; }
    else throw new Error(`Unknown option "${flag}". Options: --pack healthcare|energy|all, --runs <n>, --model <id>`);
  }
  if (!Number.isInteger(args.runs) || args.runs < 1) throw new Error("--runs needs a whole number of 1 or more.");
  return args;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseArgs(process.argv.slice(2));
    console.log(`Threadline scorecard: ${args.runs} run(s) per pack. With Command R this takes about 7 minutes per pack run.`);
    const { scorecardPath } = await runEvaluation({ ...args, onProgress: (m) => console.log(m) });
    console.log(`\nDone. Read the scorecard: ${scorecardPath}`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
