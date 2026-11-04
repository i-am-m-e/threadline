# Step 1: Tests and Scorecard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a saved test suite for every rule the Signals engine enforces in code, plus a scorecard script that runs the real pipeline repeatedly on evaluation packs and scores it against the founder's answer key.

**Architecture:** Tests use Node's built-in runner and the existing `ask` stand-in, replaying model answers recorded on 2026-09-28. The scorecard drives the real `checkForSignals()` from `src/monitor.js` with an in-memory `io`, so evaluation follows exactly the app's path (new Thread, then update). Scoring is pure functions in `scripts/eval/`, tested on recorded output.

**Tech Stack:** Node 22 (built-in `node:test`, `node:assert`, `fetch`, `fs`), ES modules. No new dependencies.

**Spec:** `docs/specs/2026-11-04-step1-tests-and-scorecard.md`

## Global Constraints

- No new dependencies (`package.json` gains scripts only).
- No change to how Threadline behaves: nothing under `src/` changes. A bug found by a test is recorded with `{ todo: "<why>" }` and listed, not fixed.
- `data/benchmarks/`, `data/eval/answer-key.json` and `data/eval/decoys/` are read-only for this step.
- Tests and the scorecard never read or write the app's data folder.
- `eval_role` is stripped before records reach `checkForSignals`; it must never appear in a prompt.
- `npm test` must pass without Ollama.
- Scorecard output goes to `docs/eval/<YYYY-MM-DD>/`.

## Review Focus

- Ollama not running when `npm run eval` starts → stop before any run with "Couldn't reach Ollama…" (test in Task 6).
- One run fails with a `StepError` → that run is recorded as failed with its message; remaining runs and packs continue (test in Task 6).
- The update file creates a second Thread instead of updating → hard check `updates_existing_thread` fails with both Thread ids in the detail (test in Task 5).
- `eval_role` leaking into a prompt → asserted absent from every prompt in a replay run (test in Task 2).
- Answer key still marked `draft` → status printed at the top of the scorecard and in `settings.json` (test in Task 6).

---

### Task 1: Test harness and the model-check layer (`llm.js`)

**Files:**
- Modify: `package.json` (scripts only)
- Create: `tests/helpers.js`
- Test: `tests/llm.test.js`

**Interfaces:**
- Produces (in `tests/helpers.js`):
  - `readJson(relPath: string): any` (path relative to repo root)
  - `recordedSteps(name: "rooming" | "energy", run = 0): { pattern, analysis, options, card }` from `docs/test-results/2026-09-28/<name>-thread.json` (`runs[run].steps`)
  - `replayAsk(answers: object[]): { ask(messages, opts): Promise<string>, prompts: string[] }`: returns `JSON.stringify(answers[i])` per call in order and records each call's system prompt
  - `loadSchemas(): { pattern, analysis, options, reviewCard }` from `src/schemas/`
  - `clone(x)` (structuredClone)

- [ ] **Step 1:** In `package.json` add `"test": "node --test tests/"` and `"eval": "node scripts/evaluate.js"`.
- [ ] **Step 2: Write failing tests** in `tests/llm.test.js`:
  - `validateAgainstSchema`: recorded pattern passes (`[]`); `confidence: "Very high"` → message contains `is not one of Low, Medium, High`; missing `pattern_statement` → `missing "pattern_statement"`; extra field → `unexpected field`; number where string expected → `expected string`; schema with `pattern` rule throws `isn't supported`.
  - `guardSources`: item with `source_id: "HC-FAKE-1"` removed from `supporting_evidence`; `source_ids: ["HC-FAKE-1"]` with `trust_label: "Observed"` → `[]` and `"Inferred"`; invented `policy_source_id` → `""`; invented `evidence_ids` removed; each change appears in the returned list.
  - `findGuardrailProblems`: flags `"Dr. Patel"`, `"RN J. Miller"`, `"J. Miller"`, `"at-risk behaviour"`, `"reckless"`; returns `[]` for `"Inspector Capacity"`, `"Charge Nurse"`, `"Operator Workload"`, `"U.S. Standards"`.
  - `runStep` with `replayAsk`: bad-then-good → output returned, `prompts.length === 2`, retry message lists the problem; bad-then-bad → rejects with `StepError` whose `problems` is non-empty; non-JSON first answer → retry with `"The answer was not valid JSON."`.
