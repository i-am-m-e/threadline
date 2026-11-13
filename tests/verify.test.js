// Tests for src/verify.js: checking that what the model says is really in the record it cites.
// Records here are the real benchmark records (all synthetic).
import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteProblem, numberProblems, thresholdsOf, recordValueProblems, evidenceProblems, policyQuoteProblem, claimNumberProblems, fittingTrustLabel, categoryPhrasesFor } from "../src/verify.js";

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

// ---------- Part 3: record values, the whole evidence item, the policy quote ----------

test("record values: a field with its real value passes", () => {
  assert.deepEqual(recordValueProblems([{ field: "room_to_physician_minutes", value: 90 }, { field: "bed_occupancy", value: 0.96 }], flow1600), []);
});

test("record values: a fraction given as a percent passes (bed_occupancy 96 for 0.96)", () => {
  assert.deepEqual(recordValueProblems([{ field: "bed_occupancy", value: 96 }], flow1600), []);
});

test("record values: a wrong value fails, naming the field and the record's value", () => {
  const problems = recordValueProblems([{ field: "room_to_physician_minutes", value: 76 }], flow1600);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /HC-FLOW-20260920-1600: room_to_physician_minutes is 90 in that record, not 76/);
});

test("record values: a field the record doesn't have fails", () => {
  assert.match(recordValueProblems([{ field: "nurse_ratio", value: 4 }], flow1600)[0], /has no field "nurse_ratio"/);
});

test("record values: a field code works out (permits_per_inspector) counts", () => {
  assert.deepEqual(recordValueProblems([{ field: "permits_per_inspector", value: 9 }], permits0900), []);
});

const item = (over) => ({ source_id: "x", trust_label: "Observed", finding: "", quote: "", record_values: [], ...over });

test("evidence item: a flow finding with matching values and numbers passes", () => {
  const e = item({ source_id: flow1600.source_id, finding: "Occupancy 96% and room-to-physician time 90 minutes.",
    record_values: [{ field: "bed_occupancy", value: 0.96 }, { field: "room_to_physician_minutes", value: 90 }] });
  assert.deepEqual(evidenceProblems(e, flow1600, none), []);
});

test("evidence item: a flow finding needs record values", () => {
  assert.match(evidenceProblems(item({ finding: "Occupancy was high." }), flow1600, none).join(), /needs record_values/);
});

test("evidence item: a flow record has no text to quote", () => {
  const e = item({ finding: "Time 90 minutes.", quote: "room to physician 90 minutes", record_values: [{ field: "room_to_physician_minutes", value: 90 }] });
  assert.match(evidenceProblems(e, flow1600, none).join(), /no text to quote/);
});

test("evidence item: an incident, complaint or near-miss finding needs a quote", () => {
  assert.match(evidenceProblems(item({ finding: "A long wait." }), complaint, none).join(), /needs a quote/);
});

test("evidence item: record values on a complaint are refused (it has no fields to check)", () => {
  const e = item({ finding: "A long wait.", quote: "waiting 85 minutes after being placed", record_values: [{ field: "wait", value: 85 }] });
  assert.match(evidenceProblems(e, complaint, none).join(), /leave record_values empty/);
});

test("evidence item: a real quote with a made-up number in the finding fails", () => {
  const e = item({ finding: "Patient waited 95 minutes.", quote: "waiting 85 minutes after being placed" });
  assert.match(evidenceProblems(e, complaint, none).join(), /mentions 95/);
});

test("evidence item: a real quote with matching wording passes", () => {
  const e = item({ finding: "Patient waited 85 minutes after rooming.", quote: "waiting 85 minutes after being placed in an exam room" });
  assert.deepEqual(evidenceProblems(e, complaint, none), []);
});

