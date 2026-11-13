// Tests for src/signalsFormat.js: the plain words and small figures the Signals screens show
// (docs/specs/2026-11-12-signals-redesign.md, section 1). Everything here is worked out by code
// from the Thread and its records, never taken from the model's wording.
import { test } from "node:test";
import assert from "node:assert/strict";
import { whenText, plainTimes, updatedText, confidenceBars, occasionDots, statusLabel, TRUST_KINDS, trustKind } from "../src/signalsFormat.js";

const NOW = new Date("2026-11-12T13:00:00");

// ---------- 3. When it happened: plain words, never ISO timestamps ----------

test("when: a window on one afternoon reads 'Sep 20, 3 to 6 pm'", () => {
  assert.equal(whenText({ start: "2026-09-20T15:00", end: "2026-09-20T18:00" }, NOW), "Sep 20, 3 to 6 pm");
  assert.equal(whenText({ start: "2026-09-22T14:00", end: "2026-09-22T16:00" }, NOW), "Sep 22, 2 to 4 pm");
});

test("when: morning to afternoon names both halves of the day", () => {
  assert.equal(whenText({ start: "2026-09-20T07:00", end: "2026-09-20T11:00" }, NOW), "Sep 20, 7 to 11 am");
  assert.equal(whenText({ start: "2026-09-20T11:00", end: "2026-09-20T14:00" }, NOW), "Sep 20, 11 am to 2 pm");
});

test("when: noon and midnight are written as 12 pm and 12 am", () => {
  assert.equal(whenText({ start: "2026-09-20T12:00", end: "2026-09-20T13:00" }, NOW), "Sep 20, 12 to 1 pm");
  assert.equal(whenText({ start: "2026-09-20T00:00", end: "2026-09-20T02:00" }, NOW), "Sep 20, 12 to 2 am");
});

test("when: minutes are kept when the record has them", () => {
  assert.equal(whenText({ start: "2026-09-20T15:30", end: "2026-09-20T18:00" }, NOW), "Sep 20, 3:30 to 6 pm");
});

test("when: a window of a single hour shows that hour once", () => {
  assert.equal(whenText({ start: "2026-09-20T15:00", end: "2026-09-20T15:00" }, NOW), "Sep 20, 3 pm");
});

test("when: a window that runs past midnight names both days", () => {
  assert.equal(whenText({ start: "2026-09-20T22:00", end: "2026-09-21T01:00" }, NOW), "Sep 20, 10 pm to Sep 21, 1 am");
});

test("when: the year is added only when it isn't this year", () => {
  assert.equal(whenText({ start: "2025-12-30T15:00", end: "2025-12-30T18:00" }, NOW), "Dec 30, 2025, 3 to 6 pm");
});

test("when: a single moment (a record's time) reads 'Sep 20, 3:30 pm'", () => {
  assert.equal(whenText("2026-09-20T15:30", NOW), "Sep 20, 3:30 pm");
  assert.equal(whenText("2026-09-20", NOW), "Sep 20", "a date with no time");
});

test("when: something that isn't a time is left out rather than guessed", () => {
  assert.equal(whenText({ start: "soon", end: "later" }, NOW), "");
  assert.equal(whenText(undefined, NOW), "");
});

// ---------- 4. When it changed ----------

test("updated: recent changes are counted in minutes and hours", () => {
  assert.equal(updatedText("2026-11-12T12:59:40", NOW), "Updated just now");
  assert.equal(updatedText("2026-11-12T12:59:00", NOW), "Updated 1 minute ago");
  assert.equal(updatedText("2026-11-12T12:15:00", NOW), "Updated 45 minutes ago");
  assert.equal(updatedText("2026-11-12T12:00:00", NOW), "Updated 1 hour ago");
  assert.equal(updatedText("2026-11-12T11:00:00", NOW), "Updated 2 hours ago");
});

test("updated: older changes are counted in days, then given as a date", () => {
  assert.equal(updatedText("2026-11-11T09:00:00", NOW), "Updated yesterday");
  assert.equal(updatedText("2026-11-09T09:00:00", NOW), "Updated 3 days ago");
  assert.equal(updatedText("2026-11-05T09:00:00", NOW), "Updated Nov 5");
  assert.equal(updatedText("2025-11-05T09:00:00", NOW), "Updated Nov 5, 2025");
});

test("updated: a time in the future (a clock that is off) doesn't show a negative wait", () => {
  assert.equal(updatedText("2026-11-12T13:05:00", NOW), "Updated just now");
});

// ---------- 6. Confidence and 7. recurrence ----------

test("confidence: three bars, filled for Low 1, Medium 2, High 3; anything else shows none", () => {
  assert.deepEqual(confidenceBars("Low"), [true, false, false]);
  assert.deepEqual(confidenceBars("Medium"), [true, true, false]);
  assert.deepEqual(confidenceBars("High"), [true, true, true]);
  assert.deepEqual(confidenceBars("Unknown"), [false, false, false]);
});

