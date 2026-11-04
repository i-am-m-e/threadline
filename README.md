# Threadline (local prototype)

A local AI assistant for organizational intelligence: ask questions across your policies,
reports and records, and see exactly which passage backs each answer. It talks to Ollama
(`command-r` or `qwen3:8b`, picked per thread), reads PDF, Word (`.docx`), Excel (`.xlsx`), `.txt`, `.md` and
`.csv` files, and keeps everything on this Mac.
It runs in its own window via Tauri.

The visual design follows the Claude Design handoff (round 5): one continuous copper **thread**
runs through the conversation, every message and document is a node on it, and citations draw
lines back to their sources.

## Signals (system-signals monitor, v3.2)

**Threadline notices, drafts and routes. People decide.** Spec: [docs/threadline-spec-v3.2.md](docs/threadline-spec-v3.2.md).

The **Signals** mode watches approved operational data for patterns in flows, queues and capacity
(never individuals):

1. Drop synthetic record files (CSV/JSON) into the app's `data/incoming/` folder ("Show incoming
   folder"), or use "Run benchmark packs", then press **Check now**. (An automatic interval can be
   set in `src/config.js`; it's off by default.)
2. Triggers from `domain_rules.json` are checked in code. If one fires, four prompts run (pattern →
   system analysis → options → review card), each constrained to a JSON Schema and checked in
   code: sources must exist, no names or behaviour labels, confidence can't exceed the evidence.
   Each supporting finding must also show where it comes from (an exact quote from an incident,
   complaint or near-miss, or the field values of a flow row), and code checks that the record
   really says it; the policy-practice gap must quote the policy. See "Checking findings against
   their records" below.
3. A **Thread** appears with a front-line review card, a manager brief and a Thread map. A matching
   open Thread is updated instead of duplicated. If a step fails, the file stays in `incoming/`
   and the next Check now retries it.
4. People act by role: a manager sends it for front-line validation; a front-line lead confirms it,
   adds context or says it doesn't match; only then can a manager record a decision (which applies
   nothing), later press **Start outcome review**, and record the outcome. Threadline itself can only mark Threads Inferred or Flagged.
5. Flags (badge + local notification) only for Medium+ confidence with a safety-relevant
   condition, capped per day; everything else goes to the digest.
6. **Recurrence** is shown beside confidence from the first occasion (one occasion = one
   triggered time window): "Medium confidence, seen on 2 occasions". Threads seen on 10+, 50+ or
   70+ occasions move up the list, and reaching 10 occasions flags a Thread for review even at
   Low confidence (the daily cap still applies). Recurrence never changes the confidence label.
   Bands and the flag point are `recurrenceBands` and `recurrenceFlagAt` in `src/config.js`.

The evidence library in `data/evidence/` holds **placeholders** to be replaced with curated
summaries; recommendations relying on them are tagged "Placeholder evidence". Test results:
[docs/test-results/2026-09-28](docs/test-results/2026-09-28/README.md).

## Modes (switch at the top right)

- **Standard:** past threads on the left, the thread in the middle, Sources on the right.
- **Focus:** the sidebar folds into a rail; each answer's sources appear as margin notes beside it.
  Double-clicking a thread in the sidebar opens it in Focus.
- **Review:** no sidebar; the cited document opens beside the conversation. Click a citation to
  jump to its passage (highlight sweep + margin bar + line).

