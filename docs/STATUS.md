# Threadline status (2026-11-09)

A one-page summary for picking the work back up. Branch: `verify-card-map` (draft pull request
<https://github.com/i-am-m-e/threadline/pull/1>). All data is synthetic.

## What's built

- **Chat (Standard, Focus, Review modes):** ask questions across attached documents; every answer
  cites numbered passages, and citations draw lines back to their source. Gap analysis compares
  policy (Authoritative) with what happened (Observed), with house rules matched in code.
- **Signals mode (v3.2):** watches synthetic flow, incident and complaint records. When a trigger
  fires, four prompts run (pattern → system analysis → options → review card), each forced into a
  JSON format and checked in code. The result is a **Thread** with a front-line review card, a
  manager brief and a Thread map. People decide, by role. Threadline can only mark a Thread
  Inferred or Flagged, and never applies anything.
- **Checks against the records:** findings must quote or match the record they cite; numbers must
  appear in the records; map items and card wording are checked; unverified items are removed and
  listed. Also: no names of people, no behaviour labels, every time window cited, rationales of
  two sentences or fewer, and a finding that claims a safety-relevant condition must cite a record
  that describes it.
- **Recurrence:** counts how often a pattern has been seen, and flags it for review at 10+
  occasions.
- **Tests and scorecard:** 255 saved tests (`npm test`, no AI needed). `npm run eval` runs the
  benchmark packs through the real model and writes a scorecard to `docs/eval/<date>/`.
- **Switches, off by default:** "numbers by reference" (the model writes figures as references and
  code fills in the values) and the stricter "Learn more" check.

## Latest scorecard results (Command R, 3 runs per pack, numbers by reference off)

| | `2026-11-04-4` (before `2b7fbdf`) | `2026-11-05` and `-2` (after `2b7fbdf`) | `2026-11-05-3` and `-4` (after `f98c201`) |
| --- | --- | --- | --- |
| Healthcare pack: hard pass | 2 of 3 | 3 of 3 | 2 of 3 |
| Healthcare update: hard pass | 2 of 3 (1 step error: no "Learn more" option) | 3 of 3 | 3 of 3 |
| Energy pack: hard pass | 3 of 3 | 3 of 3, but see issue 11 | 3 of 3 |
| HC-INC-99102 cited (pack and update) | 2 of 3 (pack) | 6 of 6 | 5 of 6 |
| Good-catch EN-INC-20260920-06 cited as support | 1 of 3 | 3 of 3 | **0 of 3** |
| Good-catch named as not fitting | 1 of 3 | 0 of 3 | **3 of 3** |
| Time per run | about 12–17 minutes | about 13–22 minutes | about 15–21 minutes |

Commit `2b7fbdf` changed the pattern prompt to say that a record describing a safety-relevant
condition supports the pattern. It made HC-INC-99102 cited far more often (issue 1), but made
issue 11 happen in every energy run. Commit `f98c201` added a code check that fixed issue 11.

## Open issues

1. **HC-INC-99102 not cited: mostly fixed** by `2b7fbdf`. Cited in 6 of 6 healthcare runs in
   `2026-11-05`, and in 5 of 6 in `2026-11-05-3`: in run 1 of the healthcare pack the model's
   first answer listed it under "evidence that does not fit" (the original problem, 1 run in 3).
   The check from `f98c201` never fired in healthcare, so it didn't cause this. Next: a design
   for a matching check (a record that describes a safety-relevant condition, listed as not
   fitting, gets one retry). Side effects of `2b7fbdf`: (a) the model now often copies the
   condition's label ("No monitored bed for a CTAS 1 or 2 arrival") into its own wording, which
   led to extra retries; (b) in one update run of `2026-11-05` the Sept 22 window had no cited
   record; (c) "evidence that does not fit" entries are now bare record IDs, with no reason given.
2. **"Learn more" options:** the model sometimes leaves one out, even after a retry, and the step
   stops. The file stays in the incoming folder and is retried.
3. **Records that don't fit:** the compliment HC-CMP-4475 is named in every healthcare run, and
   the good catch EN-INC-20260920-06 in every energy run (`2026-11-05-3`, `2026-11-05-4`).
4. **Update runs** usually describe only the first time window in the pattern text, though both
   windows are cited.
5. **The leading option varies between runs** (33–67% agreement), while confidence agrees 100%.
6. **Speed:** about 12–22 minutes per run, slower than the original 7–8 minutes, because of the
   extra checks and retries.
7. **The numbers check can be too strict** on times and dates: it removed "Flow Record 1500" map
   labels (again in `2026-11-05-3`), the year in "September 20, 2026", and "3" in "between 3 and
   6 pm". Design to come when the founder asks.
8. **Duplicate citation:** every healthcare run cites HC-FLOW-20260920-1500 twice. This is harmless,
   and the fix is deferred to its own change.
9. **Numbers by reference:** not yet clearly better on this model. It stays off.
10. **App walkthrough** (step 5 of `docs/TESTING-ON-MAC.md`) hasn't been done yet.
11. ~~**Good-catch report cited as support**~~ **Fixed** by `f98c201`. In `2026-11-05-2` the
    model cited EN-INC-20260920-06 in all 3 energy runs for "Work started before zero-energy
    verification"; the record says the crew did not begin work until sign-off was complete. The
    quote check couldn't see it (the quote was copied exactly). Now a finding that claims a
    word-based safety-relevant condition must cite a record that describes it: one retry, then
    the finding is removed. In `2026-11-05-4` the check caught the citation on the first answer
    in all 3 runs, and each retry fixed it: never cited as support, named as not fitting 3 of 3,
    nothing removed, retries unchanged at 2.0 per run. The answer key also forbids citing it as
    support now (founder decision 2026-11-05). Known limit, accepted: the matching is on words,
    so a negative finding ("work was not started before…") counts as a claim too. The
    prompt-wording change wasn't needed.

## Next steps

1. The founder approved merging pull request #1 into `main` on 2026-11-09.
2. On a new branch from `main`: a short design (no code) for the issue 1 check, tried on all
   saved runs first, for the founder to approve.
3. Later, when the founder asks: a design for issue 7.
