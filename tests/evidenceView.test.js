// What the manager brief shows about checked evidence (goal D, visible reasoning).
// The screen itself is drawn in signals-ui.js; these are the words it shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { evidenceLines, verificationSummary, removedLines, policyWording } from "../src/evidenceView.js";
import { fixtureSteps, readJson } from "./helpers.js";

const okVerification = {
  findings_checked: 6, findings_verified: 6, findings_removed: [], fixed_on_retry: 0, policy_quote: "verified",
  analysis: { claims_checked: 4, claims_verified: 4, claims_removed: [], labels_corrected: 0 },
};

test("each finding shows its quote, in quotation marks, with the record it came from", () => {
  const lines = evidenceLines(fixtureSteps("rooming").pattern);
  const complaint = lines.find((l) => l.source_id === "HC-CMP-4471");
  assert.equal(complaint.proof, "“waiting 85 minutes after being placed in an exam room before seeing a physician”");
  assert.equal(complaint.finding, "Patient waited 85 minutes after rooming before seeing a physician.");
});

test("a flow finding shows the field values it relies on, as in the record", () => {
  const flow = evidenceLines(fixtureSteps("rooming").pattern).find((l) => l.source_id === "HC-FLOW-20260920-1600");
  assert.equal(flow.proof, "Bed occupancy: 0.96 · Room to physician minutes: 90");
});

test("a finding recorded before step 2 shows no proof (rather than inventing one)", () => {
  const old = readJson("docs/test-results/2026-09-28/rooming-thread.json").runs[0].steps.pattern;
  assert.ok(evidenceLines(old).every((l) => l.proof === null));
});

test("the summary says what was checked", () => {
  assert.equal(verificationSummary(okVerification),
    "Checked against their records: 6 of 6 findings and 4 of 4 analysis claims verified; policy wording verified.");
});

test("the summary mentions removals, retries and corrected labels", () => {
  const v = { ...okVerification, findings_verified: 5, findings_removed: [{ source_id: "HC-CMP-4471", problem: "x" }], fixed_on_retry: 1, policy_quote: "removed",
    analysis: { claims_checked: 4, claims_verified: 3, claims_removed: [{ list: "pressure_map", text: "y", problem: "z" }], labels_corrected: 2 } };
  assert.equal(verificationSummary(v),
    "Checked against their records: 5 of 6 findings and 3 of 4 analysis claims verified; 2 removed as unverified; 1 fixed or dropped on retry; 2 trust labels corrected; policy wording couldn't be verified and was removed.");
});

test("a run from before the checks says so", () => {
  assert.equal(verificationSummary(undefined), "Recorded before findings were checked against their records.");
});

test("removed items are listed with the reason", () => {
  const v = { ...okVerification, findings_removed: [{ source_id: "HC-CMP-4471", finding: "Waited 95 minutes.", problem: "HC-CMP-4471: the finding mentions 95, which isn't in that record." }],
    analysis: { ...okVerification.analysis, claims_removed: [{ list: "pressure_map", text: "Escalating 12 times an hour", problem: "pressure_map: \"Escalating 12 times an hour\" mentions 12, which isn't in the records it cites (HC-POL-CTAS-ESC)." }] } };
  assert.deepEqual(removedLines(v), [
    "Finding “Waited 95 minutes.” (HC-CMP-4471): the finding mentions 95, which isn't in that record.",
    "Pressure map “Escalating 12 times an hour”: mentions 12, which isn't in the records it cites (HC-POL-CTAS-ESC).",
  ]);
  assert.deepEqual(removedLines(undefined), []);
});

test("the policy gap shows the policy's own words when there are some", () => {
  assert.equal(policyWording(fixtureSteps("rooming").analysis.policy_practice_gap),
    "Policy wording (HC-POL-CTAS-ESC): “require immediate access to a monitored bed on arrival”");
  assert.equal(policyWording({ policy_source_id: "", policy_quote: "" }), null);
});

test("the summary also covers the map's nodes and the review card", () => {
  const v = { ...okVerification, map: { nodes_checked: 9, nodes_verified: 8, nodes_removed: [{ id: "n7", text: "Patient waited 140 minutes", problem: 'graph.nodes: "Patient waited 140 minutes" mentions 140, which isn\'t in the records it cites (HC-CMP-4471).' }], labels_corrected: 2 }, card: "replaced" };
  assert.equal(verificationSummary(v),
    "Checked against their records: 6 of 6 findings, 4 of 4 analysis claims and 8 of 9 map nodes verified; 1 removed as unverified; 2 trust labels corrected; policy wording verified; review card wording replaced (it mentioned figures not in the records).");
  assert.deepEqual(removedLines(v), ["Map node \u201cPatient waited 140 minutes\u201d: mentions 140, which isn't in the records it cites (HC-CMP-4471)."]);
  assert.match(verificationSummary({ ...v, card: "verified" }), /review card wording verified\.$/);
});