const policy = {
  source_id: "HC-POL-CTAS-ESC", source_type: "policy",
  text: "Synthetic policy excerpt. Patients triaged as CTAS 1 or CTAS 2 require immediate access to a monitored bed on arrival. When no monitored bed is available, the charge nurse escalates to the physician lead to create capacity.",
};
const gap = (over) => ({ policy_source_id: "HC-POL-CTAS-ESC", policy_quote: "", what_policy_expects: "", what_records_suggest: "", confidence: "Medium", ...over });

test("policy quote: words from the policy pass", () => {
  assert.equal(policyQuoteProblem(gap({ policy_quote: "require immediate access to a monitored bed on arrival" }), policy), null);
});

test("policy quote: words not in the policy fail", () => {
  assert.match(policyQuoteProblem(gap({ policy_quote: "require a monitored bed within 10 minutes" }), policy), /isn't in that record/);
});

test("policy quote: a missing quote fails", () => {
  assert.match(policyQuoteProblem(gap({}), policy), /needs a quote/);
});

// ---------- Analysis claims (contributing conditions, pressure map) ----------

test("claim numbers: a number in any one of the cited records passes", () => {
  assert.deepEqual(claimNumberProblems("Waits of 85 minutes with occupancy at 96%", [complaint, flow1600], none), []);
});

test("claim numbers: a number in none of the cited records fails, naming them", () => {
  const problems = claimNumberProblems("Waits of 140 minutes", [complaint, flow1600], none);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /mentions 140, which isn't in the records it cites \(HC-CMP-4471, HC-FLOW-20260920-1600\)/);
});

test("claim numbers: text without numbers passes, and thresholds are allowed", () => {
  assert.deepEqual(claimNumberProblems("High bed occupancy", [flow1600], none), []);
  assert.deepEqual(claimNumberProblems("Room-to-physician time above 45 minutes", [flow1600], [45]), []);
});

test("trust label: Inferred is always kept", () => {
  assert.equal(fittingTrustLabel("Inferred", [flow1600]), "Inferred");
  assert.equal(fittingTrustLabel("Inferred", []), "Inferred");
});

test("trust label: a claim citing no records is Inferred", () => {
  assert.equal(fittingTrustLabel("Observed", []), "Inferred");
});

test("trust label: Observed needs a flow, incident, complaint or near-miss record", () => {
  assert.equal(fittingTrustLabel("Observed", [flow1600, policy]), "Observed");
  assert.equal(fittingTrustLabel("Observed", [policy]), "Authoritative");
});

test("trust label: Authoritative needs a policy", () => {
  assert.equal(fittingTrustLabel("Authoritative", [policy]), "Authoritative");
  assert.equal(fittingTrustLabel("Authoritative", [complaint]), "Observed");
});

test("trust label: the model can't claim Experiential or Historical (only people add those)", () => {
  assert.equal(fittingTrustLabel("Experiential", [complaint]), "Observed");
  assert.equal(fittingTrustLabel("Historical", [policy]), "Authoritative");
});

test("numbers: the record's own hour may be written on a 12-hour clock (15:00 → 3:00 PM)", () => {
  const at1500 = { source_id: "HC-FLOW-20260920-1500", timestamp: "2026-09-20T15:00", bed_occupancy: 0.93 };
  assert.deepEqual(numberProblems("Flow record 3:00 PM", at1500, none), []);
  assert.equal(numberProblems("Flow record 4:00 PM", at1500, none).length, 1, "only the record's own hour");
});

test("claim numbers: a long list of cited records is shortened in the message", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ source_id: `HC-FLOW-TEST-${i + 1}`, bed_occupancy: 0.95 }));
  const [problem] = claimNumberProblems("Waits of 140 minutes", many, none);
  assert.match(problem, /\(HC-FLOW-TEST-1, HC-FLOW-TEST-2, HC-FLOW-TEST-3 and 9 more\)\.$/);
});

// ---------- Review fixes: a record's id, time and date only count when used as such ----------

test("numbers: a number taken from the record's time doesn't count as a quantity (15:00 ≠ 15 patients)", () => {
  const at1500 = { source_id: "HC-FLOW-20260920-1500", timestamp: "2026-09-20T15:00", waiting_room_count: 13 };
  assert.equal(numberProblems("15 patients were waiting.", at1500, none).length, 1);
  assert.deepEqual(numberProblems("13 patients were waiting at 15:00.", at1500, none), []);
});