- [ ] **Step 3:** Run `npm test`. Expected: failures only where helpers are missing.
- [ ] **Step 4:** Implement `tests/helpers.js`.
- [ ] **Step 5:** Run `npm test`. Expected: all pass.
- [ ] **Step 6:** Commit: `git add package.json tests && git commit -m "Step 1.1: test harness and model-check tests"`

### Task 2: Evaluation packs, triggers and safety conditions

**Files:**
- Create: `scripts/eval/packs.js`
- Test: `tests/records.test.js`, `tests/packs.test.js`

**Interfaces:**
- Consumes: `readJson` (Task 1).
- Produces (in `scripts/eval/packs.js`):
  - `loadAnswerKey(): object` (`data/eval/answer-key.json`)
  - `loadEvalPack(key: "healthcare" | "healthcare_update" | "energy", answerKey): { files: Array<{ name: string, text: string }>, roles: Map<string, string> }`. Expands each `files` glob (`dir/*` only), reads every file, removes `eval_role` from JSON records (recording it in `roles` by `source_id`), and returns file texts ready for `parseRecordFile`.
  - `loadRules()`, `loadEvidenceLibrary()`, `loadSchemas()` (move the Task 1 helper here and re-export it from `tests/helpers.js`).

- [ ] **Step 1: Write failing tests:**
  - `packs.test.js`: healthcare pack is 5 files holding 13 records, including all 5 decoys; no file text contains `eval_role`; `roles.get("HC-CMP-4480") === "possible_confounder"`; benchmark files on disk are byte-identical before and after loading.
  - `records.test.js` (for each of `healthcare`, `energy`, then `healthcare_update` on its own): `findTriggeredWindows` returns exactly the answer key's `expected_windows` (pattern_type, location, start, end); `qualitativeNear` excludes every id in `code_must_exclude_from_inputs` and includes every in-window decoy; `policiesFor` returns the answer key's `analysis_policy_source_id`; `safetyConditionsIn(window records + qualitative)` ids equal `expected_safety_conditions`.
  - Leak check: a full `runPipeline` on the healthcare pack with `replayAsk(recordedSteps("rooming"))` → no prompt contains `eval_role`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL, `scripts/eval/packs.js` missing.
- [ ] **Step 3:** Implement `scripts/eval/packs.js`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass. If a window or exclusion disagrees with the answer key, stop and report it to the founder; don't edit the key.
- [ ] **Step 5:** Commit: `"Step 1.2: evaluation packs and trigger tests"`

### Task 3: Pipeline rules enforced in code

**Files:**
- Test: `tests/pipeline.test.js`

**Interfaces:**
- Consumes: `replayAsk`, `recordedSteps`, `clone`, `loadEvalPack`, `loadRules`, `loadEvidenceLibrary`, `loadSchemas`.

Each test runs `runPipeline` on the healthcare evaluation pack's window, replaying recorded steps with one field changed:

- [ ] **Step 1: Write the tests:**
  - pattern `confidence: "High"` on one window → result `"Medium"`, log has a `pattern` entry containing `confidence High → Medium`.
  - pattern `domain: "Energy"` → corrected to `"Healthcare"` and logged.
  - pattern statement not starting `Records suggest` → one retry (replay supplies a fixed second answer).
  - options with no `"Learn more"` type → one retry whose message contains `"Learn more"`.
  - options text containing `monitor individual nurses` → retry message contains `Don't propose monitoring`.
  - recommendation `confidence: "High"` with pattern `"Medium"` → `"Medium"`.
  - empty evidence library → every option `evidence_strength: "None"`, `local_fit` starts `No library evidence`, recommendation `"Low"`.
  - card `noticed` not starting `Threadline noticed` → retry; card over 80 words → retry naming the count; `evidence_badge` and `confidence` overwritten from code.
- [ ] **Step 2:** Run `npm test`. Expected: all pass (these rules already exist). Any failure is a real finding: mark `{ todo }` with the reason and report it.
- [ ] **Step 3:** Commit: `"Step 1.3: pipeline rule tests"`

### Task 4: Thread lifecycle, alerts and the monitor

