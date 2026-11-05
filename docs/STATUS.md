# Threadline status (2026-11-05)

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
  two sentences or fewer.
- **Recurrence:** counts how often a pattern has been seen, and flags it for review at 10+
  occasions.
- **Tests and scorecard:** 247 saved tests (`npm test`, no AI needed). `npm run eval` runs the
  benchmark packs through the real model and writes a scorecard to `docs/eval/<date>/`.
- **Switches, off by default:** "numbers by reference" (the model writes figures as references and
  code fills in the values) and the stricter "Learn more" check.

## Latest scorecard results (Command R, 3 runs per pack, numbers by reference off)

| | `2026-11-04-4` (before `2b7fbdf`) | `2026-11-05` and `2026-11-05-2` (after `2b7fbdf`) |
| --- | --- | --- |
| Healthcare pack: hard pass | 2 of 3 | 3 of 3 |
| Healthcare update: hard pass | 2 of 3 (1 step error: no "Learn more" option) | 3 of 3 |
| Energy pack: hard pass | 3 of 3 | 3 of 3, **but see issue 11** |
| HC-INC-99102 cited | 2 of 3 | 6 of 6 (pack and update) |
| Good-catch EN-INC-20260920-06 cited as support | 1 of 3 | **3 of 3** |
| Time per run | about 12–17 minutes | about 13–22 minutes |

Commit `2b7fbdf` changed the pattern prompt to say that a record describing a safety-relevant
condition supports the pattern. It fixed HC-INC-99102 (issue 1), but made issue 11 happen in
every energy run.

## Open issues

1. ~~**HC-INC-99102 not cited**~~ **Fixed** by `2b7fbdf` (cited in 6 of 6 healthcare runs in
   `2026-11-05`). Side effects: (a) the model now often copies the condition's label ("No
   monitored bed for a CTAS 1 or 2 arrival") into its own wording, which led to extra retries;
   (b) in one update run the Sept 22 window had no cited record; (c) "evidence that does not fit"
   entries are now bare record IDs, with no reason given. Also see issue 11.
2. **"Learn more" options:** the model sometimes leaves one out, even after a retry, and the step
   stops. The file stays in the incoming folder and is retried.
3. **Records that don't fit:** the compliment HC-CMP-4475 is now named in every healthcare run
   (`2026-11-05`). EN-INC-20260920-06 is named in none of the energy runs: see issue 11.
4. **Update runs** usually describe only the first time window in the pattern text, though both
   windows are cited.
5. **The leading option varies between runs** (33–67% agreement), while confidence agrees 100%.
6. **Speed:** about 12–22 minutes per run, slower than the original 7–8 minutes, because of the
   extra checks and retries.
7. **The numbers check can be too strict:** it removed "Flow Record 1500" map labels and the year
   in "September 20, 2026" (again in `2026-11-05-2`, run 2). Not yet looked into.
8. **Duplicate citation:** every healthcare run cites HC-FLOW-20260920-1500 twice. This is harmless,
   and the fix is deferred to its own change.
9. **Numbers by reference:** not yet clearly better on this model. It stays off.
10. **App walkthrough** (step 5 of `docs/TESTING-ON-MAC.md`) hasn't been done yet.
11. **Good-catch report cited as support (new, `2026-11-05-2`).** In all 3 energy runs the model
    cited EN-INC-20260920-06 as supporting evidence, with the finding "Work started before
    zero-energy verification". The record says the opposite: the crew waited and did not begin
    work until sign-off was complete. Before `2b7fbdf` this happened in 1 of 3 runs. The quote
    check didn't catch it (the quote is copied exactly; the check doesn't read meaning), and the
    scorecard passed it because the energy answer key didn't forbid it then. Founder decisions
    (2026-11-05): the answer key now forbids citing it as support; a code check comes next (a
    finding that claims a safety-relevant condition must cite a record that describes that
    condition); a prompt-wording change only if the code check causes too many retries.
    **Pull request #1 is not to be merged until this is fixed and re-scored.**

## Next steps

1. Build the code check for issue 11, test-first, after the founder approves the design.
2. Re-score both packs (`npm run eval -- --pack healthcare`, then `--pack energy`) and compare
   with `2026-11-05` and `2026-11-05-2`. Wanted: HC-INC-99102 cited in every healthcare run, and
   EN-INC-20260920-06 never cited as support.
3. The founder reviews that comparison before anything is merged.
