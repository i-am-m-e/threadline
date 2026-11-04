# Testing the Signals work on the Mac

Instructions for a Claude Code session running **on the founder's Mac**, in the Threadline
folder. They test the draft pull request <https://github.com/i-am-m-e/threadline/pull/1>
(branch `verify-card-map`), which was built in a cloud session that couldn't reach Ollama or the
app window.

The founder is a nurse leader, not a developer: explain results in plain language, keep steps
small, and say "not sure" where you aren't.

## Rules for this session

- **Don't change any code, prompts, schemas or tests.** This is a test run. If something fails,
  report it (with the exact output); don't fix it.
- **Don't edit** `data/eval/answer-key.json`, the decoy records in `data/eval/decoys/`, or
  `docs/test-results/2026-09-28/`. They hold the founder's clinical judgement.
- **Don't merge** the pull request, and don't push to `main`.
- The only thing to commit is the baseline scorecard folder in step 4, and only with the
  founder's OK.
- All data is synthetic. Nothing here needs the internet except `git` and `npm install`.

## 0. Get the branch

```bash
git fetch origin
```

```bash
git checkout verify-card-map
```

```bash
git pull origin verify-card-map
```

```bash
npm install
```

(`npm install` adds nothing new; the branch has no new dependencies. It just makes sure
`node_modules` matches.)

## 1. The saved tests (no Ollama needed, a few seconds)

```bash
npm test
```

**Expected:** `# pass 239`, `# fail 0`, `# todo 0`. Report the three numbers. If anything fails,
copy the failing test names and their error lines.

## 2. Check Ollama is ready

```bash
ollama list
```

**Expected:** `command-r` is listed. If Ollama isn't running, ask the founder to open the
Ollama app. If `command-r` is missing: `ollama pull command-r` (a large download; ask first).

## 3. A quick scorecard (about 15–25 minutes)

```bash
npm run eval -- --runs 1
```

It prints its progress, then the path to `docs/eval/<date>/scorecard.md`. Read that file and
report, in plain language:

1. **Step errors**: any? If a step failed, quote the error.
2. **Hard pass rate** for each part (healthcare pack, healthcare update, energy pack).
3. The **"checked against their records"** lines: findings, policy quote, analysis claims, map
   nodes, review card wording, other wording. How many were verified, removed or replaced?
4. **"Time windows with a cited record"** for the healthcare update (did the model cite the
   Sept 22 window?).
5. **"Recommendation rationale shortened"**: how often.
6. **Retries per run** and **seconds per run** (expect more retries and a bit more time than
   before: the new checks ask for retries when the model doesn't follow the rules).
7. Everything listed under **"Failed hard checks"** and **"Removed or replaced as unverified"**,
   with a one-line plain-language reading of each (for example: "the model wrote 95 minutes but
   the complaint says 85, so that finding was removed").

If the quick run had step errors, stop here and report; don't run step 4.

## 3b. The same quick scorecard with numbers by reference (another 15–25 minutes)

This tries the new approach: the model writes figures from flow rows, and times and dates, as
references like `{HC-FLOW-20260920-1600.room_to_physician_minutes}`, and code fills in the real
values. It's off by default; this flag turns it on for this run only (nothing is saved to the
settings):

```bash
npm run eval -- --runs 1 --by-reference
```

It writes a second folder (`docs/eval/<date>-2/`). Its scorecard says **"Numbers by reference:
on"** and has a **"References filled in"** line. Compare it with step 3's, side by side:

- Did the model use references at all? ("References filled in": 0 means it ignored them.)
- Were **more or fewer** findings, claims or passages removed or replaced as unverified?
- More or fewer **retries**? Any **step errors**?
- Hard pass rate and seconds per run.

Say plainly which approach looks better on this model, or "not sure" if it's mixed.

## 4. The baseline scorecard (3 runs, about 45–75 minutes)

```bash
npm run eval
```

Report the same seven things, plus the **agreement** lines (confidence, citation and leading
option agreement): how much do the three runs agree?

Then ask the founder whether to commit the new `docs/eval/<date>/` folder (or `<date>-2/` if a
quick run already used `<date>/`) as the baseline. If yes:

```bash
git add docs/eval
```

```bash
git commit -m "Baseline scorecard for the Signals checks (3 runs, Command R)"
```

```bash
git push origin verify-card-map
```

## 5. The app (the founder clicks; Claude can't see the window)

```bash
npm run dev
```

This opens the Threadline window. Walk the founder through these, one at a time, and write down
what they report:

1. Switch to **Signals** (top right). Click **Run benchmark packs** (bottom left). Wait for two
   Threads to appear (healthcare and energy). *Each takes several minutes with Command R.*
2. In the list: does each Thread show something like **"Medium confidence, seen on 1 occasion"**?
3. Open the healthcare Thread and scroll the **manager brief** to **"What the records say"**:
   - each finding has a small grey box under it with an exact quote in quotation marks, or the
     flow row's values ("Bed occupancy: 0.96 · Room to physician minutes: 90");
   - under the list, a line beginning **"Checked against their records: …"**;
   - in **Policy and practice**, a line **"Policy wording (HC-POL-CTAS-ESC): “…”"**;
   - anything under **"Removed or replaced as unverified"**? (Read it out.)
4. Click **Add test flow file**, then **Check now**. The healthcare Thread should now say
   **"seen on 2 occasions"** and list two time windows.
5. The decision path, on the healthcare Thread (use **Acting as** at the top to switch roles):
   1. Manager: **Send for front-line validation** → status *Under review*
   2. Front-line lead: **Confirm pattern** → *Validated pattern*
   3. Manager: **Accept recommendation** → status **Decision recorded**, with a **Start outcome
      review** button and "Outcome review due <date>"
   4. Manager: **Start outcome review** → *Outcome review due*
   5. Manager: **Record outcome**, type anything, **Close Thread** → *Closed*
6. Anything that looks wrong, confusing or broken: what, where, and a screenshot if possible.

To stop the app: close the window, or press Ctrl+C in the terminal.

## 6. Report back

Write one summary, in plain language, that the founder can paste into the cloud session:

- `npm test`: pass / fail / todo numbers
- quick scorecard: the seven items from step 3
- the numbers-by-reference comparison from step 3b
- baseline scorecard: the same, plus agreement (or "not run" and why)
- the app: what happened at each of steps 5.1–5.6
- anything surprising, and anything you weren't sure how to read
