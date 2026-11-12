# Signals redesign: overview, Thread page and map

Status: **design approved by the founder, 2026-11-12.** Mockups (reference only, not code to copy):
`docs/design/2026-11-12-signals-redesign/*.dc.html`. They are Claude Design files: read them as HTML for
layout, wording, colours and spacing. They contain sample data; the app must use real Thread data.

## Goals

A manager should understand a Thread at a glance, then dig in only if they choose.
Summaries, numbers and charts first; full detail on demand. Clear difference between
what you read and what you can do.

## Non-negotiables (carry over from the engine work)

- **Every number, chart, date and count is computed by code from the records**, never taken
  from the model's wording. The model's text appears only where it already does today (the
  checked pattern statement, vignette, options), and stays labelled as a draft.
- No change to the pipeline, prompts, checks, answer key or scorecard in this work.
- No names of people anywhere, including corrections (roles only).
- Nothing moves a Thread past Flagged without a person; existing role gates stay.
- No new dependencies unless asked (Cytoscape may be dropped later; don't remove it yet).
- Works in light and dark mode; keyboard accessible; text contrast 4.5:1.

## 1. Information styles (MetaStyle.dc.html)

One look per kind of information, everywhere:

1. Context: small capitals, pin icon for the site, above the title.
2. Title: the only large text in a card.
3. When it happened: blue tinted tag with calendar icon, plain words ("Sep 20, 3 to 6 pm"),
   never ISO timestamps.
4. When it changed: small grey text with clock icon ("Updated 2 hours ago").
5. Status: filled pill, first in its row.
6. Confidence: three-bar meter plus the word.
7. Recurrence: one dot per occasion (from code), beside confidence, never changing it.
8. Source of a claim: copper = records (Observed), teal = policy (Authoritative),
   purple dashed = suggested (needs a decision), amber = staff input (Experiential).
9. Measure: big number, grey unit, trigger underneath.
10. Reference (record IDs): grey monospace, always last.
11. Things you can do: buttons are raised (soft shadow, lifts on hover, visible focus ring);
    information is flat. Blue fill only for the one main action. Tabs and list rows that
    navigate are flat.

Add these as shared CSS classes and small render helpers so every screen uses them.

## 2. Overview dashboard (Dashboard.dc.html)

A new **Overview** view in Signals mode, beside **Threads**:

- Four counts: needs your review; flags today (of the daily limit); safety-relevant; recurring.
- "Needs your attention": one row per open Thread: context, title, status, confidence,
  occasions, when it happened, a small trend line of its trigger metric against the trigger
  value, and one action button that opens the Thread.
- "When patterns occurred": a strip of the last 7 days (or the Threads' date range) with one
  dot per occasion per Thread.
- "Decisions and follow-ups": counts of awaiting validation, decisions recorded, outcome
  reviews due in 14 days, closed with outcome.
- Footnote: "Every number on this page is counted by code from the records."

## 3. Thread page (Main.dc.html)

- Header: context, title, status, confidence meter, occasion dots; the current role's actions
  at top right (manager's buttons for managers, front-line buttons for front-line leads).
- Tabs: **Summary · Evidence · Map · Options · Detail**.
  - Summary: "What Threadline noticed" (the checked pattern statement), four number tiles,
    the chart and key quotes, and the options.
  - Evidence: the chart and quotes, policy and practice side by side, records that don't fit.
  - Map: see section 4.
  - Options: option cards in a row; the recommended one outlined in purple; trade-off and
    review date on each; "See full reasoning" expands the rest. The approaches area sits on a
    light purple panel.
  - Detail: expandable rows for all findings, system analysis, what was checked, history.
- Number tiles (code): peak value of each trigger metric with its trigger; occasions; records cited.
- Chart (code): the trigger metric by hour for each occasion, trigger line drawn, hours that
  crossed both triggers darker.
- Key quotes: verified quotes from incident and complaint records, safety-relevant tagged,
  on a light copper card.
- Records that don't fit: each with a plain description, time and a tag
  ("Points the other way", "Possibly related", "Unrelated"). If the engine only gives an ID,
  show the record's own title and time from the record, not a bare ID.
- Hover help: an "i" with a one-line explanation on each tile, the meter, the dots, each
  section heading and each trust tag (wording in Main.dc.html).
- The front-line review card stays available to front-line leads; managers see the summary first.

## 4. Map

- A view switch: **Timeline | Drivers**, default Timeline, choice remembered per user.
- **Timeline** (MapTimeline.dc.html), drawn by code from record timestamps: lanes for flow
  data, incidents, complaints, policy (and staff input, section 5); the pattern window shaded;
  flow cards per hour; events at their time. Additional occasions as compact strips that expand.
- **Drivers** (MapDriver.dc.html): outcome, primary drivers, secondary drivers, possible
  changes, built from the analysis output already produced (contributing conditions, pressure
  map, options). Inferred items dashed.
- Selecting any item shows its records beside the map (MapDetail.dc.html pattern).
- The fishbone is not part of this build.

## 5. Corrections (edit mode) (MapEdit.dc.html)

- An Edit mode on the Map tab, for Manager and Front-line lead roles.
- Two kinds of correction to start: **add a cause** (text, time range optional, reason
  required) and **mark a record's relevance** (supports / points the other way / possibly
  related / unrelated, reason required).
- Saved as a signed correction on the Thread: role, time, what, why. Never changes records or
  the pipeline's draft. Shown in amber as "Staff input", Experiential trust label.
  The original stays visible (faded, with an "Edited" note). Undo per correction.
  "Show Threadline's original" toggles corrections off.
- Corrections stay with the Thread and appear after updates. They are **not** fed into
  prompts or training in this build; just stored cleanly so they can be later.

## Build order (stages)

1. Information styles (shared CSS and helpers) and raised-action styling.
2. Thread page: header, tabs, tiles, chart, quotes, records-that-don't-fit, hover help.
3. Map: timeline view and the view switch; then drivers view.
4. Overview dashboard.
5. Corrections (touches how Threads are saved: design the storage shape first, with tests).

Each stage: tests first for any code that computes numbers or data for the screens, then the
UI, then `npm test`, then a browser check against the mockup, then commit.
