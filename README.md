# Threadline (local prototype)

A local AI assistant for organizational intelligence: ask questions across your policies,
reports and records, and see exactly which passage backs each answer. It talks to Ollama
(`command-r` or `qwen3:8b`, picked per thread), reads PDF, Word (`.docx`), Excel (`.xlsx`), `.txt`, `.md` and
`.csv` files, and keeps everything on this Mac.
It runs in its own window via Tauri.

The visual design follows the Claude Design handoff (round 5): one continuous copper **thread**
runs through the conversation, every message and document is a node on it, and citations draw
lines back to their sources.

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

## How it's organized

| File | Job |
| --- | --- |
| `src/index.html`, `src/styles.css` | Layout and look (design tokens, light/dark, animations) |
| `src/app.js` | Interface logic: thread, sidebar, Sources panel, message box |
| `src/model.js` | **The only file that talks to the AI.** `getModelResponse(messages, { model, onProgress })`, plus the list of models |
| `src/passages.js` | Splits documents into numbered passages, builds the "cite like [3]" instructions, finds citations in replies |
| `src/lines.js` | Draws the lines: citation traces (one color + dash pattern per source), your links, the drag line |
| `src/theme.js` | The Auto / Light / Dark switch |
| `src/extract.js` | Turns a file into plain text (PDF via pdf.js, Word via mammoth, Excel via SheetJS) |
| `src/storage.js` | Saves/loads threads and documents as files |
| `src/icons.js` | The Lucide icons and Threadline mark used in the UI |
| `src/vendor/` | Copied in as-is: pdf.js, mammoth, SheetJS, marked (Markdown → HTML), DOMPurify (strips unsafe HTML), Geist fonts |
| `src-tauri/` | The native Mac window wrapper (Rust, rarely needs touching) |

## How citations work

1. Each document is cut into passages of about a paragraph (`passages.js`).
2. Every passage in the thread gets a number, and the AI is asked to cite them like `[3]`.
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

## Choosing a model

The picker next to **Attach** sets which model answers in the current thread. The choice is
saved in that thread's JSON (`"model"`), so reopening an old thread keeps it; new threads start on
`command-r`. Each reply also records which model wrote it. To offer a different model, edit the
`MODELS` list at the top of `src/model.js`.

- **command-r** (default): answers directly; about 2 seconds for a short cited answer after it has loaded.
- **qwen3:8b**: "thinks" before answering (hidden), so about 7 seconds; smaller and lighter on memory.

## Switching to a cloud AI later

Only `src/model.js` changes (including its `MODELS` list). Keep the same shape:

- **In:** a list like `[{ role: "system" | "user" | "assistant", content: "..." }]`.
  When a thread has documents, the first message is a `system` message with the numbered passages.
- **Options:** `{ model, onProgress }` — which model to use, and an optional progress callback
- **Out:** the reply as a string (or throw an `Error` with a readable message)
- Call `onProgress(textSoFar)` as the reply streams in; `app.js` shows it sentence by sentence

## Where your data lives

`~/Library/Application Support/com.threadline.desktop/`

- `conversations/<id>.json` — one readable JSON file per thread
- `documents/<id>/` — the original attached file plus `text.txt` (its extracted text; PDF pages are separated by a form-feed character)

Delete that folder to start fresh.

## Known limits

- Both models cited the right passage 10/10 in testing, but qwen3 can mix up details on
  comparison questions (e.g. which policy is newer). command-r handled those correctly.
- Documents longer than 30,000 characters are cut off (`MAX_DOCUMENT_CHARS` in `app.js`).
- Scanned PDFs are images, so there's no text to extract.
- Word files don't have reliable page numbers, so their passages are labeled by text only.
- Review mode shows extracted text, not the original page layout.