The theme button (bottom of the sidebar, bottom of the rail, or Review's top bar) cycles
**Auto → Light → Dark**. Auto follows your Mac.

## Run it

Needs: Ollama running with `command-r` and `qwen3:8b` pulled (`ollama pull command-r`), Node.js, and Rust.

```bash
npm install        # first time only
npm run dev        # opens the app window; edits to src/ reload it
npm run build      # makes Threadline.app in src-tauri/target/release/bundle/macos/
```

## Checking findings against their records

The source guard removes record ids that don't exist. That alone would let a real id with an
invented finding through, so `src/verify.js` also checks what each finding says:

- **Incident, complaint and near-miss records:** the model gives a quote of at least 4 words,
  copied as one continuous stretch from the record's text. Capitals, spacing, curly quotes and
  dash types don't matter; other punctuation does; "..." joining pieces is refused.
- **Flow records (CSV rows):** the model names each field and value it relies on
  (`room_to_physician_minutes = 90`), and they must match the row.
- **Numbers in the finding's wording** must be in the cited record. 0.93 may be written as 93%
  (or rounded to a whole percent); hours and minutes may be converted, but only for a number the
  record itself labels as hours or minutes ("2-hour wait" allows 120 minutes); the domain's own
  thresholds (e.g. "above 45 minutes") are allowed. Numbers written as words aren't checked, and
  units aren't compared.
- **The policy-practice gap** quotes the policy it cites.

A problem goes into the step's one retry, naming exactly what was wrong. If a finding still
can't be verified, it is removed and logged as "unverified, removed" (the policy gap's id and
quote are blanked instead), and confidence is worked out from what's left. Nothing unverified is
kept silently. The quotes and values are saved in each Thread's file (not shown in the app yet).
**Analysis claims** (contributing conditions and pressure-map entries) get two checks: any number
in them must be in the records they cite (retry, then removed as unverified, as above), and their
trust label must fit what they cite. That label is corrected in code and logged: no sources →
Inferred; Authoritative needs a policy; Observed needs a flow, incident, complaint or near-miss
record; Experiential and Historical come only from people, so the model can't claim them. The
claims' wording itself isn't checked yet. The graph, "evidence that does not fit", the vignette
story, the options and the review card aren't checked this way yet. Design: `docs/specs/2026-11-04-step2-verify-findings.md`.

## Testing and the scorecard

Two commands check the Signals engine. Neither touches the app's own data.

**`npm test`** runs the saved tests in `tests/` in a few seconds, without Ollama. They check every
rule Signals enforces in code: answers must match their schema, made-up record ids are removed,
findings must match the records they cite, names and blame language are caught, confidence can't exceed what the evidence supports, only a
person can move a Thread past Flagged, the daily flag cap, and that a second file updates the
same Thread. A test marked TODO is a known issue that hasn't been fixed yet.

**`npm run eval`** is the scorecard. It runs the real pipeline, on your local Ollama, on the
evaluation packs in `data/eval/` (the benchmark files plus decoy records that should not be
cited), several times, and scores each run against `data/eval/answer-key.json`.

```bash
npm run eval                        # both packs, 3 runs each (about 40 to 50 minutes with Command R)
npm run eval -- --runs 1            # a quick check (about 15 minutes)
npm run eval -- --pack healthcare   # one pack: healthcare, energy or all
npm run eval -- --model qwen3:8b    # try another model
```

Results go to `docs/eval/<date>/` (a second run on the same day goes to `<date>-2/`, and so on): read `scorecard.md` (pass rates, decoys cited, how much repeated
runs agree, retries, time per run, findings verified against their records and any removed as
unverified, and every failed check); `runs/` has each run's full output.

The answer key and decoy records hold the founder's clinical and operational judgement. Change
them only with his approval. The design is in `docs/specs/2026-11-04-step1-tests-and-scorecard.md`.

## How it's organized