test("numbers: a number taken from the record's id doesn't count as a quantity (HC-CMP-4471 ≠ 4471 patients)", () => {
  assert.equal(numberProblems("4471 patients waited.", complaint, none).length, 1);
  assert.deepEqual(numberProblems("Complaint HC-CMP-4471 describes an 85-minute wait.", complaint, none), []);
});

test("numbers: the record's date may be written as a date (2026-09-20, Sept 20, September 20th); other dates fail", () => {
  const at1500 = { source_id: "HC-FLOW-20260920-1500", timestamp: "2026-09-20T15:00", bed_occupancy: 0.93 };
  for (const t of ["On 2026-09-20 occupancy was 93%.", "On Sept 20 occupancy was 93%.", "On September 20th occupancy was 93%.", "On 20 September occupancy was 93%."]) {
    assert.deepEqual(numberProblems(t, at1500, none), [], t);
  }
  assert.equal(numberProblems("On September 21st occupancy was 93%.", at1500, none).length, 1);
});

test("numbers: a time span written on a 12-hour clock uses the records' own hours (3:00 to 6:00 PM)", () => {
  const recs = [15, 16, 17, 18].map((h) => ({ source_id: `HC-FLOW-20260920-${h}00`, timestamp: `2026-09-20T${h}:00`, bed_occupancy: 0.93 }));
  assert.deepEqual(claimNumberProblems("Between 3:00 and 6:00 PM occupancy stayed at 93%.", recs, none), []);
  assert.equal(claimNumberProblems("Between 1:00 and 6:00 PM occupancy stayed at 93%.", recs, none).length, 1);
});

test("numbers: 'CTAS 2' counts only when a cited record's text says it, not because of its date", () => {
  const flowOnly = [{ source_id: "HC-FLOW-TEST-20260802", timestamp: "2026-08-02T15:00", bed_occupancy: 0.95 }];
  assert.equal(claimNumberProblems("No monitored bed for CTAS 2", flowOnly, none).length, 1);
  assert.deepEqual(claimNumberProblems("No monitored bed for CTAS 2", [incident], none), []);
});

// ---------- Numbers by reference (config.numbersByReference) ----------
import { resolveReferences } from "../src/verify.js";

const byRef = { byReference: true };

test("by reference: a reference to the cited flow record's field passes; the same figure typed doesn't", () => {
  assert.deepEqual(numberProblems("Room time reached {HC-FLOW-20260920-1600.room_to_physician_minutes} minutes.", flow1600, none, byRef), []);
  const [typed] = numberProblems("Room time reached 90 minutes.", flow1600, none, byRef);
  assert.match(typed, /mentions 90/);
  assert.match(typed, /\{HC-FLOW-20260920-1600\.room_to_physician_minutes\}/, "the message shows how to write it");
});

