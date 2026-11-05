// Trigger windows, nearby records, policies and safety conditions on the evaluation packs,
// checked against data/eval/answer-key.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecordFile, findTriggeredWindows, qualitativeNear, policiesFor, safetyConditionsIn } from "../src/records.js";
import { runPipeline } from "../src/pipeline.js";
import { loadAnswerKey, loadEvalPack, loadRules, loadEvidenceLibrary, loadSchemas } from "../scripts/eval/packs.js";
import { fixtureSteps, replayAsk } from "./helpers.js";
import { SIGNALS_CONFIG } from "../src/config.js";

const key = loadAnswerKey();
const rules = loadRules();
const recordsOf = (name) => loadEvalPack(name, key).files.flatMap((f) => parseRecordFile(f.name, f.text));

for (const name of ["healthcare", "energy", "healthcare_update"]) {
  const expected = key.packs[name];
  const records = recordsOf(name);
  const windows = findTriggeredWindows(records, rules);

  test(`${name}: trigger windows match the answer key`, () => {
    assert.deepEqual(
      windows.map(({ pattern_type, location, start, end }) => ({ pattern_type, location, start, end })),
      expected.expected_windows,
    );
  });

  if (expected.code_must_exclude_from_inputs) {
    test(`${name}: records outside the window or at another site are kept from the model`, () => {
      const near = qualitativeNear(windows[0], records).map((r) => r.source_id);
      for (const id of Object.keys(expected.code_must_exclude_from_inputs)) assert.ok(!near.includes(id), id);
    });

    test(`${name}: in-window decoys do reach the model`, () => {
      const near = qualitativeNear(windows[0], records).map((r) => r.source_id);
      const roles = loadEvalPack(name, key).roles;
      const inWindow = [...roles].filter(([, role]) => !role.startsWith("excluded")).map(([id]) => id);
      for (const id of inWindow) assert.ok(near.includes(id), id);
    });

    test(`${name}: the expected policy is found`, () => {
      const policies = policiesFor(windows[0].domain, windows[0].location, records).map((r) => r.source_id);
      assert.deepEqual(policies, [expected.hard.analysis_policy_source_id]);
    });

    test(`${name}: the expected safety conditions are found`, () => {
      const inputs = [...windows[0].flowRecords, ...qualitativeNear(windows[0], records)];
      const ids = safetyConditionsIn(inputs, rules[windows[0].domain]).map((c) => c.id);
      assert.deepEqual(ids.sort(), [...expected.hard.expected_safety_conditions].sort());
    });
  }
}

test("no prompt in a full healthcare run contains eval_role", async () => {
  const records = recordsOf("healthcare");
  const windows = findTriggeredWindows(records, rules);
  const s = fixtureSteps("rooming");
  const replay = replayAsk([s.pattern, s.analysis, s.options, s.card]);
  await runPipeline({ windows, records, rules, evidenceLibrary: loadEvidenceLibrary(), schemas: loadSchemas(), config: SIGNALS_CONFIG, ask: replay.ask });
  assert.equal(replay.prompts.length, 4);
  for (const p of replay.prompts) assert.ok(!p.includes("eval_role"));
});

test("rows of numbers from a new domain count as flow records; text records and policies don't", async () => {
  const { isFlow } = await import("../src/records.js");
  assert.equal(isFlow({ source_type: "turnaround_log", turnaround_minutes: 62 }), true);
  assert.equal(isFlow({ source_type: "emr_flow", bed_occupancy: 0.9 }), true);
  assert.equal(isFlow({ source_type: "near_miss", text: "Crew began work before sign-off." }), false);
  assert.equal(isFlow({ source_type: "policy", text: "No work may begin…" }), false);
  assert.equal(isFlow({ source_type: "shift_note", text: "Busy afternoon." }), false, "a record with text isn't a row of numbers");
});
