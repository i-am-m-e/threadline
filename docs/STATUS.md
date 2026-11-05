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

## Latest scorecard results (Command R, 3 runs per pack)

| | `2026-11-04-4` (switch off, commit 0613ca4) | `2026-11-04-6` (switch on, commit 6b3006b) |
| --- | --- | --- |
| Healthcare pack: hard pass | 2 of 3 | 1 of 3 |
| Healthcare update: hard pass | 2 of 3 (1 step error: no "Learn more" option) | 3 of 3 |
| Energy pack: hard pass | 3 of 3 | 3 of 3 |
| Time per run | about 12–17 minutes | about 14–21 minutes |

Every healthcare-pack failure in those two scorecards was the same: **HC-INC-99102** (no monitored bed for a
CTAS 2 arrival) was not cited. In most failing runs the model had read it and called it "not
fitting". Commit `2b7fbdf` changes the pattern prompt to say that a record describing a
safety-relevant condition supports the pattern. **It hasn't been scored yet.**

## Open issues

1. **HC-INC-99102 not cited** (above). The fix in `2b7fbdf` is waiting to be scored.
2. **"Learn more" options:** the model sometimes leaves one out, even after a retry, and the step
   stops. The file stays in the incoming folder and is retried.
3. **Records that don't fit** (the compliment HC-CMP-4475, and EN-INC-20260920-06) are often not
   mentioned. `2b7fbdf` asks for every such record by its ID; also unscored.
4. **Update runs** usually describe only the first time window in the pattern text, though both
   windows are cited.
5. **The leading option varies between runs** (33–67% agreement), while confidence agrees 100%.
6. **Speed:** about 12–17 minutes per run, slower than the original 7–8 minutes, because of the
   extra checks and retries.
7. **The numbers check can be too strict:** it removed "Flow Record 1500" map labels and the year
   in "September 20, 2026". Not yet looked into.
8. **Duplicate citation:** every healthcare run cites HC-FLOW-20260920-1500 twice. This is harmless,
   and the fix is deferred to its own change.
9. **Numbers by reference:** not yet clearly better on this model. It stays off.
10. **App walkthrough** (step 5 of `docs/TESTING-ON-MAC.md`) hasn't been done yet.

## Next steps

1. Score `2b7fbdf` on the healthcare pack with the switch off: `npm run eval -- --pack healthcare`.
2. Compare it with `docs/eval/2026-11-04-4`. Is HC-INC-99102 cited in all 3 runs, with no new
   problems?
3. The founder reviews that comparison before the new scorecard is committed or anything else
   changes.
