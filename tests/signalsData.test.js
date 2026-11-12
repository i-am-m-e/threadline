// Tests for src/signalsData.js: the numbers, chart, quotes and actions on the Thread page
// (docs/specs/2026-11-12-signals-redesign.md, section 3). Every figure is worked out by code
// from the benchmark records (all synthetic), never from the model's wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecordFile } from "../src/records.js";
import { loadAnswerKey, loadEvalPack, loadRules } from "../scripts/eval/packs.js";
import { numberTiles, chartData, keyQuotes, recordsThatDontFit, headerActions, historySummary } from "../src/signalsData.js";

const NOW = new Date("2026-11-12T13:00:00");
const rules = loadRules();
const key = loadAnswerKey();
const recordsOf = (name) => loadEvalPack(name, key).files.flatMap((f) => parseRecordFile(f.name, f.text));
const records = [...new Map([...recordsOf("healthcare"), ...recordsOf("healthcare_update"), ...recordsOf("energy")].map((r) => [r.source_id, r])).values()];

const flowIds = (day, hours) => hours.map((h) => `HC-FLOW-202609${day}-${h}00`);
const finding = (source_id, more = {}) => ({ source_id, trust_label: "Observed", finding: "A finding.", quote: "", record_values: [], ...more });
const INCIDENT_QUOTE = "no available monitored bed when an EMS CTAS 2 chest pain patient arrived";
const COMPLAINT_QUOTE = "waiting 85 minutes after being placed in an exam room";

/** A small healthcare Thread seen on two afternoons, shaped like the ones the app saves. */
function thread({ status = "Flagged", evidence, notFit = ["HC-CMP-4480", "HC-INC-99110", "HC-CMP-4475"], history } = {}) {
  return {
    id: "THR-20261110-1", domain: "Healthcare", pattern_type: "Rooming during slow physician pace", location: "Synthetic UCC A", status,
    windows: [
      { start: "2026-09-20T15:00", end: "2026-09-20T18:00", source_ids: flowIds("20", [15, 16, 17, 18]) },
      { start: "2026-09-22T14:00", end: "2026-09-22T16:00", source_ids: flowIds("22", [14, 15, 16]) },
    ],
    runs: [{
      steps: { pattern: {
        supporting_evidence: evidence ?? [
          ...[...flowIds("20", [15, 16, 17, 18]), ...flowIds("22", [14, 15])].map((id) => finding(id)),
          finding("HC-FLOW-20260920-1500"), // the same record cited twice counts once
          finding("HC-INC-99102", { quote: INCIDENT_QUOTE }),
          finding("HC-CMP-4471", { quote: COMPLAINT_QUOTE }),
        ],
        evidence_that_does_not_fit: notFit,
      } },
      meta: {},
    }],
    history: history ?? [
      { time: "2026-11-10T12:00:00.000Z", status: "Inferred", by: "Threadline", note: "Noticed" },
      { time: "2026-11-10T12:00:00.000Z", status: "Flagged", by: "Threadline", note: "Medium or higher confidence with a safety-relevant condition" },
      { time: "2026-11-10T12:20:00.000Z", status: "Flagged", by: "Threadline", type: "update", note: "New records" },
    ],
  };
}
const energyThread = {
  id: "THR-20261110-2", domain: "Energy", pattern_type: "Permit issuance during inspector backlog", location: "Synthetic Site B", status: "Flagged",
  windows: [{ start: "2026-09-20T07:00", end: "2026-09-20T11:00", source_ids: ["07", "08", "09", "10", "11"].map((h) => `EN-PERMIT-20260920-${h}00`) }],
  runs: [{ steps: { pattern: { supporting_evidence: [finding("EN-PERMIT-20260920-0700"), finding("EN-NM-20260920-01", { quote: "began flange prep on Line B before zero-energy sign-off" })], evidence_that_does_not_fit: [] } }, meta: {} }],
  history: [],
};

// ---------- Number tiles ----------

test("tiles: the peak of each trigger metric in the Thread's windows, with its trigger underneath", () => {
  const tiles = numberTiles(thread(), records, rules, NOW);
  assert.deepEqual(tiles.slice(0, 2).map(({ label, value, unit, under }) => ({ label, value, unit, under })), [
    { label: "Room to physician", value: "96", unit: "min at peak", under: "Trigger is above 45 min" },
    { label: "Bed occupancy", value: "96", unit: "% at peak", under: "Trigger is above 90%" },
  ]);
});

test("tiles: occasions and records cited are counted by code (a record cited twice counts once; policy isn't counted)", () => {
  const withPolicy = thread();
  withPolicy.runs[0].steps.pattern.supporting_evidence.push(finding("HC-POL-CTAS-ESC"));
  const tiles = numberTiles(withPolicy, records, rules, NOW);
  assert.deepEqual(tiles.slice(2).map(({ label, value, unit, under }) => ({ label, value, unit, under })), [
    { label: "Occasions", value: "2", unit: "occasions", under: "Sep 20 and Sep 22" },
    { label: "Evidence", value: "8", unit: "records", under: "6 flow records, 1 incident report, 1 complaint" },
  ]);
  for (const t of tiles) assert.ok(t.help.length > 20, `${t.label} has hover help`);
});