test("by reference: a reference to a field the record doesn't have, or to a record it can't cite, fails", () => {
  assert.match(numberProblems("{HC-FLOW-20260920-1600.nurse_ratio} nurses", flow1600, none, byRef)[0], /has no number field "nurse_ratio"/);
  assert.match(numberProblems("{HC-FLOW-20260920-1700.bed_occupancy%} full", flow1600, none, byRef)[0], /HC-FLOW-20260920-1700 isn't a record this can cite/);
});

test("by reference: figures in an incident or complaint's own text, and thresholds, may still be typed", () => {
  assert.deepEqual(numberProblems("Patient waited 85 minutes.", complaint, none, byRef), []);
  assert.deepEqual(numberProblems("Room time above 45 minutes.", flow1600, [45], byRef), []);
});

test("by reference: times and dates must be references too", () => {
  assert.deepEqual(numberProblems("At {HC-INC-99102.time} on {HC-INC-99102.date}, no monitored bed for CTAS 2.", incident, none, byRef), []);
  assert.match(numberProblems("At 15:30, no monitored bed for CTAS 2.", incident, none, byRef)[0], /mentions 15, 30/);
});

test("by reference: claims check references against the records they cite", () => {
  assert.deepEqual(claimNumberProblems("Occupancy reached {HC-FLOW-20260920-1600.bed_occupancy%}", [flow1600], none, byRef), []);
  assert.equal(claimNumberProblems("Occupancy reached 96%", [flow1600], none, byRef).length, 1);
});

test("resolving references fills in the record's real values, formatted for people", () => {
  const byId = new Map([[flow1600.source_id, flow1600], [incident.source_id, incident]]);
  const out = resolveReferences({
    finding: "Room time {HC-FLOW-20260920-1600.room_to_physician_minutes} min, occupancy {HC-FLOW-20260920-1600.bed_occupancy%} ({HC-FLOW-20260920-1600.bed_occupancy}).",
    note: "Reported at {HC-INC-99102.time} on {HC-INC-99102.date}.",
    quote: "left {HC-FLOW-20260920-1600.bed_occupancy} as it is",
    bad: "{HC-FAKE-1.bed_occupancy} beds",
  }, byId);
  assert.equal(out.value.finding, "Room time 90 min, occupancy 96% (0.96).");
  assert.equal(out.value.note, "Reported at 15:30 on Sep 20.");
  assert.equal(out.value.quote, "left {HC-FLOW-20260920-1600.bed_occupancy} as it is", "quotes are never changed");
  assert.equal(out.value.bad, "[figure not found] beds");
  assert.equal(out.resolved, 5);
  assert.equal(out.unresolved, 1);
});

// ---------- A safety condition's own label, quoted word for word (2026-11-09) ----------
// The pattern prompt shows the model the safety-relevant conditions' labels. In 2026-11-09 the
// model cited HC-INC-99102 for "No monitored bed for a CTAS 1 or 2 arrival" (the label itself),
// and the finding was removed because the record says "CTAS 2" and has no "1".

const noBed = {
  source_id: "HC-INC-99102", source_type: "incident_report",
  text: "Triage reported no available monitored bed when an EMS CTAS 2 chest pain patient arrived.",
};
const LABELS = ["No monitored bed for a CTAS 1 or 2 arrival", "Waits after rooming over 60 minutes"];

test("numbers: a safety condition's label quoted word for word passes, whatever the capitals", () => {
  assert.deepEqual(numberProblems("No monitored bed for a CTAS 1 or 2 arrival", noBed, [], { labels: LABELS }), []);
  assert.deepEqual(numberProblems("no monitored bed for a  CTAS 1 or 2 arrival at 15:30.", { ...noBed, timestamp: "2026-09-20T15:30" }, [], { labels: LABELS }), []);
  assert.deepEqual(evidenceProblems({ finding: "No monitored bed for a CTAS 1 or 2 arrival", quote: "no available monitored bed when an EMS CTAS 2 chest pain patient arrived", record_values: [] }, noBed, [], { labels: LABELS }), []);
});

test("numbers: without the labels, the same finding is still refused (the behaviour before)", () => {
  assert.match(numberProblems("No monitored bed for a CTAS 1 or 2 arrival", noBed, [])[0], /mentions 1, which isn't in that record/);
});

test("numbers: other numbers beside a quoted label are still checked", () => {
  const problems = numberProblems("No monitored bed for a CTAS 1 or 2 arrival; 3 patients waited", noBed, [], { labels: LABELS });
  assert.match(problems[0], /mentions 3, which isn't in that record/);
  assert.doesNotMatch(problems[0], /mentions 1/);
});

test("numbers: only the label word for word counts; a reworded one is still checked", () => {
  assert.match(numberProblems("No monitored beds for CTAS 1 or 2 arrivals", noBed, [], { labels: LABELS })[0], /mentions 1/);
});

test("claims: a quoted label passes in other wording too (statement, vignette, map, card)", () => {
  const text = "Records suggest long waits after rooming and no monitored bed for a CTAS 1 or 2 arrival.";
  assert.deepEqual(claimNumberProblems(text, [noBed], [], { labels: LABELS }), []);
  assert.match(claimNumberProblems(text, [noBed], [])[0], /mentions 1/);
  assert.match(claimNumberProblems(`${text} 7 patients left.`, [noBed], [], { labels: LABELS })[0], /mentions 7, which/);
});

// ---------- Issue 7: false alarms on years, timestamps, time ranges, map labels and category phrases ----------
// Seen in the saved runs (docs/eval, 2026-11-04 to 2026-11-10): none of these was a wrong figure.

const hourly = [15, 16, 17, 18].map((h) => ({ source_id: `HC-FLOW-20260920-${h}00`, source_type: "emr_flow", timestamp: `2026-09-20T${h}:00`, bed_occupancy: 0.93 }));
const at1500 = hourly[0];
const refused = (problems, pattern) => { assert.equal(problems.length, 1); assert.match(problems[0], pattern); };

test("year: a record's own year straight after its own date passes (September 20, 2026; 20 September 2026)", () => {
  for (const t of ["On September 20, 2026, occupancy was 93%.", "On Sept 20 2026 occupancy was 93%.", "On 20 September 2026 occupancy was 93%.", "On September 20th, 2026 occupancy was 93%."]) {
    assert.deepEqual(claimNumberProblems(t, hourly, none), [], t);
    assert.deepEqual(numberProblems(t, at1500, none), [], t);
  }
});

test("year: a year on its own, or another year after the date, is still refused", () => {
  refused(claimNumberProblems("2026 patients waited.", hourly, none), /mentions 2026, which/);
  refused(claimNumberProblems("On September 20, 2025, occupancy was 93%.", hourly, none), /mentions 2025, which/);
  refused(claimNumberProblems("In 2026 occupancy was 93%.", hourly, none), /mentions 2026, which/);
});

test("timestamp: a record's own timestamp written in full passes (2026-09-20T15:00); another one is refused", () => {
  assert.deepEqual(claimNumberProblems("Between 2026-09-20T15:00 and 2026-09-20T18:00 occupancy was 93%.", hourly, none), []);
  assert.deepEqual(numberProblems("At 2026-09-20T15:00 occupancy was 93%.", at1500, none), []);
  refused(claimNumberProblems("Between 2026-09-20T15:00 and 2026-09-20T19:00 occupancy was 93%.", hourly, none), /mentions 19, 0, which/);
});

test("time range: 'between 3 and 6 pm' is read as 3 pm and 6 pm, the records' own hours", () => {
  for (const t of ["Between 3 and 6 pm occupancy was 93%.", "From 3 to 6 p.m. occupancy was 93%.", "From 3-6 PM occupancy was 93%.", "From 3 – 6pm occupancy was 93%."]) {
    assert.deepEqual(claimNumberProblems(t, hourly, none), [], t);
  }
});

test("time range: an hour that isn't a cited record's is still refused, and so is a range of anything else", () => {
  refused(claimNumberProblems("Between 3 and 9 pm occupancy was 93%.", hourly, none), /mentions 9, which/);
  refused(claimNumberProblems("Between 1 and 6 pm occupancy was 93%.", hourly, none), /mentions 1, which/);
  refused(claimNumberProblems("Between 3 and 6 patients waited.", hourly, none), /mentions 3, 6, which/);
});

test("map labels: a label may end with its cited record's own ID numbers, date or time", () => {
  const own = { ownIdNumbersAtEnd: true };
  for (const t of ["Flow Record 1500", "Flow data at 1500", "Flow data 2026-09-20 1500", "Flow Record 20260920-1500", "Flow record (1500)"]) {
    assert.deepEqual(claimNumberProblems(t, [at1500], none, own), [], t);
  }
  assert.deepEqual(claimNumberProblems("Complaint 4471", [complaint], none, own), []);
  assert.deepEqual(claimNumberProblems("Incident report 99102", [noBed], none, own), []);
});

test("map labels: the same numbers anywhere else in the label, or another record's, are still refused", () => {
  const own = { ownIdNumbersAtEnd: true };
  refused(claimNumberProblems("1500 patients waiting", [at1500], none, own), /mentions 1500, which/);
  refused(claimNumberProblems("4471 patients", [complaint], none, own), /mentions 4471, which/);
  refused(claimNumberProblems("Flow Record 1600", [at1500], none, own), /mentions 1600, which/);
  refused(claimNumberProblems("Permit Data 3", [{ source_id: "EN-PERMIT-20260920-0900", source_type: "permit_log", timestamp: "2026-09-20T09:00", active_permits: 14 }], none, own), /mentions 3, which/);
  refused(claimNumberProblems("Near-Miss Report 1", [nearMiss], none, own), /mentions 1, which/);
});

test("map labels: without the setting (findings, statements, claims, the card), ID numbers are refused as before", () => {
  refused(claimNumberProblems("Flow Record 1500", [at1500], none), /mentions 1500, which/);
  refused(numberProblems("Complaint 4471", complaint, none), /mentions 4471, which/);
});

test("map labels: with numbers by reference on, nothing changes (times and dates are written as references there)", () => {
  assert.equal(claimNumberProblems("Flow data 2026-09-20 1500", [at1500], none, { ownIdNumbersAtEnd: true, byReference: true }).length, 1);
});

const HEALTHCARE = {
  safety_relevant_conditions: [
    { id: "no_monitored_bed_acute", label: "No monitored bed for a CTAS 1 or 2 arrival", category_phrases: ["CTAS 1 or 2"], text_groups: [["monitored bed"], ["no available"], ["CTAS 1", "CTAS 2"]] },
    { id: "long_wait_after_rooming", label: "Waits after rooming over 60 minutes", metric: "room_to_physician_minutes", op: ">", value: 60 },
  ],
};
const HITS = [{ id: "no_monitored_bed_acute", label: "No monitored bed for a CTAS 1 or 2 arrival", source_ids: ["HC-INC-99102"] }];

test("category phrases: offered only for a record matched to that same safety condition", () => {
  assert.deepEqual(categoryPhrasesFor([noBed], HITS, HEALTHCARE), ["CTAS 1 or 2"]);
  assert.deepEqual(categoryPhrasesFor([complaint, noBed], HITS, HEALTHCARE), ["CTAS 1 or 2"]);
  assert.deepEqual(categoryPhrasesFor([complaint], HITS, HEALTHCARE), [], "another record");
  assert.deepEqual(categoryPhrasesFor([noBed], [], HEALTHCARE), [], "no record was matched to the condition");
  assert.deepEqual(categoryPhrasesFor([noBed], HITS, { safety_relevant_conditions: [{ id: "no_monitored_bed_acute" }] }), [], "no phrases listed");
});

test("category phrases: 'CTAS 1 or 2 patients' passes on the matched record; 'CTAS 1 patient' is still checked", () => {
  const labels = [...LABELS, ...categoryPhrasesFor([noBed], HITS, HEALTHCARE)];
  assert.deepEqual(numberProblems("No monitored beds for CTAS 1 or 2 patients", noBed, none, { labels }), []);
  assert.deepEqual(claimNumberProblems("CTAS 1 or 2 patient", [noBed], none, { labels }), []);
  refused(numberProblems("No monitored bed for a CTAS 1 patient", noBed, none, { labels }), /mentions 1, which/);
});

test("category phrases: on a record that wasn't matched, 'CTAS 1 or 2' is checked like any other numbers", () => {
  const labels = [...LABELS, ...categoryPhrasesFor([complaint], HITS, HEALTHCARE)];
  refused(numberProblems("CTAS 1 or 2 patients waited 85 minutes", complaint, none, { labels }), /mentions 1, 2, which/);
});
