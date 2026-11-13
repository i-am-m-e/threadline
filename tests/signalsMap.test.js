// Tests for src/signalsMap.js: what the Map tab draws (docs/specs/2026-11-12-signals-redesign.md,
// section 4). The timeline is worked out by code from the records' own timestamps and values;
// the drivers view arranges the analysis the Thread already holds. Records are the synthetic
// benchmark packs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecordFile } from "../src/records.js";
import { loadAnswerKey, loadEvalPack, loadRules } from "../scripts/eval/packs.js";
import { timelineData, driversData, recordDetails } from "../src/signalsMap.js";

const NOW = new Date("2026-11-12T13:00:00");
const rules = loadRules();
const key = loadAnswerKey();
const recordsOf = (name) => loadEvalPack(name, key).files.flatMap((f) => parseRecordFile(f.name, f.text));
const records = [...new Map([...recordsOf("healthcare"), ...recordsOf("healthcare_update"), ...recordsOf("energy")].map((r) => [r.source_id, r])).values()];

const flowIds = (day, hours) => hours.map((h) => `HC-FLOW-202609${day}-${h}00`);
const finding = (source_id) => ({ source_id, trust_label: "Observed", finding: "A finding.", quote: "", record_values: [] });

/** A healthcare Thread seen on two afternoons, shaped like the ones the app saves. */
function thread({ analysis = {}, options } = {}) {
  return {
    id: "THR-20261110-1", domain: "Healthcare", pattern_type: "Rooming during slow physician pace", location: "Synthetic UCC A", status: "Flagged",
    windows: [
      { start: "2026-09-20T15:00", end: "2026-09-20T18:00", source_ids: flowIds("20", [15, 16, 17, 18]) },
      { start: "2026-09-22T14:00", end: "2026-09-22T16:00", source_ids: flowIds("22", [14, 15, 16]) },
    ],
    runs: [{
      steps: {
        pattern: {
          supporting_evidence: [...flowIds("20", [15, 16, 17, 18]).map(finding), finding("HC-INC-99102"), finding("HC-CMP-4471")],
          evidence_that_does_not_fit: ["HC-CMP-4475", "HC-INC-99110"],
        },
        analysis: {
          policy_practice_gap: { policy_source_id: "HC-POL-CTAS-ESC" },
          contributing_conditions: [
            { condition: "High bed occupancy", source_ids: ["HC-FLOW-20260920-1500"], trust_label: "Observed" },
            { condition: "Slow physician pace", source_ids: flowIds("20", [15, 16, 17, 18]), trust_label: "Observed" },
            { condition: "Staffing gaps at shift change", source_ids: [], trust_label: "Inferred" },
          ],
          compounding_factors: ["Long waits after rooming"],
          pressure_map: [
            { role: "Charge nurse", pressure_carried: "Escalation", shifting_to: "Physician lead", source_ids: ["HC-POL-CTAS-ESC"], trust_label: "Authoritative" },
            { role: "Triage RN", pressure_carried: "Reporting", shifting_to: "", source_ids: ["HC-INC-99102"], trust_label: "Observed" },
          ],
          ...analysis,
        },
        options: options ?? {
          options: [
            { option_id: "O1", title: "Explore bed occupancy and physician pace", type: "Learn more", evidence_ids: ["EV-HC-001"] },
            { option_id: "O2", title: "Escalation huddles", type: "Process adjustment", evidence_ids: [] },
          ],
          recommendation: { leading_option_id: "O2" },
        },
      },
      meta: {},
    }],
    history: [],
  };
}
const energyThread = {
  id: "THR-20261110-2", domain: "Energy", pattern_type: "Permit issuance during inspector backlog", location: "Synthetic Site B", status: "Flagged",
  windows: [{ start: "2026-09-20T07:00", end: "2026-09-20T11:00", source_ids: ["07", "08", "09", "10", "11"].map((h) => `EN-PERMIT-20260920-${h}00`) }],
  runs: [{ steps: {
    pattern: { supporting_evidence: [finding("EN-PERMIT-20260920-0700"), finding("EN-NM-20260920-01")], evidence_that_does_not_fit: [] },
    analysis: { contributing_conditions: [], compounding_factors: [], pressure_map: [] },
    options: { options: [], recommendation: {} },
  }, meta: {} }],
  history: [],
};
const lane = (occasion, id) => occasion.lanes.find((l) => l.id === id);