test("occasions: one dot per occasion, with the count in words", () => {
  assert.deepEqual(occasionDots(1), { dots: 1, more: 0, text: "1 occasion" });
  assert.deepEqual(occasionDots(2), { dots: 2, more: 0, text: "2 occasions" });
  assert.deepEqual(occasionDots(0), { dots: 0, more: 0, text: "0 occasions" });
});

test("occasions: past 10, the dots stop and the words carry the count", () => {
  assert.deepEqual(occasionDots(10), { dots: 10, more: 0, text: "10 occasions" });
  assert.deepEqual(occasionDots(23), { dots: 10, more: 13, text: "23 occasions" });
});

// ---------- 5. Status and 8. source of a claim ----------

test("status: 'Flagged' reads 'Flagged for review'; the other statuses keep their names", () => {
  assert.equal(statusLabel("Flagged"), "Flagged for review");
  for (const s of ["Inferred", "Under review", "Validated pattern", "Not confirmed", "Decision recorded", "Outcome review due", "Closed"]) {
    assert.equal(statusLabel(s), s);
  }
});

test("source of a claim: every trust label has one look, and the unconfirmed ones are dashed", () => {
  assert.deepEqual(Object.keys(TRUST_KINDS), ["Observed", "Authoritative", "Suggested", "Experiential", "Inferred", "Historical"]);
  assert.deepEqual(trustKind("Observed"), { label: "Observed", className: "tag-observed", dashed: false, means: "From the records" });
  assert.equal(trustKind("Authoritative").means, "From policy");
  assert.equal(trustKind("Experiential").means, "Staff input");
  assert.equal(trustKind("Suggested").dashed, true);
  assert.equal(trustKind("Inferred").dashed, true);
});

test("source of a claim: an unknown label is shown as Inferred (unconfirmed), never as a record", () => {
  assert.deepEqual(trustKind("Made up"), { ...trustKind("Inferred"), label: "Made up" });
});

// ---------- Model-written text: ISO timestamps shown in plain words, at display time ----------

test("plain times: a timestamp in a sentence reads 'Sep 20, 3 pm'", () => {
  assert.equal(plainTimes("Waits rose from 2026-09-20T15:00 onwards.", NOW), "Waits rose from Sep 20, 3 pm onwards.");
  assert.equal(plainTimes("At 2026-09-20T15:30 a patient left.", NOW), "At Sep 20, 3:30 pm a patient left.");
});

test("plain times: two timestamps on the same day read as one window", () => {
  assert.equal(
    plainTimes("Records suggest that between 2026-09-20T07:00 and 2026-09-20T11:00, there was a backlog.", NOW),
    "Records suggest that between Sep 20, 7 and 11 am, there was a backlog."
  );
  assert.equal(plainTimes("From 2026-09-20T11:00 to 2026-09-20T14:00 waits rose.", NOW), "From Sep 20, 11 am to 2 pm waits rose.");
  assert.equal(plainTimes("Slow from 2026-09-20T15:00–2026-09-20T18:00.", NOW), "Slow from Sep 20, 3 to 6 pm.");
});

test("plain times: timestamps on different days each keep their date", () => {
  assert.equal(plainTimes("Between 2026-09-20T22:00 and 2026-09-21T02:00.", NOW), "Between Sep 20, 10 pm and Sep 21, 2 am.");
});

test("plain times: seconds and a trailing Z are dropped; the time is read as written", () => {
  assert.equal(plainTimes("Logged 2026-09-20T15:00:00.000Z.", NOW), "Logged Sep 20, 3 pm.");
  assert.equal(plainTimes("Logged 2026-09-20T15:05:09.", NOW), "Logged Sep 20, 3:05 pm.");
});

test("plain times: a date on its own reads 'Sep 20'; another year keeps its year", () => {
  assert.equal(plainTimes("On 2026-09-20, occupancy was high.", NOW), "On Sep 20, occupancy was high.");
  assert.equal(plainTimes("Since 2025-12-30T15:00.", NOW), "Since Dec 30, 2025, 3 pm.");
});

test("plain times: record IDs and file names that contain a date are left alone", () => {
  for (const s of ["See VIG-2026-09-20-1.", "From EHR_Flow_2026-09-20.csv and HC-INC-99102.", "Run 2026-09-20-2 of the day."]) {
    assert.equal(plainTimes(s, NOW), s);
  }
});

test("plain times: things that aren't real dates or times, and text without any, are unchanged", () => {
  for (const s of ["Between 3:00 and 6:00 p.m., bed occupancy remained high.", "Code 2026-13-45T25:99 is odd.", ""]) {
    assert.equal(plainTimes(s, NOW), s);
  }
  assert.equal(plainTimes(undefined, NOW), "");
});
