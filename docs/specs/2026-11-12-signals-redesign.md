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

## Progress

Handoff note, updated after each stage. Branch: `signals-redesign` (from `main`), not merged.

### Stage 1: information styles — done (2026-11-12)

What was built:

- `src/signalsFormat.js` (tested in `tests/signalsFormat.test.js`, 18 tests): works out the words
  and small figures from the Thread: "Sep 20, 3 to 6 pm", "Updated 2 hours ago", confidence bars,
  occasion dots, the status wording, and the look for each trust label.
- `src/signals-parts.js`: draws the eleven styles (context, title, when it happened, when it
  changed, status, confidence, recurrence, source of a claim, measure, reference, raised button).
- `src/styles.css`, section "Signals: information styles": the shared classes and colour tokens,
  for light and dark mode. `.signals-button` is now raised (soft shadow, lifts on hover).
- `src/icons.js`: pin, calendar and info icons.
- The Thread list and the Thread header already use the new pieces. The rest of the Thread page
  is unchanged until stage 2.
- `scripts/preview/`: a browser preview of the real Signals screen, using Threads saved by
  earlier scorecard runs and no model. Start it with `node scripts/preview/server.js`, then open
  `http://localhost:4173/scripts/preview/` (add `?theme=dark` or `?role=Manager`). Nothing is
  saved. No new packages.

Decisions made where the spec was silent:

1. The "Flagged" status reads "Flagged for review" on the pill, as in the mockup. The other
   statuses keep their names, and the status rules are untouched.
2. Dates leave out the year unless it isn't the current year ("Dec 30, 2025, 3 to 6 pm").
3. A time window ends at its last record's hour, as the engine stores it ("3 to 6 pm" for flow
   rows at 15:00 to 18:00), matching the mockup.
4. Occasion dots stop at 10; after that a "+N" follows and the words carry the count.
5. A Thread with more than three time windows shows three tags, then "and N more" (the rest
   are listed on hover).
6. The engine also uses the trust labels Inferred and Historical, which the spec's list of four
   doesn't mention. Inferred is a dashed red-brown tag (unconfirmed); Historical is grey.
7. The mockups are light mode only. The dark-mode colours are mine, chosen to keep 4.5:1.
8. Small grey text uses `#5f6773` (the mockup's grey), because the app's older grey fell just
   short of 4.5:1 on white.

Left over:

- "Blue fill only for the one main action": the style exists, but the old brief can still show
  two blue buttons side by side. Stage 2 moves the actions into the header and fixes this.
- The measure style (big number, unit, trigger underneath) is built but not used until the
  stage 2 number tiles.
- Older parts of the page (review card, brief) still use their old layout until stage 2.

### Stage 2: Thread page — done (2026-11-12)

What was built:

- `src/signalsData.js` (tested in `tests/signalsData.test.js`, 17 tests): number tiles, chart data,
  key quotes, records that don't fit, the header's actions for each role and status, and the
  history line. All worked out by code from the records and the Thread.
- `src/signals-ui.js`: the Thread page is now a header (actions for the current role at top
  right) and tabs Summary · Evidence · Map · Options · Detail. The Map tab still shows the old
  map until stage 3.
- `src/styles.css`, section "Signals: the Thread page".

Decisions made where the spec was silent or didn't fit the data:

1. **Records that don't fit have no direction tag.** The engine gives only record IDs, and code
   can't tell whether a record "points the other way", is "possibly related" or "unrelated".
   Each card shows the record's own title, words and time, with the tag "Not counted as
   support". The three tags in the spec can come from people in stage 5 (mark relevance).
   The test files' scoring labels (`eval_role`) are never shown.
2. The chart shows the trigger metric measured in minutes (the first one, if there are several),
   with the other trigger metrics as small figures under each hour. The hour before and after
   each window is drawn when the records have it.
3. Tile labels come from the record field names ("Room to physician", "Bed occupancy"); the
   occasions tile says "occasions", not "afternoons".
4. The header offers only the actions open in the current status, with at most one blue
   button. "Request more information" is worded "Need more information", as in the mockup.
   "Add context" is offered to front-line leads only (the mockup's manager header has three
   buttons); the status rules in `threads.js` are unchanged.
5. The review card's own buttons were removed: the header carries them. Front-line leads see
   the card first on Summary; managers find it under Detail.
6. Staff context notes show on Summary for every role, in amber, tagged Experiential.
7. "See full reasoning" opens in place on the option card. Library evidence is a row that opens
   under the options. "Discuss in a thread" moved to the Detail tab.
8. The open tab is remembered between visits.

Left over:

- Checked later the same day in the preview: the hover help appears on hover, and the Evidence
  and Options tabs read well in dark mode. Not checked: the Detail tab in dark mode, and the
  hover help by keyboard focus (it uses the same style rule as hover).
- Stages 3 (map), 4 (overview) and 5 (corrections: storage design first, wait for the founder's
  OK) are not started.

### Founder decisions on stage 2 (2026-11-12)

- **Records that don't fit:** flagging them is enough for now ("Not counted as support", with the
  record's own title, words and time). People's input on how a record relates is already planned
  as stage 5, "mark a record's relevance" (supports / points the other way / possibly related /
  unrelated, with a reason). When stage 5 is built, a person's mark should replace the neutral
  tag on these cards, shown as staff input.
- **"Add context"** for front-line leads only: agreed.