// ---------- Timeline ----------

test("timeline: one occasion per time window, on an hour axis from two hours before to two hours after", () => {
  const { occasions } = timelineData(thread(), records, rules, NOW);
  assert.equal(occasions.length, 2);
  const [first, second] = occasions;
  assert.equal(first.when, "Sep 20, 3 to 6 pm");
  assert.equal(first.hours, 7);
  assert.deepEqual(first.ticks, ["1 pm", "2 pm", "3 pm", "4 pm", "5 pm", "6 pm", "7 pm", "8 pm"]);
  assert.equal(second.when, "Sep 22, 2 to 4 pm");
  assert.deepEqual(second.ticks, ["12 pm", "1 pm", "2 pm", "3 pm", "4 pm", "5 pm", "6 pm"]);
});

test("timeline: the pattern window is shaded from its first hour to the end of its last hour", () => {
  const [first] = timelineData(thread(), records, rules, NOW).occasions;
  assert.deepEqual(first.window, { from: 2, to: 6, label: "Pattern window: both triggers crossed" });
});

test("timeline: the lanes are flow data, incidents, complaints and policy, in that order", () => {
  const [first] = timelineData(thread(), records, rules, NOW).occasions;
  assert.deepEqual(first.lanes.map((l) => [l.id, l.label]), [["flow", "Flow data"], ["incidents", "Incidents"], ["complaints", "Complaints"], ["policy", "Policy"]]);
  const [energy] = timelineData(energyThread, records, rules, NOW).occasions;
  assert.equal(lane(energy, "incidents").label, "Incidents and near misses");
});

test("timeline: a flow card per hour, with the record's own values; hours that crossed every trigger are marked", () => {
  const [first] = timelineData(thread(), records, rules, NOW).occasions;
  assert.deepEqual(lane(first, "flow").items.map(({ at, value, label, others, crossed, source_ids }) => ({ at, value, label, others, crossed, source_ids })), [
    { at: 1, value: "58 min", label: "room to physician", others: ["88% bed occupancy"], crossed: false, source_ids: ["HC-FLOW-20260920-1400"] },
    { at: 2, value: "76 min", label: "room to physician", others: ["93% bed occupancy"], crossed: true, source_ids: ["HC-FLOW-20260920-1500"] },
    { at: 3, value: "90 min", label: "room to physician", others: ["96% bed occupancy"], crossed: true, source_ids: ["HC-FLOW-20260920-1600"] },
    { at: 4, value: "96 min", label: "room to physician", others: ["95% bed occupancy"], crossed: true, source_ids: ["HC-FLOW-20260920-1700"] },
    { at: 5, value: "90 min", label: "room to physician", others: ["92% bed occupancy"], crossed: true, source_ids: ["HC-FLOW-20260920-1800"] },
  ]);
});

test("timeline: incidents and complaints sit at their own time, with the record's own title and words", () => {
  const [first] = timelineData(thread(), records, rules, NOW).occasions;
  const incidents = lane(first, "incidents").items;
  assert.deepEqual(incidents.map(({ source_ids, at, time, title, relation, note }) => ({ source_ids, at, time, title, relation, note })), [
    { source_ids: ["HC-INC-99102"], at: 2.5, time: "3:30 pm", title: "Synthetic incident report 99102", relation: "cited", note: "HC-INC-99102" },
    { source_ids: ["HC-INC-99110"], at: 3.75, time: "4:45 pm", title: "Synthetic incident report 99110", relation: "not-fit", note: "Not counted as support" },
  ]);
  assert.match(incidents[0].text, /^Triage reported no available monitored bed/);
  assert.equal(incidents[0].safety, true);
  assert.equal(incidents[1].safety, false);
});

test("timeline: a record near the window that the draft never mentioned is shown as not cited", () => {
  const [first] = timelineData(thread(), records, rules, NOW).occasions;
  const complaints = lane(first, "complaints").items;
  assert.deepEqual(complaints.map((c) => [c.source_ids[0], c.relation, c.note]), [
    ["HC-CMP-4475", "not-fit", "Not counted as support"],
    ["HC-CMP-4471", "cited", "HC-CMP-4471"],
    ["HC-CMP-4480", "not-cited", "Not cited in the draft"],
  ]);
});

