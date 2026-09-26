# Threadline (local prototype)

A local chat app that talks to Ollama (`llama3.2`), can read attached `.txt` and `.pdf`
files, and saves everything on this Mac. It runs in its own window via Tauri.

## Run it

Needs: Ollama running with `llama3.2` pulled, Node.js, and Rust.

```bash
npm install        # first time only
npm run dev        # opens the app window; edits to src/ reload it
npm run build      # makes Threadline.app in src-tauri/target/release/bundle/macos/
```

## How it's organized

| File | Job |
| --- | --- |
| `src/index.html`, `src/styles.css` | The page layout and look |
| `src/app.js` | Interface logic: shows messages, handles typing, clicks and attachments |
| `src/model.js` | **The only file that talks to the AI.** `getModelResponse(messages)` |
| `src/extract.js` | Turns a `.txt` / `.pdf` into plain text (PDFs via pdf.js in `src/vendor/`) |
| `src/storage.js` | Saves/loads conversations and documents as files |
| `src-tauri/` | The native Mac window wrapper (Rust, rarely needs touching) |

`app.js` uses the other three modules; they never use each other.

## Switching to a cloud AI later

Only `src/model.js` changes. Keep the same shape:

- **In:** a list like `[{ role: "user", content: "..." }, { role: "assistant", content: "..." }]`
- **Out:** the reply as a string (or throw an `Error` with a readable message)

## Where your data lives

`~/Library/Application Support/com.threadline.desktop/`

- `conversations/<id>.json` — one readable JSON file per chat
- `documents/<id>/` — the original attached file plus `text.txt` (its extracted text)

Delete that folder to start fresh.

## Known limits

- Documents longer than 30,000 characters are cut off (set in `MAX_DOCUMENT_CHARS` in `app.js`).
- Scanned PDFs are images, so there's no text to extract.
- Replies appear all at once (no word-by-word streaming yet).
