// Tests for scripts/eval/packs.js: loading evaluation packs (benchmarks + decoys).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseRecordFile } from "../src/records.js";
import { loadAnswerKey, loadEvalPack } from "../scripts/eval/packs.js";
import { ROOT } from "./helpers.js";

const key = loadAnswerKey();
const recordsOf = (pack) => pack.files.flatMap((f) => parseRecordFile(f.name, f.text));

test("healthcare pack is 5 files holding 13 records, including all 5 decoys", () => {
  const pack = loadEvalPack("healthcare", key);
  assert.equal(pack.files.length, 5);
  const ids = recordsOf(pack).map((r) => r.source_id);
  assert.equal(ids.length, 13);
  for (const id of ["HC-CMP-4480", "HC-INC-99110", "HC-CMP-4475", "HC-CMP-4462", "HC-CMP-5102"]) assert.ok(ids.includes(id), id);
});

test("eval_role never reaches the record files the app would read", () => {
  for (const name of ["healthcare", "energy", "healthcare_update"]) {
    for (const f of loadEvalPack(name, key).files) assert.ok(!f.text.includes("eval_role"), f.name);
  }
});

test("each decoy's role is kept for the scorer", () => {
  const roles = loadEvalPack("healthcare", key).roles;
  assert.equal(roles.get("HC-CMP-4480"), "possible_confounder");
  assert.equal(roles.get("HC-INC-99110"), "decoy_unrelated");
  assert.equal(loadEvalPack("energy", key).roles.get("EN-INC-20260920-06"), "counter_evidence");
});

test("loading packs leaves the benchmark files untouched", () => {
  const dir = join(ROOT, "data/benchmarks/healthcare");
  const snapshot = () => readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  const before = snapshot();
  loadEvalPack("healthcare", key);
  assert.equal(snapshot(), before);
});

test("an unknown pack name is refused", () => {
  assert.throws(() => loadEvalPack("aviation", key), /no evaluation pack "aviation"/i);
});