test("timeline: records at another site, or outside the hours shown, are left out", () => {
  const all = timelineData(thread(), records, rules, NOW).occasions.flatMap((o) => o.lanes.flatMap((l) => l.items.flatMap((i) => i.source_ids)));
  assert.ok(!all.includes("HC-CMP-5102"), "a complaint at UCC B");
  assert.ok(!all.includes("HC-CMP-4462"), "a complaint at 11:30 am, before the hours shown");
});

test("timeline: cards close together in time go on separate rows so they don't overlap", () => {
  const [first] = timelineData(thread(), records, rules, NOW).occasions;
  assert.deepEqual(lane(first, "incidents").items.map((i) => i.row), [0, 1]);
  assert.equal(lane(first, "incidents").rows, 2);
  assert.deepEqual(lane(first, "complaints").items.map((i) => i.row), [0, 1, 0]);
  assert.equal(lane(first, "flow").rows, 1);
});

test("timeline: policy applies throughout, with the policy record's own title", () => {
  const [first] = timelineData(thread(), records, rules, NOW).occasions;
  assert.deepEqual(lane(first, "policy").items.map(({ title, note, source_ids, relation }) => ({ title, note, source_ids, relation })), [
    { title: "Synthetic excerpt: CTAS escalation and monitored beds", note: "Applies throughout", source_ids: ["HC-POL-CTAS-ESC"], relation: "policy" },
  ]);
});

test("timeline: each occasion has a one-line summary counted by code", () => {
  const [first, second] = timelineData(thread(), records, rules, NOW).occasions;
  assert.equal(first.summary, "4 hours crossed both triggers. Nearby: 2 incident reports, 3 complaints (2 cited in the draft).");
  assert.equal(second.summary, "3 hours crossed both triggers. No incident, complaint or near-miss records nearby.");
  assert.deepEqual(lane(second, "flow").items.map((i) => [i.value, i.crossed]), [["52 min", false], ["66 min", true], ["78 min", true], ["84 min", true], ["75 min", false]]);
});

test("timeline: a window whose flow records can't be found still gets its axis and an empty flow lane", () => {
  const [first] = timelineData(thread(), [], rules, NOW).occasions;
  assert.equal(first.hours, 7);
  assert.deepEqual(first.lanes.map((l) => l.items.length), [0, 0, 0, 0]);
  assert.equal(first.summary, "The flow records for these hours weren't found in the processed folder.");
});

test("timeline: works for another domain (energy: permits, near misses)", () => {
  const [o] = timelineData(energyThread, records, rules, NOW).occasions;
  assert.equal(o.when, "Sep 20, 7 to 11 am");
  assert.deepEqual(o.ticks.slice(0, 2), ["5 am", "6 am"]);
  assert.equal(lane(o, "flow").items.length, 5);
  assert.equal(lane(o, "flow").items[0].label, "mean inspection wait");
  assert.deepEqual(lane(o, "incidents").items.map((i) => [i.source_ids[0], i.relation]), [
    ["EN-INC-20260920-05", "not-cited"], ["EN-NM-20260920-01", "cited"], ["EN-NM-20260920-02", "not-cited"], ["EN-INC-20260920-06", "not-cited"],
  ]);
  assert.deepEqual(lane(o, "complaints").items, []);
});

// ---------- Drivers ----------

test("drivers: four columns: outcome, primary drivers, secondary drivers, possible changes", () => {
  const { columns } = driversData(thread(), records, rules, NOW);
  assert.deepEqual(columns.map((c) => [c.id, c.label]), [["outcome", "Outcome"], ["primary", "Primary drivers"], ["secondary", "Secondary drivers"], ["changes", "Possible changes"]]);
});

test("drivers: the outcome is the pattern, with its peak and occasions counted by code", () => {
  const [outcome] = driversData(thread(), records, rules, NOW).columns[0].items;
  assert.equal(outcome.title, "Rooming during slow physician pace");
  assert.equal(outcome.sub, "Room to physician up to 96 min · 2 occasions");
  assert.equal(outcome.trust_label, "Observed");
  assert.deepEqual(outcome.source_ids, [...flowIds("20", [15, 16, 17, 18]), ...flowIds("22", [14, 15, 16])]);
});

