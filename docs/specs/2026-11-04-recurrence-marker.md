# Recurrence marker

Status: **built 2026-11-04; needs a click-through of the Signals screen on the founder's Mac**

From the founder's decisions (step 1 spec, follow-ups; and 2026-11-04):

- An **occasion** is one triggered time window in a Thread. The count is shown beside
  confidence from the first occasion: "Medium confidence, seen on 2 occasions". It appears in
  the Thread list, the Thread header, the review card, the digest and the notification.
- **Bands: 10+, 50+, 70+ occasions** (`recurrenceBands` in `src/config.js`). A band is added to
  the text ("seen on 12 occasions (10+)") and moves the Thread up the list (higher band first;
  within a band, newest first as before).
- **Flag for review at 10+ occasions** (`recurrenceFlagAt`), whatever the confidence and even
  without a safety-relevant condition. The daily flag cap still applies; the history and the
  notification say it was flagged because it keeps recurring. A Thread is flagged at most once
  (as before): reaching 50+ or 70+ raises its place in the list but doesn't flag it again.
- **Recurrence never changes the confidence label.** Confidence keeps its three levels and its
  rule. "Low confidence, seen on 5 occasions" means: this keeps happening and nobody has
  confirmed why yet.

Code: `src/recurrence.js` (plain code, no AI), used by `monitor.js` (flag), `notify.js`
(notification text) and `signals-ui.js` (display, order). Tests: `tests/recurrence.test.js`,
`tests/monitor.test.js`, `tests/notify.test.js`.

Open questions for the founder: whether 50+ and 70+ should flag again (today: no), and whether
the bands or flag point should differ per domain (today: one setting for both).
