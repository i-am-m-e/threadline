# "Learn more" options must gather information (built, switched OFF)

Status: **built 2026-11-04, OFF until the founder approves the word list** (`learnMoreCheck` in
`src/config.js`)

Why: in the 2026-09-28 runs the model typed process changes as "Learn more", which satisfies the
"at least one Learn more option" rule without offering a way to learn first. Two recorded examples:

- rooming, run 2: "Match rooming pace to capacity": "Monitor and adjust the rooming pace…"
- energy: "Enhance pre-shift coordination": "Implement a structured pre-shift coordination process…"

## The proposed rule (for the founder to approve or change)

An option typed "Learn more" is genuine when its **description** (not its title, which can always
say "Learn more about…") uses one of these words, with any ending ("tracking", "reviewed"):

> track, review, observe, watch, ask, huddle, debrief, gather, collect, measure, count, map,
> walk through, shadow, survey, interview, listen, check in, look into, explore, learn, understand

Left out on purpose: **monitor** (ambiguous: "monitor and adjust" is a change; and monitoring
individuals is already refused by another check).

## What happens when it's on

- A "Learn more" option without one of the words gets the step's one retry, naming the option.
- If it still has none after the retry, code relabels it "Process adjustment" (its honest type) and
  logs it; the brief's summary says so.
- If that leaves no genuine "Learn more" option, it's noted (log), not a failure. Known risk: if
  the model's retry relabels the option itself without adding a new one, the existing "at least
  one Learn more option" rule fails the step, as it does today.

With the recorded answers and the check on, both examples above are caught; the genuine one
("Collect data on the frequency and duration…") passes.

## To turn it on

In `src/config.js`, set `learnMoreCheck: true` (and edit `learnMoreWords` if needed), then run the
scorecard to see how often the model's options are relabelled.
