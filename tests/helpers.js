// Shared helpers for the tests. Nothing here talks to Ollama or the app's data folder.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Read a JSON file, path relative to the project root. */
export const readJson = (relPath) => JSON.parse(readFileSync(join(ROOT, relPath), "utf8"));

export const clone = (x) => structuredClone(x);

/** The four steps' JSON from a run recorded on 2026-09-28 (docs/test-results). */
export function recordedSteps(name, run = 0) {
  const { pattern, analysis, options, card } = readJson(`docs/test-results/2026-09-28/${name}-thread.json`).runs[run].steps;
  return clone({ pattern, analysis, options, card });
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