test("tiles: the energy pack works too, including a figure worked out by code (permits per inspector)", () => {
  const tiles = numberTiles(energyThread, records, rules, NOW);
  assert.deepEqual(tiles.map(({ label, value, unit, under }) => ({ label, value, unit, under })), [
    { label: "Mean inspection wait", value: "130", unit: "min at peak", under: "Trigger is above 60 min" },
    { label: "Permits per inspector", value: "9", unit: "at peak", under: "Trigger is above 6" },
    { label: "Occasions", value: "1", unit: "occasion", under: "Sep 20" },
    { label: "Evidence", value: "2", unit: "records", under: "1 flow record, 1 near-miss report" },
  ]);
});

test("tiles: if the records can't be found, the tile says so instead of showing a number", () => {
  const tiles = numberTiles(thread(), [], rules, NOW);
  assert.deepEqual(tiles.slice(0, 2).map((t) => [t.value, t.unit]), [["—", "records not found"], ["—", "records not found"]]);
  assert.equal(tiles[2].value, "2", "occasions come from the Thread itself");
});

// ---------- Chart ----------

test("chart: the minutes metric by hour for each occasion, with the hour before and after when the records have them", () => {
  const chart = chartData(thread(), records, rules, NOW);
  assert.equal(chart.title, "Room to physician, minutes by hour");
  assert.deepEqual(chart.trigger, { value: 45, text: "dashed line = trigger (45 min)" });
  assert.equal(chart.max, 96);
  assert.deepEqual(chart.occasions.map((o) => o.day), ["Sep 20", "Sep 22"]);
  assert.deepEqual(chart.occasions[0].hours.map((h) => [h.label, h.value, h.crossed, h.others]), [
    ["2pm", 58, false, ["88%"]],
    ["3pm", 76, true, ["93%"]],
    ["4pm", 90, true, ["96%"]],
    ["5pm", 96, true, ["95%"]],
    ["6pm", 90, true, ["92%"]],
  ]);
  assert.deepEqual(chart.occasions[1].hours.map((h) => [h.label, h.value, h.crossed, h.others]), [
    ["1pm", 52, false, ["86%"]],
    ["2pm", 66, true, ["91%"]],
    ["3pm", 78, true, ["94%"]],
    ["4pm", 84, true, ["93%"]],
    ["5pm", 75, false, ["90%"]], // occupancy 0.90 is not above 0.90, so only one trigger was crossed
  ]);
  assert.equal(chart.note, "Darker bars are the hours that crossed both triggers. The small figure under each hour is bed occupancy.");
});

test("chart: the energy pack charts its minutes metric, with permits per inspector underneath", () => {
  const chart = chartData(energyThread, records, rules, NOW);
  assert.equal(chart.title, "Mean inspection wait, minutes by hour");
  assert.deepEqual(chart.occasions[0].hours.map((h) => h.label), ["7am", "8am", "9am", "10am", "11am"]);
  assert.ok(chart.occasions[0].hours.every((h) => h.crossed));
  assert.equal(chart.occasions[0].hours[0].others[0], "9");
});

test("chart: with no records there is nothing to draw", () => {
  assert.deepEqual(chartData(thread(), [], rules, NOW).occasions, []);
});

// ---------- Key quotes ----------

test("quotes: verified quotes from incident and complaint records; the safety-relevant one is tagged and comes first", () => {
  assert.deepEqual(keyQuotes(thread(), records, rules, NOW), [
    { kind: "Incident report", when: "Sep 20, 3:30 pm", quote: INCIDENT_QUOTE, source_id: "HC-INC-99102", safety: true, trust_label: "Observed" },
    { kind: "Complaint", when: "Sep 20, 4:10 pm", quote: COMPLAINT_QUOTE, source_id: "HC-CMP-4471", safety: false, trust_label: "Observed" },
  ]);
});

test("quotes: words that aren't in the record are never shown as a quote", () => {
  const invented = thread({ evidence: [finding("HC-CMP-4471", { quote: "waited three hours and left without being seen" })] });
  assert.deepEqual(keyQuotes(invented, records, rules, NOW), []);
});

// ---------- Records that don't fit ----------

test("don't fit: a bare ID becomes the record's own title, words and time", () => {
  const rows = recordsThatDontFit(thread(), records, NOW);
  assert.deepEqual(rows.map(({ source_id, kind, when }) => [source_id, kind, when]), [
    ["HC-CMP-4480", "Complaint", "Sep 20, 5:20 pm"],
    ["HC-INC-99110", "Incident report", "Sep 20, 4:45 pm"],
    ["HC-CMP-4475", "Complaint", "Sep 20, 3:45 pm"],
  ]);
  assert.equal(rows[2].title, "Synthetic patient feedback 4475 (compliment)");
  assert.match(rows[2].text, /seen by a physician about 15 minutes after/);
  assert.equal(rows[2].note, "", "a bare ID carries no note");
  assert.ok(rows.every((r) => r.tag === "Not counted as support"), "code can't tell which way a record points, so it doesn't say");
});

