# Step 2: Check every finding against its source record

Status: **design approved 2026-11-04; built 2026-11-04 (needs a scorecard run on the founder's Mac)**

## Why

Goal A is "never make things up: every claim traces to a real record". After step 1, code
checks that a cited record id exists (the source guard in `src/llm.js`), but nothing checks
that the record actually says what the model claims. A real id with an invented finding
passes. This step closes that gap for the pattern's supporting evidence and the
policy-practice gap.

## What the model gives (Prompts 1 and 2)

Each item in Prompt 1's `supporting_evidence` gets two new fields:

- `quote`: for incident, complaint and near-miss records, words copied exactly from that
  record's text. Empty for flow records.
- `record_values`: for flow records (CSV rows), a list of `{ field, value }` pairs, e.g.
  `{ "field": "room_to_physician_minutes", "value": 90 }`. Empty for the others.

Prompt 2's `policy_practice_gap` gets `policy_quote`: words copied exactly from the cited
policy's text.

## What code checks (`src/verify.js`)

For each supporting-evidence item, against the record it cites:

1. **Quote** (incident, complaint, near-miss): required; appears in the record's text.
2. **Record values** (flow records): at least one; each field exists on the record and has
   that value. Fields code derives (e.g. `permits_per_inspector`) count, because the model
   is shown them.
3. **Right kind of evidence**: flow records have no text to quote, so a quote on a flow
   record is a problem; a quote is required for the other kinds.
4. **Numbers in the finding's wording** each appear in the cited record.

And the policy quote appears in the text of the policy the gap cites.

### Founder decisions (2026-11-04)

**Quote matching.** Before comparing, both sides are lower-cased, curly quotes become
straight, every kind of dash becomes "-", and runs of spaces become one space. Quote marks
around the quote and a missing full stop (or other closing punctuation) at its end are
ignored. Other punctuation must match. A quote must be one continuous stretch of the record:
"..." or "…" joining pieces is refused. Minimum length: 4 words.

**Numbers.**
- 0.93 = 93% = 93 percent; rounding to a whole percent is fine (0.955 → 96%).
- Hours and minutes may be converted, but only for a number the record itself labels as
  hours or minutes (in its text, e.g. "2-hour wait", or a field ending in `_minutes`):
  a 2-hour wait allows "120"; a 90-minute field allows "1.5". Conversions to whole or
  half hours only. A bare number is never converted, so a stray "2" can't become "120".
- The domain's own trigger and safety thresholds (from `domain_rules.json`, e.g. 90%,
  45, 60, 6) are allowed, so "room-to-physician time above 45 minutes" passes. The record's
  actual value is still checked through `record_values`.
- Numbers written as words ("two") are not checked. Known gap.
- Numbers are checked, units are not: a finding saying "2 minutes" passes if the record
  contains "2-hour". Known gap.

**When a check fails.** The problems join the step's existing single retry, which tells the
model exactly what was wrong. If an item still fails after the retry, it is removed and
logged as "unverified, removed". Nothing unverified is kept silently. For the policy gap
(which can't be removed) the policy id and quote are blanked and logged, as the source guard
already does for an invented policy id. Confidence is then worked out from the records left.
Removals are reported on the scorecard but are not a hard fail (that would need an
answer-key change).

**Shown in the app?** Not yet. Quotes and values are saved in each Thread's file; showing
them belongs with goal D (visible reasoning) in a later step.

**Later, not now:** contributing conditions, pressure map, graph nodes, "evidence that does
not fit", the vignette's story text, options and the review card.

## Files

- `src/verify.js` (new): the checks above. Plain code, no AI.
- `src/llm.js`: `runStep` takes an optional `verify` function. Its problems join the retry;
  after the last try its items are removed and logged instead of the step failing. All
  other problems still fail the step as before.
- `src/pipeline.js`: connects the checks to Prompts 1 and 2 and records a tally in
  `meta.verification`.
- `src/prompts/pattern.js`, `src/prompts/analysis.js` and their schemas: the new fields.
- `scripts/eval/report.js`: the scorecard line "Findings checked against their source".
- `README.md`; a dated note in `docs/threadline-spec-v3.2.md` section 6.

## Tests

Test-first, in parts, `npm test` after each, a commit after each:

1. Quote matching. 2. Numbers. 3. Record values and the whole evidence item; policy quote.
4. `runStep`: retry, then removal. 5. Prompts, schemas and pipeline (with new fixtures).
6. Scorecard line, README and spec note.

The recorded runs in `docs/test-results/2026-09-28/` have no quotes and stay unchanged. New
fixtures in `tests/fixtures/step2/` are copies of those recorded answers with quotes and
values added, used wherever answers go through the schema.
