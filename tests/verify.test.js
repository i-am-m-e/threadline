// Tests for src/verify.js: checking that what the model says is really in the record it cites.
// Records here are the real benchmark records (all synthetic).
import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteProblem, numberProblems, thresholdsOf } from "../src/verify.js";

const complaint = {
  source_id: "HC-CMP-4471", source_type: "complaint",
  text: "Patient expressed strong frustration after waiting 85 minutes after being placed in an exam room before seeing a physician.",
};
const nearMiss = {
  source_id: "EN-NM-20260920-01", source_type: "near_miss",
  text: "Contractor crew began flange prep on Line B before zero-energy sign-off, after a 2-hour wait for inspector verification. The inspector was covering 8 active permits at the time.",
};

// ---------- Part 1: quotes ----------

test("quote: exact words from the record pass", () => {
  assert.equal(quoteProblem("waiting 85 minutes after being placed in an exam room", complaint), null);
});

test("quote: differences in capitals and spacing are ignored", () => {
  assert.equal(quoteProblem("Waiting  85 MINUTES after being placed", complaint), null);
});

test("quote: curly quote marks around the quote and a missing full stop are ignored", () => {
  assert.equal(quoteProblem("“before seeing a physician”", complaint), null);
  assert.equal(quoteProblem("in an exam room before seeing a physician", complaint), null);
});

test("quote: a different dash is treated as the same dash", () => {
  assert.equal(quoteProblem("on Line B before zero–energy sign—off", nearMiss), null);
});

test("quote: words that aren't in the record fail, naming the record", () => {
  const problem = quoteProblem("waiting 90 minutes after being placed", complaint);
  assert.match(problem, /HC-CMP-4471/);
  assert.match(problem, /isn't in that record/);
});

test("quote: other punctuation must match", () => {
  assert.match(quoteProblem("began flange prep on Line B before zero-energy sign-off after a 2-hour wait", nearMiss), /isn't in that record/);
});

test("quote: pieces joined with ... or … are refused", () => {
  assert.match(quoteProblem("began flange prep ... covering 8 active permits", nearMiss), /one continuous stretch/);
  assert.match(quoteProblem("began flange prep … covering 8 active permits", nearMiss), /one continuous stretch/);
});

test("quote: fewer than 4 words is too short", () => {
  assert.match(quoteProblem("exam room", complaint), /at least 4 words/);
});

test("quote: an empty quote is refused", () => {
  assert.match(quoteProblem("  ", complaint), /needs a quote/);
});

test("quote: a quote has to come from the record's own text, not its title", () => {
  const withTitle = { ...complaint, title: "Synthetic complaint 4471 about exam room waits" };
  assert.match(quoteProblem("Synthetic complaint 4471 about", withTitle), /isn't in that record/);
});

// ---------- Part 2: numbers in the finding's wording ----------

const flow1600 = {
  source_id: "HC-FLOW-20260920-1600", source_type: "emr_flow", location: "Synthetic UCC A", timestamp: "2026-09-20T16:00",
  bed_occupancy: 0.96, room_to_physician_minutes: 90, waiting_room_count: 18,
};
const incident = {
  source_id: "HC-INC-99102", source_type: "incident_report", timestamp: "2026-09-20T15:30",
  text: "Triage reported no available monitored bed when an EMS CTAS 2 chest pain patient arrived. Reporter role: triage RN.",
};
const permits0900 = {
  source_id: "EN-PERMIT-20260920-0900", source_type: "permit_log", timestamp: "2026-09-20T09:00",
  active_permits: 18, inspectors_on_duty: 2, mean_inspection_wait_minutes: 115, permits_per_inspector: 9,
};
const none = [];

test("numbers: a number that is in the record passes", () => {
  assert.deepEqual(numberProblems("Patient waited 85 minutes after rooming.", complaint, none), []);
});

test("numbers: a number that isn't in the record fails, naming it", () => {
  const problems = numberProblems("Patient waited 95 minutes after rooming.", complaint, none);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /HC-CMP-4471/);
  assert.match(problems[0], /95/);
});

test("numbers: 0.96 can be written as 96%, 96 percent or 0.96", () => {
  for (const finding of ["Bed occupancy was 96%.", "Bed occupancy was 96 percent.", "Bed occupancy was 0.96."]) {
    assert.deepEqual(numberProblems(finding, flow1600, none), [], finding);
  }
  assert.equal(numberProblems("Bed occupancy was 97%.", flow1600, none).length, 1);
});

test("numbers: rounding a fraction to a whole percent is fine (0.955 → 96%)", () => {
  assert.deepEqual(numberProblems("Occupancy about 96%.", { ...flow1600, bed_occupancy: 0.955 }, none), []);
});

test("numbers: hours in the record's text may be given in minutes (2-hour → 120)", () => {
  assert.deepEqual(numberProblems("The crew waited 120 minutes for verification.", nearMiss, none), []);
  assert.equal(numberProblems("The crew waited 180 minutes for verification.", nearMiss, none).length, 1);
});

test("numbers: a minutes field may be given in whole or half hours (90 → 1.5)", () => {
  assert.deepEqual(numberProblems("Room-to-physician time reached 1.5 hours.", flow1600, none), []);
});

test("numbers: minutes that aren't a whole or half hour aren't converted (85 → 1.4 fails)", () => {
  assert.equal(numberProblems("A wait of about 1.4 hours.", complaint, none).length, 1);
});

test("numbers: a number the record doesn't call hours is never converted (8 permits ≠ 480)", () => {
  assert.equal(numberProblems("The inspector was covering 480 minutes of permits.", nearMiss, none).length, 1);
});

test("numbers: the domain's own thresholds are allowed (above 90%, above 45 minutes)", () => {
  const thresholds = [0.9, 45];
  const finding = "Bed occupancy above 90% and room-to-physician time above 45 minutes.";
  assert.deepEqual(numberProblems(finding, flow1600, thresholds), []);
  assert.equal(numberProblems(finding, flow1600, none).length, 1, "without the thresholds, 90 and 45 aren't in the record");
});

test("numbers: the record's time and id count as being in the record", () => {
  assert.deepEqual(numberProblems("At 15:30 a CTAS 2 patient had no monitored bed (HC-INC-99102).", incident, none), []);
});

test("numbers: a value code works out from the record (permits per inspector) counts", () => {
  assert.deepEqual(numberProblems("About 9 permits per inspector, with an average wait of 115 minutes.", permits0900, none), []);
});

test("numbers: numbers written as words aren't checked (a known gap)", () => {
  assert.deepEqual(numberProblems("A three-hour wait.", complaint, none), []);
});

test("thresholds: the numbers come from the domain's triggers and safety conditions", () => {
  const pack = {
    triggers: [{ all: [{ metric: "bed_occupancy", op: ">", value: 0.9 }, { metric: "room_to_physician_minutes", op: ">", value: 45 }] }],
    safety_relevant_conditions: [{ id: "a", text_groups: [["CTAS 1"]] }, { id: "b", metric: "room_to_physician_minutes", op: ">", value: 60 }],
  };
  assert.deepEqual(thresholdsOf(pack).sort((a, b) => a - b), [0.9, 45, 60]);
});
