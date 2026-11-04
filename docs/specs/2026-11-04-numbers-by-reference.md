# Numbers by reference (built behind a switch, off by default)

Status: **built 2026-11-04, founder-approved to build behind a switch; to compare on the scorecard**

## Why

Most of what the checks catch, and most of their weak spots, come from numbers and times: the
model types figures into sentences and code checks afterwards that each one appears in the
record. That check is loose (it needs rules for percents, hours and minutes, 12-hour clocks,
dates and ids) and it's after the fact. With references, the model never types those figures:
code fills them in from the record, so they can't be misstated.

## How it works when on

- Prompts 1, 2 and 4 get a short "NUMBERS BY REFERENCE" section: write flow-row figures as
  `{SOURCE_ID.field}` (or `{SOURCE_ID.field%}` for a percent), and times and dates as
  `{SOURCE_ID.time}` / `{SOURCE_ID.date}`, using only records you cite. Figures in an incident,
  complaint or near-miss's own text, and the thresholds, may be typed as they appear.
- Checks run on the references (`src/verify.js`): each must name a record the text may cite and
  a real number field, time or date. A **typed** flow figure, time or date is a problem, and the
  retry message shows the reference to write instead. Same handling as every other check: one
  retry, then removed (list items, findings, nodes) or replaced with a plain line (fields).
- After all the checks, `resolveReferences` fills every reference in with the record's value, as
  people read it: `90`, `96%`, `15:30`, `Sep 20`. Quotes, ids and `record_values` are never
  changed. A reference that doesn't resolve shows "[figure not found]" (and is logged).
- `meta.verification.references` counts references filled in and not found; the scorecard shows
  "Numbers by reference: on/off" in its header and "References filled in" when on.

## How to try it

`npm run eval -- --runs 1 --by-reference`, compared with the same run without the flag. To use
it in the app, set `numbersByReference: true` in `src/config.js`.

## Risks to watch on the scorecard

- A local model may not write references reliably. If it keeps typing flow figures, those
  findings are retried and then removed, so more removals than without the switch would mean the
  model isn't following the format.
- Options, "other explanations" and "open questions" aren't checked (as before); references in
  them are still filled in.
