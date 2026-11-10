# Step 1: Tests and scorecard for the Signals engine

Status: **design approved 2026-11-04; answer key is a draft awaiting founder review**

## Why

Before changing how the Signals engine works, we need a way to tell whether a change made
it better or worse. Today there are no saved tests, and each benchmark has been run once by
hand. This step adds a safety net (tests for every rule enforced in code) and a scorecard
(repeated real runs scored against an answer key).

The founder's goals for the engine, in priority order:

- **A. Never make things up.** Every claim traces to a real record. (Key.)
- **B. Consistency.** The same records give the same result.
- **C. Catch what matters.** Find the patterns an experienced leader would.
- **D. Visible reasoning.** Show why something was flagged.

This step measures A (at the citation level), B and parts of C. It changes none of them.

## Scope

**In scope:** the Signals engine (`records.js`, `pipeline.js`, `llm.js`, `threads.js`,
`notify.js`, `monitor.js` and the prompts and schemas).

**Out of scope:**

- Any change to how Threadline behaves. If writing a test reveals a bug, write the test,
  mark it as an expected failure with a note, and list the bug. Don't fix it in this step.
- The chat side (Standard, Focus, Review, Find gaps).
- New dependencies. Use Node's built-in test runner (`node --test`) and built-in `fetch`.
- The existing benchmark packs in `data/benchmarks/`. They stay unchanged so the
  2026-09-28 results remain comparable.

## Part 1: Tests (no model needed)

Location: `tests/`. Command: `npm test` (add a `test` script running `node --test tests/`).
Every test uses a stand-in for the model (the existing `ask` parameter), so the whole suite
runs in seconds without Ollama.

Cover at least:

1. **Schema check** (`validateAgainstSchema`): valid output passes; a wrong enum, a missing
   field, an extra field and a wrong type each fail with a readable message; an unknown
   schema rule throws.
2. **Source guard** (`guardSources`): invented `source_id`s, `evidence_id`s and
   `policy_source_id`s are removed and logged; a claim left with no sources becomes "Inferred".
3. **Name and blame scanner** (`findGuardrailProblems`): catches "Dr. Patel", "RN J. Miller",
   "J. Miller", "at-risk behaviour", "reckless"; does NOT flag "Inspector Capacity",
   "Charge Nurse", "Operator Workload" or "U.S. Standards".
4. **Retry behaviour** (`runStep`): a bad first answer gets exactly one retry that lists the
   problems; a second bad answer raises `StepError`.
5. **Triggers** (`findTriggeredWindows`, `qualitativeNear`, `policiesFor`) on the evaluation
   packs: windows match `data/eval/answer-key.json`; records listed under
   `code_must_exclude_from_inputs` are excluded; decoys inside the window are included.
6. **Safety conditions** (`safetyConditionsIn`): the expected condition ids are found for
   each pack.
7. **Confidence rules** (`maxConfidence`, and the caps in `runPipeline`): model says High on
   one window, code lowers it to Medium and logs it; recommendation can't exceed pattern
   confidence; no library evidence forces Low and "No library evidence".
8. **Options checks**: a missing "Learn more" option triggers a retry; individual-monitoring
   wording is rejected.
9. **Review card**: must begin "Threadline noticed"; 80-word limit; evidence badge and
   confidence are overwritten from code.
10. **Thread lifecycle** (`threads.js`): the pipeline can only set Inferred or Flagged;
    decisions are refused until "Validated pattern"; role gates hold. Include a test that
    documents the "Decision recorded" status being skipped (expected failure, see Follow-ups).
11. **Alerts** (`notify.js`): daily flag cap, over-cap items go to the digest, the cap resets
    the next day.
12. **Update runs**: a second healthcare file updates the existing Thread instead of creating
    a new one.

Tests must not read or write the app's real data folder.

## Part 2: Evaluation packs and answer key

