# The numbers rule for the rest of the Signals text

Status: **built 2026-11-04; needs a scorecard run on the founder's Mac**

After step 2 and the map/card checks, every piece of Signals text that **describes the
records** now follows one rule: any number in it must be in the records (or be a domain
threshold), with the same allowances as before (percent, rounding, labelled hours/minutes, the
record's own hour on a 12-hour clock).

| Text | Checked against | Still wrong after the one retry |
| --- | --- | --- |
| Pattern statement | the records given to Prompt 1 | replaced: "Records suggest a possible pattern: <type> at <location>." |
| Vignette (situation, what appears to happen, observed effects) | the records given to Prompt 1 | that part replaced with a plain line |
| Evidence that does not fit (each item) | the records given to Prompt 1 | removed |
| Where small variations combine (each item) | the records given to Prompt 2 | removed |
| Policy expects | the cited policy (all inputs if none) | replaced with the verified policy quote, or a plain line |
| Records suggest | the records given to Prompt 2 | replaced with a plain line |

Everything replaced or removed is logged as "unverified", counted in
`meta.verification.wording`, shown in the manager brief ("Removed or replaced as unverified"),
and reported on the scorecard ("Other wording checked for numbers").

**Not checked, on purpose:** the options and the recommendation (they're proposals: "reserve 2
monitored beds", "review after 14 days"), "other explanations" and "open questions" (guesses and
questions, not claims).

**Known limits:** wording isn't checked, only numbers. Small numbers are weak evidence, because
they often appear in a record's dates or times (a "3-minute wait" passes when a record is
timestamped 15:00). Large or specific figures (a 140-minute wait, 99% occupancy) are caught.

Found while building: if the policy quote and "policy expects" both failed, the replacement for
"policy expects" could have used the unverified quote. The quote is now removed first (tested).