| File | Job |
| --- | --- |
| `src/index.html`, `src/styles.css` | Layout and look (design tokens, light/dark, animations) |
| `src/app.js` | Interface logic: thread, sidebar, Sources panel, message box |
| `src/model.js` | **The only file that talks to the AI.** `getModelResponse(messages, { model, onProgress, format, temperature })`, plus the list of models |
| `src/passages.js` | Splits documents into numbered passages, builds the "cite like [3]" instructions, finds citations in replies |
| `src/lines.js` | Draws the lines: citation traces (one color + dash pattern per source), your links, the drag line |
| `src/theme.js` | The Auto / Light / Dark switch |
| `src/export.js` | Turns a thread into a Markdown file (conversation, sources, links, cited passages as footnotes) |
| `src/extract.js` | Turns a file into plain text (PDF via pdf.js, Word via mammoth, Excel via SheetJS) |
| `src/storage.js` | Saves/loads threads and documents as files |
| `src/icons.js` | The Lucide icons and Threadline mark used in the UI |
| `src/signals-ui.js` | Signals mode screen: toolbar, Thread list, review card, manager brief, digest |
| `src/prompts/`, `src/schemas/` | The four Signals prompts (shared rules first) and their JSON Schemas |
| `src/llm.js` | Runs each Signals prompt: schema check, source guard, name/behaviour scan, checks against the records, one retry |
| `src/verify.js` | Checks that each finding is really in the record it cites (quotes, field values, numbers) |
| `src/pipeline.js` | Prompt 1 → 2 → evidence selection → 3 → 4, with code checks after each |
| `src/records.js` | Reads record files, checks triggers, time windows, safety conditions |
| `src/monitor.js` | Check now / timer: new files, triggers, de-duplication into open Threads |
| `src/threads.js` | Thread lifecycle: status rules and the human actions (by role) |
| `src/notify.js` | Flags, daily cap, digest, alert volume, local notifications |
| `src/recurrence.js` | Recurrence: occasions seen, bands (10+, 50+, 70+), list priority, recurrence flags |
| `src/threadMap.js` | The Thread map (Cytoscape + dagre) |
| `src/config.js` | Signals settings: model, temperatures, monitor interval, daily flag cap |
| `data/` | Synthetic benchmark packs, placeholder evidence, domain rules (packaged with the app) |
| `src/vendor/` | Copied in as-is: pdf.js, mammoth, SheetJS, marked (Markdown → HTML), DOMPurify (strips unsafe HTML), Cytoscape + dagre, Geist fonts |
| `src-tauri/` | The native Mac window wrapper (Rust, rarely needs touching) |

## How citations work

1. Each document is cut into passages of about a paragraph (`passages.js`).
2. Every passage in the thread gets a number, and the AI is asked to cite them like `[3]`.
   Small threads send every passage. When documents are bigger than `PASSAGE_BUDGET_CHARS`
   (16,000 characters, in `app.js`), Threadline **searches** them (BM25 ranking) and sends the
   best-matching passages for the question, plus each document's opening and anything cited in
   the last two answers. So all 500 pages of a manual are searchable, not just the start.
3. Citations in the reply become numbered markers (renumbered 1, 2, 3… per thread).
   Hover one to draw a line to its passage in the Sources panel; click to keep the line;
   click a passage to read it highlighted in context.

Numbers the AI makes up are shown as plain text, never linked.

Each source has its own line style — 6 colors × 4 patterns (solid, dashed, dotted, dash-dot) = 24
before any repeat — shown as a
small sample on its card and as a thin underline on its citations. Hovering a source (or one of
its passages) scrolls the thread to where it's cited.

## Linking ("pull a thread")

Drag the dot beside any message, or the diamond on a source card, and drop it on:

- another message or a source → a saved link line (click the line to remove it). Threadline then
  **reviews the material for the connection**: a "You linked A ↔ B" entry goes on the thread and the
  AI answers, with citations, using only the documents involved (all of them for message ↔ message).
- the message box (sources only) → the next question uses only that document

While dragging, the line snaps onto whatever you're over. A linked message shows a "↔ source" chip
where its line starts, and a linked source's diamond fills in. If one end is scrolled out of view,
the line stays (faded) and runs along the margin toward it.

Links and those message-box references are saved in the thread's JSON (`links`, `composerRefs`).

Spreadsheets are turned into one line per row that names each column (e.g.
`Unit: 4B; Reviews done: 9`), so a cited passage makes sense on its own.

## Policy vs. practice (gap analysis)

- **Source type:** every source card has a picker: **Authoritative** (what should happen: policies,
  SOPs), **Observed** (what did happen: logs, reports, audits) or **Experiential** (what people
  say). Threadline guesses from the file name and opening text; change it if it's wrong. Passages
  are tagged with their source's type when sent to the AI.
- **Find gaps** (next to the model picker) appears once a thread has at least one Authoritative and
  one Observed source. The AI checks each requirement against what was observed and lists gaps,
  triggers, and affected roles, citing both sides.