**Files:**
- Create: `scripts/eval/memoryIo.js`
- Test: `tests/threads.test.js`, `tests/notify.test.js`, `tests/monitor.test.js`

**Interfaces:**
- Produces: `memoryIo(): { io, put(files: Array<{name,text}>): void, threads(): object[] }`, an in-memory implementation of the `io` used by `checkForSignals` (`listIncoming`, `readIncoming`, `archiveIncoming`, `loadProcessedRecords`, `loadThreads`, `saveThread`). Archived files' records become "processed".

- [ ] **Step 1: Write the tests:**
  - `threads.test.js`: `pipelineStatus(t, "Under review")` throws; `recordDecision` before `"Validated pattern"` throws; Front-line lead can't `sendForValidation`, Manager can't `confirmPattern`; full path Inferred → Under review → Validated pattern → decision → Closed works with the right roles. `{ todo: "Decision recorded is replaced immediately by Outcome review due (threads.js:172-174)" }`: after `recordDecision`, history's last status is `"Decision recorded"`.
  - `notify.test.js`: with cap 3, a 4th qualifying Thread on the same day goes to the digest with `over_cap: true`; the next day it can flag; an already-flagged Thread is never flagged twice.
  - `monitor.test.js`: with `memoryIo` and `replayAsk`, putting the healthcare pack creates 1 Thread; then putting the `healthcare_update` file updates that Thread (still 1 Thread, 2 runs, an `update` history entry); a run whose replay throws leaves its files in incoming and reports the error.
- [ ] **Step 2:** Run `npm test`. Expected: all pass except the marked `todo`.
- [ ] **Step 3:** Implement `memoryIo` if the monitor tests need it to pass.
- [ ] **Step 4:** Commit: `"Step 1.4: lifecycle, alert and monitor tests"`

### Task 5: Scoring against the answer key

**Files:**
- Create: `scripts/eval/score.js`
- Test: `tests/score.test.js`

**Interfaces:**
- Produces:
  - `type Check = { id: string, pass: boolean, detail: string }`
  - `scoreRun({ packKey, answerKey, threads: object[], error?: string, seconds: number }): { packKey, hard: Check[], soft: Check[], passed: boolean, confidence?: string, citedIds: string[], leadingOptionType?: string, retries: number, adjustments: number, seconds, error? }`
    - Uses the latest run of the Thread matching the pack's expected `pattern_type` and `location`.
    - Hard check ids: `no_step_errors`, `pattern_must_cite_all`, `pattern_must_cite_at_least_one_of`, `must_not_cite_anywhere` (pattern `supporting_evidence`, analysis `source_ids` lists, `policy_practice_gap.policy_source_id`), `must_not_cite_as_support` (pattern `supporting_evidence` only), `analysis_policy_source_id`, `acceptable_pattern_confidence`, `expected_safety_conditions` (from `meta.safety_conditions`), `updates_existing_thread` (exactly one matching Thread with ≥ 2 runs), `status_never_past_flagged`, `no_person_names_or_blame_labels` (`findGuardrailProblems` on the final steps).
    - Soft check ids: `should_acknowledge_as_not_fitting` and `may_mention_as_possible_confounder` (any listed term, case-insensitive, in `evidence_that_does_not_fit` or `analysis.alternative_explanations`/`compounding_factors`), `pattern_text_mentions_second_window`.
    - `retries`: log entries with `type: "problems"`; `adjustments`: log entries with `type` other than `problems`.
  - `consistency(scored: ReturnType<typeof scoreRun>[]): { confidenceAgreement: number, citationAgreement: number, leadingOptionAgreement: number }` (each 0 to 1; share agreeing with the most common value; citation agreement = mean pairwise Jaccard of `citedIds`; 1 when fewer than 2 successful runs).

- [ ] **Step 1: Write failing tests** using the recorded rooming Thread (`docs/test-results/2026-09-28/rooming-thread.json`) as `threads`:
  - healthcare: `pattern_must_cite_all` passes; adding `{ source_id: "HC-INC-99110", ... }` to `supporting_evidence` fails `must_not_cite_anywhere` with the id in `detail`; adding `HC-CMP-4480` fails `must_not_cite_as_support`; mentioning "the parking complaint may be a possible confounder" in `evidence_that_does_not_fit` passes the soft confounder check.
  - `healthcare_update` with two matching Threads → `updates_existing_thread` fails and `detail` names both ids.
  - `error: "StepError..."` → `passed: false`, `no_step_errors` fails, no throw.
  - `consistency`: three runs with confidences `Medium, Medium, Low` → `confidenceAgreement` ≈ 0.667; identical cited sets → `citationAgreement === 1`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL, module missing.
