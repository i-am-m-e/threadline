# Signals v3.2 — test results (2026-09-28)

Model: Command R (local, via Ollama). All data synthetic. Threads were created **inside the
app** ("Run benchmark packs", then "Add test flow file" + "Check now"); the no-evidence case was
run through the same pipeline code outside the app with an empty evidence library.

Files here:

- `rooming-thread.json` — the healthcare Thread, including **every step's JSON for both runs**
  (run 1 = benchmark pack, run 2 = after `EHR_Flow_2026-09-22.csv`), the code-check log, history
  and flag decision.
- `energy-thread.json` — the energy Thread.
- `no-evidence-run.json` — the healthcare pipeline with an empty evidence library.

## Checklist

| Check | Result | Notes |
| --- | --- | --- |
| All outputs pass schema validation | **Pass** | All 3 runs, all 4 steps. |
| Every source_id and evidence_id exists in its inputs | **Pass** | Source guard also tested with invented IDs (removed and logged). |
| No output names a person or classifies behaviour | **Pass** | Scanner catches "Dr. Patel", "RN J. Miller", "J. Miller", "at-risk behaviour", "reckless". |
| Review card ≤ 80 words, begins "Threadline noticed" | **Pass** | 65 words (healthcare), 65 words (energy). |
| ≥ 1 "Learn more" option; each states a pressure transfer | **Pass** | But see "Model weaknesses" — one run labelled a process change as "Learn more". |
| Single-afternoon benchmark is Low or Medium | **Pass** | Medium (1 window, 3 source types). Code caps confidence by the spec's definition. |
| Second rooming file updates the existing Thread | **Pass** | 1 healthcare Thread, 2 windows, 2 runs; update recorded in history. |
| Recommendation confidence ≤ pattern confidence | **Pass** | Enforced in code. |
| No evidence → "No library evidence" and Low | **Pass** | Model chose Medium; code lowered it to Low and logged it. |
| Flags respect the daily cap | **Pass** | 2 flags (cap 3), 1 digest item (the update). Cap behaviour (over-cap → digest, reset next day) verified by unit test. |
| Accept buttons disabled until validated | **Pass** | Enforced in `threads.js` (`recordDecision` refuses unless "Validated pattern") and in the UI; verified by unit test. |
| No status past Flagged without a button press | **Pass** | Threadline only ever set Inferred / Flagged; `pipelineStatus()` refuses anything else. |

## Problems found and fixed during testing

1. **Energy run failed on the name check**: "Inspector Capacity" (an option title) was treated as
   a person's name. The check was made precise (honorific or credential + name, initial + surname)
   without relaxing it.
2. **A failed step lost its file**: records were filed as processed before analysis, so after a
   failure they were ignored. Files are now filed only after success; failures stay in
   `incoming/` and Check now retries.
3. **"Learn more" omitted twice in one update run** (stochastic): the retry message now gives a
   concrete example. The next run passed first time.
4. **Folder buttons failed silently**: they now show errors.

## Model weaknesses (Command R) worth deciding on

- **Speed**: ~7–8 minutes per new Thread (Prompt 2 is the slowest: ~3–5 min).
- **Update runs under-use new evidence**: after the second rooming file, the pattern statement
  and badge still described only Sept 20. Possible fix: a code check that each window has at
  least one cited record.
- **"Learn more" gaming**: in run 2, "Match rooming pace to capacity" was typed "Learn more".
  Possible fix: require Learn-more options to be about gathering information (track, review,
  huddle), checked in code.
- **Rationale length**: rule 4 says ≤ 2 sentences; run 2 used 3. Possible fix: count sentences
  in code and retry.
- **Card specificity**: run 2's card had no figures ("high bed occupancy…"), vaguer than the
  spec's example card.

Options: add the code checks above; try a stronger local model for Prompts 2–3; or, later, a cloud
model (only `src/model.js` changes).
