// Tests for src/verify.js: checking that what the model says is really in the record it cites.
// Records here are the real benchmark records (all synthetic).
import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteProblem } from "../src/verify.js";

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
