# Reliability fixes (after step 2)

Status: **built 2026-11-04; needs a click-through of the Signals screen on the founder's Mac**

The four follow-ups listed in the step 1 spec, each with a test written first
(`tests/model.test.js`, `tests/threads.test.js`).

1. **Model calls have a time limit** (`src/model.js`, `IDLE_TIMEOUT_MS`, 5 minutes). It is a
   limit on silence, not on total time: a long reply that keeps arriving is never cut off.
   When Ollama sends nothing for 5 minutes, the call stops with "Ollama stopped responding…".
   In Signals the step then fails as before and the file stays in `incoming/` for the next
   Check now.
2. **A garbled line from Ollama** gives a readable message instead of a raw parser error. A
   last line without a closing newline is now read instead of dropped.
3. **An empty reply is refused** ("The model sent an empty reply. Try again.") instead of
   being saved as an empty answer.
4. **"Decision recorded" is now a status people can see.** Recording a decision stops there
   and sets the outcome review date. A Manager presses **Start outcome review** to move it to
   "Outcome review due" (the date alone never moves a Thread: nothing goes past Flagged
   without a button press), then **Record outcome** closes it as before.

The last item on that list (Signals schemas allowed only Healthcare and Energy, while House rules
allow new domains) was done separately, on the `any-domain` branch: the domain is free text in
Prompt 1's schema and prompt (code sets it from the trigger anyway), and flow records of a new
kind are recognised by their shape (no text, not a policy, incident, complaint or near-miss).
Tested with a made-up "Aviation" domain in `tests/monitor.test.js`.