// ---------- The policy-practice box: labels only where the records back them ----------
import { gapLabels } from "../src/evidenceView.js";

test("policy box: Authoritative and Observed when a policy is cited and findings were verified", () => {
  assert.deepEqual(gapLabels({ policy_source_id: "HC-POL-CTAS-ESC" }, okVerification), { expects: "Authoritative", suggests: "Observed", note: null });
});

test("policy box: no policy cited → Inferred, with a note saying so", () => {
  assert.deepEqual(gapLabels({ policy_source_id: "" }, okVerification),
    { expects: "Inferred", suggests: "Observed", note: "No policy was cited for this, so what the policy expects is unconfirmed." });
});

test("policy box: no verified findings → what the records suggest is Inferred", () => {
  const none = { ...okVerification, findings_checked: 0, findings_verified: 0 };
  assert.equal(gapLabels({ policy_source_id: "HC-POL-CTAS-ESC" }, none).suggests, "Inferred");
});

test("policy box: a run from before the checks keeps its labels", () => {
  assert.deepEqual(gapLabels({ policy_source_id: "HC-POL-CTAS-ESC" }, undefined), { expects: "Authoritative", suggests: "Observed", note: null });
});

test("the summary and the removed list also cover the rest of the wording", () => {
  const v = { ...okVerification, wording: {
    checked: 7,
    replaced: [{ field: "pattern_statement", text: "Records suggest waits of 140 minutes.", problem: 'pattern_statement: "Records suggest waits of 140 minutes." mentions 140, which isn\'t in the records it cites (HC-CMP-4471).' }],
    removed: [{ list: "compounding_factors", text: "Delays of 140 minutes", problem: 'compounding_factors: "Delays of 140 minutes" mentions 140, which isn\'t in the records it cites (HC-CMP-4471).' }],
  } };
  assert.equal(verificationSummary(v),
    "Checked against their records: 6 of 6 findings, 4 of 4 analysis claims and 5 of 7 other passages verified; 1 removed as unverified; 1 passage's wording replaced; policy wording verified.");
  assert.deepEqual(removedLines(v), [
    "Where small variations combine \u201cDelays of 140 minutes\u201d: mentions 140, which isn't in the records it cites (HC-CMP-4471).",
    "Pattern statement (wording replaced) \u201cRecords suggest waits of 140 minutes.\u201d: mentions 140, which isn't in the records it cites (HC-CMP-4471).",
  ]);
});

test("the summary notes a time window with no cited record, and a shortened rationale", () => {
  const v = { ...okVerification, windows: { total: 2, cited: 1, uncited: ["2026-09-22 14:00 to 16:00"] }, rationale: "shortened" };
  assert.match(verificationSummary(v), /; 1 of 2 time windows has no cited record \(2026-09-22 14:00 to 16:00\); recommendation shortened to two sentences\.$/);
  assert.doesNotMatch(verificationSummary({ ...okVerification, windows: { total: 1, cited: 1, uncited: [] }, rationale: "ok" }), /time window|shortened/);
});

test("trust labels corrected on findings count in the summary too", () => {
  assert.match(verificationSummary({ ...okVerification, findings_labels_corrected: 1 }), /; 1 trust label corrected;/);
});

test("many uncited time windows are shortened in the summary", () => {
  const uncited = Array.from({ length: 12 }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")} 15:00 to 15:00`);
  assert.match(verificationSummary({ ...okVerification, windows: { total: 12, cited: 0, uncited } }),
    /12 of 12 time windows have no cited record \(2026-08-01 15:00 to 15:00; 2026-08-02 15:00 to 15:00; 2026-08-03 15:00 to 15:00 and 9 more\)/);
});

test("the summary says when a 'Learn more' option was relabelled", () => {
  assert.match(verificationSummary({ ...okVerification, learn_more: "relabelled" }), /; a "Learn more" option that changed something was relabelled\.$/);
  assert.doesNotMatch(verificationSummary({ ...okVerification, learn_more: "ok" }), /Learn more/);
});
