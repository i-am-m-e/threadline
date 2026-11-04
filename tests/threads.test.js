// Thread status rules (spec section 10): only people move a Thread past Flagged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pipelineStatus, sendForValidation, confirmPattern, recordDecision, startOutcomeReview, closeWithOutcome } from "../src/threads.js";
import { readJson, clone } from "./helpers.js";

const NOW = new Date("2026-11-04T12:00:00Z");
function freshThread() {
  const t = clone(readJson("docs/test-results/2026-09-28/rooming-thread.json"));
  Object.assign(t, { status: "Inferred", decision: null, outcome: null, history: [] });
  return t;
}

test("the pipeline can't set any status past Flagged", () => {
  assert.throws(() => pipelineStatus(freshThread(), "Under review", "x", NOW), /may only set Inferred or Flagged/);
});

test("a decision can't be recorded before the pattern is validated", () => {
  assert.throws(() => recordDecision(freshThread(), "Manager", "O1", NOW), /once a front-line lead has validated/);
});

test("roles gate the buttons", () => {
  assert.throws(() => sendForValidation(freshThread(), "Front-line lead", NOW), /for the Manager role/);
  const t = freshThread();
  sendForValidation(t, "Manager", NOW);
  assert.throws(() => confirmPattern(t, "Manager", NOW), /for the Front-line lead role/);
});

test("the full path from Inferred to Closed works with the right roles", () => {
  const t = freshThread();
  sendForValidation(t, "Manager", NOW);
  confirmPattern(t, "Front-line lead", NOW);
  recordDecision(t, "Manager", "O1", NOW);
  startOutcomeReview(t, "Manager", NOW);
  closeWithOutcome(t, "Manager", { whatHappened: "Tracked for two weeks.", helped: "Partly" }, NOW);
  assert.equal(t.status, "Closed");
  assert.equal(t.decision.option_id, "O1");
});

test('"Decision recorded" is a status a person can see after recording a decision', () => {
  const t = freshThread();
  sendForValidation(t, "Manager", NOW);
  confirmPattern(t, "Front-line lead", NOW);
  recordDecision(t, "Manager", "O1", NOW);
  assert.equal(t.status, "Decision recorded");
  assert.ok(t.outcome_review_due, "the review date is set when the decision is recorded");
});

test("only a Manager pressing \"Start outcome review\" moves a decision on to its outcome review", () => {
  const t = freshThread();
  sendForValidation(t, "Manager", NOW);
  confirmPattern(t, "Front-line lead", NOW);
  recordDecision(t, "Manager", "O1", NOW);
  assert.throws(() => startOutcomeReview(t, "Front-line lead", NOW), /for the Manager role/);
  assert.throws(() => closeWithOutcome(t, "Manager", { whatHappened: "x", helped: "Yes" }, NOW), /can't move/);
  startOutcomeReview(t, "Manager", NOW);
  assert.equal(t.status, "Outcome review due");
  assert.equal(t.history.at(-1).by, "Manager");
});
