// Shared helpers for the tests. Nothing here talks to Ollama or the app's data folder.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Read a JSON file, path relative to the project root. */
export const readJson = (relPath) => JSON.parse(readFileSync(join(ROOT, relPath), "utf8"));

export const clone = (x) => structuredClone(x);

/**
 * The four steps' JSON from a run recorded on 2026-09-28, with the step 2 fields added
 * (a quote or record values per finding, and the policy quote): tests/fixtures/step2/.
 * The original recordings in docs/test-results/2026-09-28/ are left unchanged.
 * @param {"rooming" | "energy"} name
 */
export function fixtureSteps(name, run = 0) {
  return clone(readJson(`tests/fixtures/step2/${name}-steps.json`).runs[run]);
}

// The schemas are loaded the same way the scorecard loads them.
export { loadSchemas } from "../scripts/eval/packs.js";

/**
 * A stand-in for the model that gives prepared answers in order.
 * Objects are sent as JSON; strings are sent as they are; an Error is thrown.
 * `calls` keeps every conversation it was sent; `prompts` the system prompt of each.
 */
export function replayAsk(answers) {
  const calls = [];
  let i = 0;
  return {
    calls,
    get prompts() { return calls.map((m) => m[0].content); },
    async ask(messages) {
      calls.push(clone(messages));
      if (i >= answers.length) throw new Error(`replayAsk ran out of answers after ${answers.length}`);
      const next = answers[i++];
      if (next instanceof Error) throw next;
      return typeof next === "string" ? next : JSON.stringify(next);
    },
  };
}

/**
 * A stand-in for the model that answers by step (it reads which prompt it was sent), and gives
 * the same answer again on a retry, like a model that doesn't fix its mistake. For runs on
 * records the answers weren't written for, where the checks rightly ask for retries.
 * @param {{pattern, analysis, options, card}} steps
 */
export function askByStep(steps) {
  const markers = [["PATTERN AND VIGNETTE", "pattern"], ["SYSTEM ANALYSIS", "analysis"], ["OPTIONS AND RECOMMENDATION", "options"], ["REVIEW CARD", "card"]];
  const calls = []; // which step each call was for, in order (e.g. ["pattern", "pattern", "analysis", …])
  const ask = async (messages) => {
    const step = markers.find(([m]) => messages[0].content.includes(`SYSTEM PROMPT: ${m}`))[1];
    calls.push(step);
    return JSON.stringify(steps[step]);
  };
  ask.calls = calls;
  return ask;
}
