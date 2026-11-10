# Showing checked evidence in the manager brief (goal D: visible reasoning)

Status: **built 2026-11-04; needs a look on the founder's Mac (the screen can't be run in the cloud)**

The manager brief gets a **What the records say** section after "What Threadline noticed":

- each supporting finding, its trust label and record id, and under it the proof it was
  checked against: the exact quote in quotation marks, or the flow row's values
  ("Bed occupancy: 0.96 · Room to physician minutes: 90");
- a one-line summary, e.g. "Checked against their records: 6 of 6 findings and 4 of 4 analysis
  claims verified; policy wording verified." (with removals, retries and corrected trust labels
  when there are any);
- **Removed as unverified**: each removed finding or analysis claim, with the reason;
- beside the policy-practice gap: "Policy wording (HC-POL-CTAS-ESC): “…”".

Runs recorded before these checks show findings without proof and say "Recorded before findings
were checked against their records." Nothing is invented for them.

The words come from `src/evidenceView.js` (tested in `tests/evidenceView.test.js`); the
drawing is in `renderBrief()` in `src/signals-ui.js`, with two small styles in `src/styles.css`.
The front-line review card is unchanged (it has an 80-word limit).