- `data/eval/decoys/healthcare/` and `data/eval/decoys/energy/`: extra synthetic records.
  Each has an `eval_role`:
  - `decoy_unrelated`: inside the time window, but has nothing to do with the pattern. It
    must never be cited.
  - `possible_confounder`: might be related, but its significance is unclear. It must not be
    cited as support; mentioning it as "possibly related, significance unclear" is fine.
  - `counter_evidence`: points the other way. It shouldn't be cited as support, and ideally
    appears under "evidence that does not fit".
  - `excluded_outside_window` / `excluded_other_location`: code must keep these out of the
    model's inputs entirely.
- An evaluation pack = the matching benchmark files + its decoy files.
- `data/eval/answer-key.json`: what a correct result looks like, split into `hard` checks
  (pass/fail) and `soft` checks (reported only). **It is a draft until the founder approves
  it.** Changes to it always need the founder's approval, because it encodes clinical and
  operational judgement.
- The record loader must ignore the extra `eval_role` field everywhere except the scorer,
  and it must never be shown to the model.

## Part 3: Scorecard script

Command: `npm run eval -- [--pack healthcare|energy|all] [--runs 3] [--model command-r]`
Location: `scripts/evaluate.js`. Runs in Node outside the app, against local Ollama, using
the real `runPipeline` and the settings in `src/config.js` (the model can be overridden).

For each pack it loads the evaluation pack, finds windows, runs the pipeline `runs` times
(the healthcare pack is followed by the `healthcare_update` run each time), and scores every
run against the answer key. It never writes to the app's data folder.

### What it reports

Per pack:

| Measure | Meaning |
| --- | --- |
| Hard pass rate | Share of runs passing every hard check. |
| Required citations found | Share of `must_cite` items cited, across runs. |
| Decoy citations | Number of times a decoy was cited (target: 0). |
| Counter-evidence acknowledged | Share of runs that mention it under "does not fit" (soft). |
| Confidence agreement | Share of runs giving the most common pattern confidence. |
| Citation agreement | Average overlap (Jaccard) of the pattern's cited ids between runs. |
| Leading option agreement | Share of runs whose recommended option has the same type. |
| Retries / code adjustments | Average per run, by step. |
| Step errors | Count, with the messages. |
| Seconds per run | Average and slowest. |
| Findings checked against their source | Reported as "not checked yet (step 2)". |

### Output

`docs/eval/<YYYY-MM-DD>/`:

- `scorecard.md`: the tables above, plain language, plus every failed hard check with the
  run number and what went wrong.
- `runs/<pack>-<n>.json`: the full pipeline output and code-check log for each run.
- `settings.json`: model, temperatures, number of runs, git commit, answer-key status.

If Ollama isn't running, stop at the start with a clear message.

## Done when

1. `npm test` passes without Ollama (expected failures clearly marked and listed).
2. `npm run eval -- --runs 1` completes on both packs on the founder's Mac.
3. A first **baseline** scorecard (default 3 runs) is saved and committed.
4. `README.md` explains both commands in plain language, and corrects the two things the
   status report found out of date (what a cloud switch involves; `getModelResponse` options).

## Follow-ups (not in this step)

Small fixes, each with a test written first, after the baseline exists:

- Model calls have no timeout.
- A garbled streaming line gives a raw parser error; an empty reply may be saved.
- "Decision recorded" is immediately replaced by "Outcome review due".
- Signals schemas allow only Healthcare and Energy, while House rules allow new domains.

Engine idea from founder review (2026-11-04), for a later step: give the pattern output a
third evidence group, **"possible confounders / unknown significance"**, alongside
supporting evidence and evidence that does not fit, so uncertain records are shown
honestly instead of being forced into one side.

Founder decision (2026-11-04), for a later step: a **recurrence marker** shown beside
confidence, e.g. "Medium confidence, seen on 2 occasions". Confidence keeps its three
levels and its rule; recurrence is a separate count from code (number of windows). Frequent
recurrence should count as a factor even at Low or Medium confidence: it should raise the
Thread's priority and can trigger a flag for review. Settled (2026-11-04): recurrence
never changes the confidence label. It raises priority and can trigger a flag, so a person
decides. "Low confidence, seen on 5 occasions" means: this keeps happening and nobody has
confirmed why yet.

Then step 2 (check every finding against its source record) and step 3 (consistency tuning),
both measured by this scorecard.
