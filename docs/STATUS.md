# Threadline status (2026-11-10)

A one-page summary for picking the work back up. Pull request #1 (`verify-card-map`) was merged
into `main` on 2026-11-09. Current branch: `safety-record-not-fit`, pushed, **not merged** (the
founder decides). All data is synthetic.

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
- **Tests and scorecard:** 272 saved tests (`npm test`, no AI needed). `npm run eval` runs the
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

On branch `safety-record-not-fit` (healthcare; energy re-scored once in `2026-11-09-2`, unchanged):

| | `2026-11-09` (not-fit rule, `4c61cab`) | `2026-11-10` (plus the label fix, `43b0bfa`) |
| --- | --- | --- |
| Healthcare pack: hard pass | 1 of 3 | **3 of 3** |
| Healthcare update: hard pass | 3 of 3 | 3 of 3 |
| HC-INC-99102 cited (pack and update) | 4 of 6 | **6 of 6** |
| First answer listed it as not fitting (pack) | 2 of 3 | 3 of 3 |
| Rule asked, model moved it into support | 2 of 2 | 3 of 3 |
| That finding then removed by the numbers check | 2 of 2 | **0 of 3** |
| Retries per run (pack / update) | 2.7 / 2.7 | 2.7 / 2.7 |
| Time per run | about 14–16 minutes | about 13–16 minutes |

## Open issues

1. ~~**HC-INC-99102 not cited**~~ **Fixed on branch `safety-record-not-fit`** (cited in 6 of 6
   healthcare runs in `2026-11-10`), in three steps. (i) `2b7fbdf`: the pattern prompt says a
   record describing a safety-relevant condition supports the pattern. (ii) `4c61cab`: when such
   a record is listed under "evidence that does not fit", the model gets one retry; if that
   doesn't fix it, the answer is accepted as the model wrote it and noted in the brief and on
   the scorecard (code never moves a record into support). (iii) `43b0bfa`: a safety-relevant
   condition's label quoted word for word is no longer checked for numbers, because the model
   words the finding as "No monitored bed for a CTAS 1 or 2 arrival" and the record has no "1"
   (in `2026-11-09` that removed the finding in 2 of 3 runs, after the retry had been used).
   Worth knowing: the model's first answer still lists HC-INC-99102 as not fitting often (3 of 3
   pack runs in `2026-11-10`), so the retry in (ii) is doing the work every time. Still open
   from `2b7fbdf`: "evidence that does not fit" entries are bare record IDs with no reason; and
   a reworded label ("CTAS 1 or 2 patient", in map and pressure-map wording) is still refused by
   the numbers check: see issue 7.
2. **"Learn more" options:** the model sometimes leaves one out, even after a retry, and the step
   stops. The file stays in the incoming folder and is retried.
3. **Records that don't fit:** the compliment HC-CMP-4475 is named in every healthcare run, and
   the good catch EN-INC-20260920-06 in every energy run (`2026-11-05-3`, `2026-11-05-4`).
4. **Update runs** usually describe only the first time window in the pattern text, though both
   windows are cited.
5. **The leading option varies between runs** (33–67% agreement), while confidence agrees 100%.
6. **Speed:** about 12–22 minutes per run, slower than the original 7–8 minutes, because of the
   extra checks and retries.
7. **The numbers check can be too strict** on times, dates and labels: it removed "Flow Record
   1500" and "Flow data 2026-09-20 1500" map labels (again in `2026-11-10`), the year in
   "September 20, 2026", "3" in "between 3 and 6 pm", and "CTAS 1 or 2 patient" (a reworded
   safety label; only the label word for word is allowed). Design to come when the founder asks.
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

1. The founder decides whether to merge `safety-record-not-fit` into `main` (no pull request
   is open for it yet).
2. Later, when the founder asks: a design for issue 7.
3. Still not done: the app walkthrough (issue 10).