- **Checks on every gap answer**, worked out in code each time it's shown (so relabelling a source or
  adding a rule updates old answers):
  - a claim citing a requirement but no Observed evidence gets an **Unsupported** badge;
  - claims matching a house rule get its classification as a badge;
  - a line counts the Observed and Authoritative passages cited.
- **Domain** (the picker beside the model) chooses which house rules and terms apply to the thread.
- **House rules** (`domain_rules.json` in the data folder; edit via the domain picker → "Edit house
  rules…", or **Make a rule** on any finding): terms are added to the AI's instructions, and each
  rule ("when the evidence mentions … → classify as …") is matched *in code* against a finding and
  the log entries it cites (at least 2 words and 40% of the rule's words). The AI alone ignored rules
  in testing; the code match doesn't depend on it.

Try it with the sample packs in `samples/`: `HC_*` (urgent care) and `OG_*` (steam LOTO).

## When you add files

Threadline first gives a quick summary of each new file and a short overview of how it connects to
the thread's other documents (with citations) and to your other threads that share its topics
(by shared words). If you typed a question too, it's answered right after.

## Choosing a model

The picker next to **Attach** sets which model answers in the current thread. The choice is
saved in that thread's JSON (`"model"`), so reopening an old thread keeps it; new threads start on
`command-r`. Each reply also records which model wrote it. To offer a different model, edit the
`MODELS` list at the top of `src/model.js`.

- **command-r** (default): answers directly; about 2 seconds for a short cited answer after it has loaded.
- **qwen3:8b**: "thinks" before answering (hidden), so about 7 seconds; smaller and lighter on memory.

Link reviews always use `LINK_REVIEW_MODEL` (Command R), whatever the thread uses, because it
handled comparisons best. Long document questions take Command R roughly 40 seconds.

## Switching to a cloud AI later

Mostly `src/model.js` changes (including its `MODELS` list), but not only that: Signals relies
on Ollama's schema-constrained `format`, which forces the model to answer with JSON of the right
shape. A cloud provider needs its own equivalent (for example structured output or tool use), and
`SIGNALS_CONFIG.model` in `src/config.js` names the Signals model separately. Keep the same shape:

- **In:** a list like `[{ role: "system" | "user" | "assistant", content: "..." }]`.
  When a thread has documents, the first message is a `system` message with the numbered passages.
- **Options:** `{ model, onProgress, format, temperature }`: which model to use, an optional progress
  callback, an optional JSON Schema the answer must match (Signals), and an optional temperature
- **Out:** the reply as a string (or throw an `Error` with a readable message)
- Call `onProgress(textSoFar)` as the reply streams in; `app.js` shows it sentence by sentence

## Managing threads and sources

- **Delete a source:** hover its card in Sources and click the trash icon. Its links and message-box
  references go too; answers that cited it keep their text, but those citations stop linking.
- **Delete several:** click **Select** (above the thread list, or in the Sources heading), tick
  items, then **Delete**. There's always an "Are you sure?" first.
- **Export:** the download icon in the header saves the thread as a Markdown (`.md`) file.

## Where your data lives

`~/Library/Application Support/com.threadline.desktop/`

- `conversations/<id>.json` — one readable JSON file per thread
- `domain_rules.json` — house rules, terms, triggers and safety conditions per domain
- `signals/threads/<id>.json` — Signals Threads; `data/incoming/` and `data/processed/` — record files
- `documents/<id>/` — the original attached file plus `text.txt` (its extracted text; PDF pages are separated by a form-feed character)

Delete that folder to start fresh.

## Known limits

- Both models cited the right passage 10/10 in testing, but qwen3 can mix up details on
  comparison questions (e.g. which policy is newer). command-r handled those correctly.
- Search is keyword-based: it finds passages that share words with the question, not ones that
  mean the same thing in different words.
- Scanned PDFs are images, so there's no text to extract.
- Word files don't have reliable page numbers, so their passages are labeled by text only.
- Review mode shows extracted text, not the original page layout.
- If Ollama sends nothing for 5 minutes, a model call stops with "Ollama stopped responding"
  (`IDLE_TIMEOUT_MS` in `src/model.js`). A long reply that keeps arriving is never cut off.
