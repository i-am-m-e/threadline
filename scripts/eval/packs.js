// packs.js — loading the evaluation packs, answer key, rules, evidence and schemas from disk.
//
// An evaluation pack is a set of record files (the benchmark files plus extra decoy
// records), listed in data/eval/answer-key.json. Decoy records carry an "eval_role"
// (decoy_unrelated, possible_confounder, counter_evidence, excluded_…) so the scorer knows
// what they're for. That field is removed here, before the files are handed to the app's
// code, so the model never sees it.
//
// Read-only: nothing here writes to disk.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const readJson = (relPath) => JSON.parse(readFileSync(join(ROOT, relPath), "utf8"));

export const loadAnswerKey = () => readJson("data/eval/answer-key.json");
export const loadRules = () => readJson("data/domain_rules.json");

/** Every item in data/evidence/. */
export function loadEvidenceLibrary() {
  const dir = join(ROOT, "data/evidence");
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

/** The JSON Schemas for the four Signals steps. */
export function loadSchemas() {
  const read = (name) => readJson(`src/schemas/${name}.schema.json`);
  return { pattern: read("pattern"), analysis: read("analysis"), options: read("options"), reviewCard: read("reviewCard") };
}

// "dir/*" means every file in dir; anything else is one file.
function expand(pattern) {
  if (!pattern.endsWith("/*")) return [pattern];
  const dir = pattern.slice(0, -2);
  return readdirSync(join(ROOT, dir)).filter((f) => !f.startsWith(".")).sort().map((f) => `${dir}/${f}`);
}

/**
 * The record files for one evaluation pack.
 * @param {"healthcare" | "healthcare_update" | "energy"} name
 * @param {object} answerKey  From loadAnswerKey().
 * @returns {{ files: Array<{name: string, text: string}>, roles: Map<string, string> }}
 */
export function loadEvalPack(name, answerKey) {
  const pack = answerKey.packs[name];
  if (!pack) throw new Error(`There's no evaluation pack "${name}".`);
  const roles = new Map();
  const files = pack.files.flatMap(expand).map((path) => {
    let text = readFileSync(join(ROOT, path), "utf8");
    if (path.endsWith(".json")) {
      const data = JSON.parse(text);
      const list = Array.isArray(data) ? data : [data];
      if (list.some((r) => "eval_role" in r)) {
        const cleaned = list.map(({ eval_role, ...record }) => {
          if (eval_role) roles.set(record.source_id, eval_role);
          return record;
        });
        text = JSON.stringify(Array.isArray(data) ? cleaned : cleaned[0], null, 2);
      }
    }
    return { name: basename(path), text };
  });
  return { files, roles };
}