test("drivers: primary drivers are the contributing conditions; one with no record is dashed", () => {
  const items = driversData(thread(), records, rules, NOW).columns[1].items;
  assert.deepEqual(items.map(({ title, sub, trust_label, dashed }) => ({ title, sub, trust_label, dashed })), [
    { title: "High bed occupancy", sub: "HC-FLOW-20260920-1500", trust_label: "Observed", dashed: false },
    { title: "Slow physician pace", sub: "4 flow records", trust_label: "Observed", dashed: false },
    { title: "Staffing gaps at shift change", sub: "No record cited", trust_label: "Inferred", dashed: true },
  ]);
});

test("drivers: secondary drivers are the pressure map and the compounding factors", () => {
  const items = driversData(thread(), records, rules, NOW).columns[2].items;
  assert.deepEqual(items.map(({ title, sub, trust_label, dashed }) => ({ title, sub, trust_label, dashed })), [
    { title: "Charge nurse: Escalation (appears to shift to Physician lead)", sub: "Pressure map · HC-POL-CTAS-ESC", trust_label: "Authoritative", dashed: false },
    { title: "Triage RN: Reporting", sub: "Pressure map · HC-INC-99102", trust_label: "Observed", dashed: false },
    { title: "Long waits after rooming", sub: "Where small variations combine · no record cited", trust_label: "Inferred", dashed: true },
  ]);
});

test("drivers: possible changes are the options, always suggested and dashed; the recommended one says so", () => {
  const items = driversData(thread(), records, rules, NOW).columns[3].items;
  assert.deepEqual(items.map(({ title, sub, trust_label, dashed, option_id, recommended }) => ({ title, sub, trust_label, dashed, option_id, recommended })), [
    { title: "Explore bed occupancy and physician pace", sub: "Learn more", trust_label: "Suggested", dashed: true, option_id: "O1", recommended: false },
    { title: "Escalation huddles", sub: "Process adjustment · recommended", trust_label: "Suggested", dashed: true, option_id: "O2", recommended: true },
  ]);
});

test("drivers: every item has its own id, and a Thread with little analysis still draws", () => {
  const ids = driversData(thread(), records, rules, NOW).columns.flatMap((c) => c.items.map((i) => i.id));
  assert.equal(new Set(ids).size, ids.length);
  const { columns } = driversData(energyThread, records, rules, NOW);
  assert.deepEqual(columns.map((c) => c.items.length), [1, 0, 0, 0]);
  assert.equal(columns[0].items[0].sub, "Mean inspection wait up to 130 min · 1 occasion");
});

// ---------- The records behind a selected item ----------

test("record details: a text record gives its kind, time and own words; a flow record gives its values", () => {
  const [complaint, flow] = recordDetails(["HC-CMP-4471", "HC-FLOW-20260920-1700"], thread(), records, rules, NOW);
  assert.deepEqual({ ...complaint, text: complaint.text.slice(0, 27) }, {
    source_id: "HC-CMP-4471", found: true, kind: "Complaint", when: "Sep 20, 4:10 pm", title: "Synthetic complaint 4471", text: "Patient expressed strong fr", values: [],
  });
  assert.equal(flow.kind, "Flow record");
  assert.equal(flow.when, "Sep 20, 5 pm");
  assert.deepEqual(flow.values.slice(0, 2), [{ label: "Room to physician", text: "96 min" }, { label: "Bed occupancy", text: "95%" }]);
  assert.ok(flow.values.some((v) => v.label === "Waiting room count"));
  assert.ok(!flow.values.some((v) => /synthetic|file/i.test(v.label)));
});

test("record details: a record that isn't in the processed folder says so; repeats are listed once", () => {
  assert.deepEqual(recordDetails(["HC-GONE-1", "HC-GONE-1"], thread(), records, rules, NOW), [
    { source_id: "HC-GONE-1", found: false, kind: "", when: "", title: "Record not found in the processed folder", text: "", values: [] },
  ]);
});