- [ ] **Step 3:** Implement `scripts/eval/score.js`.
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `"Step 1.5: answer-key scoring"`

### Task 6: Scorecard runner and report

**Files:**
- Create: `scripts/eval/report.js`, `scripts/evaluate.js`
- Test: `tests/evaluate.test.js`

**Interfaces:**
- Consumes: `loadEvalPack`, `loadAnswerKey`, `loadRules`, `loadEvidenceLibrary`, `loadSchemas`, `memoryIo`, `scoreRun`, `consistency`, `checkForSignals` (`src/monitor.js`), `SIGNALS_CONFIG` (`src/config.js`).
- Produces:
  - `runEvaluation({ packs: string[], runs: number, model?: string, ask?: Function, outDir: string, now?: Date, checkOllama?: () => Promise<void> }): Promise<{ summary, scorecardPath }>`. Pack `"healthcare"` runs `healthcare` then `healthcare_update` on the same `memoryIo` each run; `"energy"` runs once per run; `"all"` = both. Each run uses a fresh `memoryIo`. Errors in a run are caught and scored, never thrown.
  - `renderScorecard(summary): string` (Markdown). First lines: date, model, temperatures, runs, git commit, `Answer key: draft` (from `answerKey.status`). Then per pack the measures table from the spec (including "Findings checked against their source: not checked yet (step 2)") and a list of every failed hard check as `Run <n>: <id>: <detail>`.
  - CLI `scripts/evaluate.js`: flags `--pack healthcare|energy|all` (default `all`), `--runs <n>` (default 3), `--model <id>` (default `SIGNALS_CONFIG.model`). Before running: `GET http://localhost:11434/api/tags`; on failure print `Couldn't reach Ollama. Is it running? (Try opening the Ollama app.)` and exit 1. Writes `scorecard.md`, `settings.json` and `runs/<pack>-<n>.json` (Threads + scored result) to `docs/eval/<YYYY-MM-DD>/`. Prints progress per step and the scorecard path.
- [ ] **Step 1: Write failing tests** (`ask` = replay of recorded steps, `outDir` = a temp dir, `checkOllama` stubbed):
  - `runEvaluation({ packs: ["healthcare"], runs: 2 })` writes `scorecard.md`, `settings.json`, `runs/healthcare-1.json`, `runs/healthcare-2.json`; the scorecard contains `Answer key: draft` and `not checked yet (step 2)`.
  - an `ask` that throws on run 1 only → run 1 listed as failed with the message, run 2 scored, no throw.
  - `checkOllama` rejecting → `runEvaluation` rejects with the Ollama message before calling `ask`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL, modules missing.
- [ ] **Step 3:** Implement `report.js` and `evaluate.js` (`runEvaluation` exported; CLI runs only when the file is executed directly).
- [ ] **Step 4:** Run `npm test`. Expected: all pass.
- [ ] **Step 5:** Commit: `"Step 1.6: scorecard runner"`

### Task 7: README

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Add a plain-language "Testing and the scorecard" section: what `npm test` checks (no Ollama needed); what `npm run eval` does, its flags, how long it takes (about 7 minutes per run with Command R), where results go; that the answer key holds the founder's judgement and changes need his approval.
- [ ] **Step 2:** Correct the two outdated statements: switching to a cloud model also needs an equivalent of Ollama's schema-constrained `format`; `getModelResponse` also takes `format` and `temperature`.
- [ ] **Step 3:** Run `npm test`. Expected: all pass.
- [ ] **Step 4:** Commit: `"Step 1.7: README for tests and scorecard"`

## Founder's part (on the Mac, after the build)

1. `npm test` (should pass in seconds).
2. `npm run eval -- --runs 1` as a quick check (about 15 minutes).
3. The baseline: `npm run eval` (3 runs, about 40 to 50 minutes), then commit `docs/eval/`.