test("don't fit: the draft's own wording is kept as a note; scoring labels in the test files are never shown", () => {
  const worded = thread({ notFit: ["HC-CMP-4475: a compliment, the patient was seen quickly", "Staffing that day is unknown"] });
  const rows = recordsThatDontFit(worded, records, NOW);
  assert.equal(rows[0].source_id, "HC-CMP-4475");
  assert.equal(rows[0].note, "HC-CMP-4475: a compliment, the patient was seen quickly");
  assert.deepEqual(rows[1], { source_id: null, kind: "", title: "", text: "", when: "", note: "Staffing that day is unknown", tag: "Not counted as support" });
  assert.ok(!JSON.stringify(recordsThatDontFit(thread(), records, NOW)).includes("counter_evidence"));
  assert.ok(!JSON.stringify(rows).includes("eval_role"));
});

test("don't fit: an ID whose record can't be found is shown as it is, saying so", () => {
  const rows = recordsThatDontFit(thread({ notFit: ["HC-CMP-4480"] }), [], NOW);
  assert.deepEqual(rows, [{ source_id: "HC-CMP-4480", kind: "", title: "Record not found in the processed folder", text: "", when: "", note: "", tag: "Not counted as support" }]);
});

// ---------- The header's actions: the current role's, with one main action at most ----------

const ids = (thread_, role) => headerActions(thread_, role).actions.map((a) => `${a.id}${a.primary ? "*" : ""}`);

test("actions: a manager's buttons follow the status, and only one is the main action", () => {
  assert.deepEqual(ids(thread({ status: "Flagged" }), "Manager"), ["send*", "info", "notreal"]);
  assert.deepEqual(ids(thread({ status: "Inferred" }), "Manager"), ["send*", "info", "notreal"]);
  assert.deepEqual(ids(thread({ status: "Under review" }), "Manager"), ["info", "notreal"]);
  assert.deepEqual(ids(thread({ status: "Validated pattern" }), "Manager"), ["accept*", "choose", "info"]);
  assert.deepEqual(ids(thread({ status: "Decision recorded" }), "Manager"), ["review*", "info"]);
  assert.deepEqual(ids(thread({ status: "Outcome review due" }), "Manager"), ["outcome*", "info"]);
  assert.deepEqual(ids(thread({ status: "Closed" }), "Manager"), []);
  assert.deepEqual(ids(thread({ status: "Not confirmed" }), "Manager"), []);
  for (const status of ["Inferred", "Flagged", "Under review", "Validated pattern", "Decision recorded", "Outcome review due", "Closed"]) {
    for (const role of ["Manager", "Front-line lead"]) {
      assert.ok(headerActions(thread({ status }), role).actions.filter((a) => a.primary).length <= 1, `${status}, ${role}`);
    }
  }
});

test("actions: a front-line lead confirms or disagrees only while the Thread is under review", () => {
  assert.deepEqual(ids(thread({ status: "Under review" }), "Front-line lead"), ["confirm*", "context", "mismatch"]);
  assert.deepEqual(ids(thread({ status: "Flagged" }), "Front-line lead"), ["context"]);
  assert.equal(headerActions(thread({ status: "Flagged" }), "Front-line lead").note, "Waiting for a manager to send this for front-line validation.");
  assert.deepEqual(ids(thread({ status: "Closed" }), "Front-line lead"), []);
});

test("actions: with no role chosen there are no buttons, and a line says why", () => {
  assert.deepEqual(headerActions(thread(), ""), { actions: [], note: "Choose a role (top right) to act on this Thread." });
});

test("actions: a manager is told why choosing an approach isn't open yet", () => {
  assert.equal(headerActions(thread({ status: "Flagged" }), "Manager").note, "You can choose an approach once a front-line lead has confirmed the pattern.");
  assert.equal(headerActions(thread({ status: "Validated pattern" }), "Manager").note, "");
});

// ---------- History line ----------

test("history: when it was flagged and how often it was updated, from the Thread's own history", () => {
  assert.equal(historySummary(thread(), NOW), "flagged Nov 10 · updated once");
  const twice = thread();
  twice.history.push({ time: "2026-11-11T12:00:00.000Z", status: "Flagged", by: "Threadline", type: "update", note: "New records" });
  assert.equal(historySummary(twice, NOW), "flagged Nov 10 · updated twice");
  assert.equal(historySummary(thread({ history: [{ time: "2026-11-10T12:00:00.000Z", status: "Inferred", by: "Threadline", note: "Noticed" }] }), NOW), "noticed Nov 10 · not updated yet");
});
