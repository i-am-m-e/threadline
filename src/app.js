// app.js — the interface: the thread, sidebar, Sources panel and message box.
//
// This file never talks to the AI directly. It builds the conversation and
// hands it to getModelResponse() in model.js.

import { getModelResponse, MODELS, DEFAULT_MODEL, resolveModel } from "./model.js";
import { extractText } from "./extract.js";
import * as storage from "./storage.js";
import { documentsIn } from "./storage.js";
import {
  splitIntoPassages, passageLabel, buildSourcesPrompt, findCitations, replaceCitations, CITE_REMINDER,
} from "./passages.js";
import { drawLines } from "./lines.js";
import { icons, logo } from "./icons.js";
import { marked } from "./vendor/marked.esm.js";
import DOMPurify from "./vendor/purify.es.mjs";

// Small models can only read so much at once, so long documents get cut off here.
const MAX_DOCUMENT_CHARS = 30000;

// ---------- Page elements we'll work with ----------
const $ = (id) => document.getElementById(id);
const el = {
  history: $("history"), newThread: $("new-thread"), search: $("search"),
  main: $("main"), title: $("thread-title"), sourcesPill: $("sources-pill"), toggleSources: $("toggle-sources"),
  scroller: $("scroller"), thread: $("thread"), messages: $("messages"),
  composer: $("composer"), pending: $("pending"), input: $("message-input"), fileInput: $("file-input"),
  hint: $("composer-hint"), send: $("send"), modelSelect: $("model-select"),
  sources: $("sources"), sourcesSummary: $("sources-summary"), sourceCards: $("source-cards"),
  lines: $("lines"), viewer: $("file-viewer"),
};

// ---------- App state (what's going on right now) ----------
let conversation = null;  // the thread on screen
let pending = [];         // files picked but not sent yet: { key, file, name, progress, extracted }
let isWaiting = false;    // true while the AI is answering
let live = null;          // while a reply streams in: { text, shown, numbers, block }
let hover = null;         // what the pointer is over: { type: "cite", anchor } or { type: "source", docId }
const pinned = new Set(); // citations that were clicked, so their lines stay
let searchText = "";      // what's typed in "Search threads"
let renamingId = null;    // the thread whose title is being edited, if any
let sourcesOpen = readSetting("sourcesOpen", true);
const docs = {};          // document id -> { text, passages } (loaded from disk once)

// ---------- Starting up ----------
async function start() {
  // Fill in the icons that index.html left empty.
  $("logo").innerHTML = logo();
  el.newThread.innerHTML = icons.plus(15) + "New thread";
  $("search-icon").innerHTML = icons.search(15);
  $("attach-icon").innerHTML = icons.paperclip(16);
  el.send.innerHTML = icons.arrowUp(16);
  el.toggleSources.innerHTML = icons.panelRight(17);
  $("file-viewer-close").innerHTML = icons.x(18);

  await storage.initStorage();
  const saved = await storage.listConversations();
  await showConversation(saved[0] ?? makeNewThread());
}

function makeNewThread() {
  const now = new Date().toISOString();
  return { id: storage.newId(), title: "New thread", createdAt: now, updatedAt: now, model: DEFAULT_MODEL, messages: [] };
}

// "New chat" is what threads were called before the redesign.
const isUntitled = (conv) => conv.title === "New thread" || conv.title === "New chat";

async function showConversation(conv) {
  conversation = conv;
  pinned.clear();
  hover = null;
  await loadDocuments();
  render();
}

// Read each document's text from disk (once) and split it into passages.
async function loadDocuments() {
  for (const doc of documentsIn(conversation)) {
    if (docs[doc.id]) continue;
    let text = "";
    try {
      text = await storage.loadDocumentText(doc.id);
    } catch {
      // The file is missing; the thread still works, it just can't show that document.
    }
    docs[doc.id] = { text, passages: splitIntoPassages(text) };
  }
}

// ---------- Sending ----------
async function send() {
  const text = el.input.value.trim();
  const stillReading = pending.some((p) => !p.extracted);
  if (isWaiting || stillReading || (!text && pending.length === 0)) return;
  const time = new Date().toISOString();

  // 1. Attached files become a "documents added" event on the thread.
  if (pending.length > 0) {
    const attachments = [];
    for (const item of pending) {
      const ref = await storage.saveDocument(item.file, item.extracted);
      docs[ref.id] = { text: item.extracted.text, passages: splitIntoPassages(item.extracted.text) };
      attachments.push(ref);
    }
    conversation.messages.push({ role: "event", time, attachments });
    pending = [];
  }

  // 2. The question (if any).
  if (text) conversation.messages.push({ role: "user", text, time });
  if (isUntitled(conversation)) conversation.title = (text || documentsIn(conversation)[0].name).slice(0, 60);

  el.input.value = "";
  await storage.saveConversation(conversation);

  // Files on their own just join the thread; the AI answers once you ask something.
  if (!text) return render();
  await askModel();
}

async function askModel() {
  const { messages, numbers } = buildModelMessages();
  // Threads from before model switching don't have a model saved yet; this fills it in.
  const model = resolveModel(conversation.model);
  conversation.model = model;
  isWaiting = true;
  live = { text: "", shown: "", numbers, block: null };
  render();

  let problem = null;
  try {
    const reply = await getModelResponse(messages, {
      model,
      onProgress: (textSoFar) => {
        live.text = textSoFar;
        updateLiveReply();
      },
    });
    conversation.messages.push({
      role: "assistant", text: reply, time: new Date().toISOString(), model, citations: citationsUsed(reply, numbers),
    });
    await storage.saveConversation(conversation);
  } catch (err) {
    problem = err.message;
  }
  isWaiting = false;
  live = null;
  render();
  if (problem) showError(problem);
}

// What we send the AI: the numbered passages from this thread's documents
// (see passages.js), then the conversation so far.
function buildModelMessages() {
  const documents = documentsIn(conversation).map((d) => ({ id: d.id, name: d.name, text: docs[d.id]?.text ?? "" }));
  const messages = [];
  let numbers = {};
  if (documents.length > 0) {
    const built = buildSourcesPrompt(documents, MAX_DOCUMENT_CHARS);
    messages.push({ role: "system", content: built.prompt });
    numbers = built.numbers;
  }

  const talk = conversation.messages.filter((m) => m.role === "user" || m.role === "assistant");
  talk.forEach((m, i) => {
    let content = m.text || (m.attachment ? `Please summarize "${m.attachment.name}".` : "");
    if (i === talk.length - 1 && documents.length > 0) content += CITE_REMINDER;
    messages.push({ role: m.role, content });
  });
  return { messages, numbers };
}

// Keep only the passage numbers the reply actually cited (and that exist).
function citationsUsed(reply, numbers) {
  const used = {};
  for (const c of findCitations(reply)) for (const n of c.numbers) if (numbers[n]) used[n] = numbers[n];
  return used;
}

// ---------- Citations across the thread ----------
// The AI cites passages by their number in the prompt (which can be large, like [47]).
// On screen we renumber them 1, 2, 3… in the order they're first cited in the thread.
// A passage is identified by "documentId#passageIndex".
function citationIndex() {
  const numberOf = new Map();
  let uses = 0;
  const replies = conversation.messages.filter((m) => m.role === "assistant" && m.citations);
  if (live) replies.push({ text: live.shown, citations: live.numbers });
  for (const msg of replies) {
    for (const c of findCitations(msg.text)) {
      for (const n of c.numbers) {
        const ref = msg.citations[n];
        if (!ref) continue;
        const key = `${ref.docId}#${ref.index}`;
        if (!numberOf.has(key)) numberOf.set(key, numberOf.size + 1);
        uses += 1;
      }
    }
  }
  return { numberOf, uses };
}

// ---------- Formatted replies ----------
// The AI writes Markdown (**bold**, lists, `code`...). marked turns that into HTML,
// then DOMPurify removes anything unsafe (scripts, etc.) before it goes on screen.
// Images are blocked too: a document could trick the AI into writing an image link
// that quietly sends your text to some website when the image loads.
marked.setOptions({ breaks: true }); // a single line break in the reply stays a line break

function showFormatted(element, text, citations, numberOf) {
  let markdown = tidyCodeFences(text);
  // Swap citations for placeholders that survive Markdown and cleaning…
  if (citations) markdown = replaceCitations(markdown, citations, (n) => `⟦${n}⟧`);
  let html = DOMPurify.sanitize(marked.parse(markdown), { FORBID_TAGS: ["img", "style", "form", "input"] });
  // …then turn the placeholders into citation buttons.
  html = html.replace(/⟦(\d+)⟧/g, (_, n) => {
    const key = `${citations[n].docId}#${citations[n].index}`;
    return `<button type="button" class="cite" data-key="${key}">${numberOf.get(key) ?? "?"}</button>`;
  });
  element.innerHTML = html;
}

// Small models often indent a code block's ``` line (to put it under a bullet)
// but not the code itself, which breaks the block. So we move every ``` line to
// the left edge, and un-indent the code inside by the same amount when it has it.
function tidyCodeFences(text) {
  let inCode = false;
  let indent = "";
  return text
    .split("\n")
    .map((line) => {
      const fence = line.match(/^(\s*)```/);
      if (fence) {
        if (!inCode) indent = fence[1];
        inCode = !inCode;
        return line.trimStart();
      }
      if (inCode && indent && line.startsWith(indent)) return line.slice(indent.length);
      return line;
    })
    .join("\n");
}

// ---------- The thread (middle column) ----------
// Chats from before the redesign kept a file on the user's message; show it as
// its own "documents added" event, like new threads do.
function threadItems() {
  const items = [];
  for (const msg of conversation.messages) {
    if (msg.attachment) items.push({ role: "event", time: msg.attachment.addedAt, attachments: [msg.attachment] });
    items.push(msg);
  }
  return items;
}

function renderThread() {
  const items = threadItems();
  el.main.classList.toggle("is-empty", items.length === 0 && !live);
  el.thread.classList.toggle("is-live", Boolean(live));

  const { numberOf } = citationIndex();
  el.messages.innerHTML = "";
  for (const item of items) el.messages.append(messageBlock(item, numberOf));
  if (live) {
    live.block = liveBlock();
    el.messages.append(live.block);
  }
  wireCitations();
  el.scroller.scrollTop = el.scroller.scrollHeight;
}

function messageBlock(item, numberOf) {
  const block = document.createElement("div");
  block.className = `msg msg-${item.role}`;
  block.append(node(), label(item));

  if (item.role === "event") {
    const chips = document.createElement("div");
    chips.className = "doc-chips";
    for (const doc of item.attachments) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "doc-chip";
      chip.title = "Read this document";
      chip.innerHTML = icons.fileText(16);
      chip.append(textSpan(doc.name, "doc-chip-name"), textSpan(doc.pages ? `${doc.pages} pp` : doc.type ?? "", "doc-chip-meta"));
      chip.onclick = () => openViewer(doc);
      chips.append(chip);
    }
    block.append(chips);
  } else if (item.text) {
    const body = document.createElement("div");
    body.className = "msg-body";
    if (item.role === "assistant") {
      body.classList.add("formatted");
      showFormatted(body, item.text, item.citations, numberOf);
    } else {
      body.textContent = item.text; // your own words: always plain text
    }
    block.append(body);
  }
  return block;
}

function node() {
  const span = document.createElement("span");
  span.className = "node";
  return span;
}

function label(item) {
  const div = document.createElement("div");
  div.className = "msg-label";
  if (item.role === "event") {
    const n = item.attachments.length;
    div.textContent = `${n} document${n === 1 ? "" : "s"} added`;
  } else {
    div.textContent = item.role === "user" ? "You" : "Threadline";
  }
  if (item.time) div.append(textSpan(clock(item.time), "msg-time"));
  if (item.model) div.append(textSpan(modelLabel(item.model), "msg-model"));
  return div;
}

// The reply being written right now: a pulsing node, a status, and a blinking caret.
function liveBlock() {
  const block = document.createElement("div");
  block.className = "msg msg-assistant is-live";
  const docCount = documentsIn(conversation).length;
  const status = docCount ? `Tracing ${docCount} source${docCount === 1 ? "" : "s"}…` : "Thinking…";
  const head = label({ role: "assistant" });
  head.append(textSpan(status, "live-status"));
  const body = document.createElement("div");
  body.className = "msg-body formatted";
  body.innerHTML = '<span class="caret"></span>';
  block.append(liveSegment(), node(), head, body);
  return block;
}

function liveSegment() {
  const span = document.createElement("span");
  span.className = "live-seg";
  span.innerHTML = '<svg width="3" height="26"><line x1="1.5" y1="0" x2="1.5" y2="26"/></svg>';
  return span;
}

// Called by getModelResponse each time more of the reply arrives.
// We only show up to the last finished sentence or line, so text appears in
// whole pieces rather than half-words. (Show `live.text` as-is for word-by-word.)
function updateLiveReply() {
  if (!live?.block) return;
  const finished = upToLastCompletePiece(live.text);
  if (!finished || finished === live.shown) return;
  live.shown = finished;

  const { numberOf } = citationIndex();
  const body = live.block.querySelector(".msg-body");
  showFormatted(body, finished, live.numbers, numberOf);
  // Put the blinking caret at the end of the last paragraph or list item.
  let last = body;
  while (last.lastElementChild && !last.lastElementChild.matches("pre, table, .cite")) last = last.lastElementChild;
  last.insertAdjacentHTML("beforeend", '<span class="caret"></span>');

  wireCitations();
  renderSources(); // newly cited passages appear in the Sources panel as they're cited
  el.scroller.scrollTop = el.scroller.scrollHeight;
  refreshLines();
}

// A piece is complete when it ends in . ! or ? followed by a space, or at a line break
// (which also covers list items). "3.14" doesn't count because no space follows the dot.
function upToLastCompletePiece(text) {
  const endings = [...text.matchAll(/[.!?]["')\]]*\s|\n/g)];
  if (endings.length === 0) return "";
  const last = endings[endings.length - 1];
  return text.slice(0, last.index + last[0].length).trimEnd();
}

function showError(message) {
  const block = document.createElement("div");
  block.className = "msg msg-error";
  block.append(node(), textSpan(message, "msg-body"));
  el.main.classList.remove("is-empty");
  el.messages.append(block);
  el.scroller.scrollTop = el.scroller.scrollHeight;
}

// Give each citation an id (so a pinned one stays pinned after redrawing),
// and hook up hovering and clicking.
function wireCitations() {
  el.messages.querySelectorAll(".cite").forEach((cite, i) => {
    const anchor = `c${i}`;
    cite.dataset.anchor = anchor;
    cite.classList.toggle("is-pinned", pinned.has(anchor));
    cite.title = "Hover to trace · click to keep the line";
    cite.onmouseenter = () => setHover({ type: "cite", anchor });
    cite.onmouseleave = () => setHover(null);
    cite.onclick = () => {
      pinned.has(anchor) ? pinned.delete(anchor) : pinned.add(anchor);
      cite.classList.toggle("is-pinned", pinned.has(anchor));
      if (!sourcesOpen) toggleSources(); // the line needs the Sources panel to land on
      refreshLines();
    };
  });
}

// Links in replies open in your normal browser instead of inside this window.
el.messages.addEventListener("click", (event) => {
  const link = event.target.closest("a");
  if (!link) return;
  event.preventDefault();
  if (/^(https?|mailto):/i.test(link.href)) window.__TAURI__.opener.openUrl(link.href);
});

// ---------- Sources panel (right column) ----------
function renderSources() {
  el.sources.classList.toggle("is-closed", !sourcesOpen);
  el.toggleSources.setAttribute("aria-pressed", String(sourcesOpen));

  const list = documentsIn(conversation);
  const { numberOf, uses } = citationIndex();
  el.sourcesSummary.textContent = list.length
    ? `${plural(list.length, "document")} · ${plural(uses, "citation")}`
    : "";

  el.sourceCards.innerHTML = "";
  if (list.length === 0) {
    el.sourceCards.append(textSpan("Attached documents appear here, with the passages each answer cites.", "sources-empty"));
    return;
  }

  for (const doc of list) {
    const card = document.createElement("div");
    card.className = "source-card";
    card.onmouseenter = () => setHover({ type: "source", docId: doc.id });
    card.onmouseleave = () => setHover(null);

    const head = document.createElement("button");
    head.type = "button";
    head.className = "source-head";
    head.title = "Read this document";
    head.innerHTML = icons.fileText(18);
    const text = document.createElement("div");
    text.append(textSpan(doc.name, "source-name"), textSpan(documentMeta(doc), "source-meta"));
    head.append(text);
    head.onclick = () => openViewer(doc);
    card.append(head);

    // One row per passage of this document that has been cited, in citation order.
    const cited = [...numberOf].filter(([key]) => key.startsWith(doc.id + "#"));
    if (cited.length > 0) {
      const rows = document.createElement("div");
      rows.className = "source-rows";
      for (const [key, number] of cited) {
        const index = Number(key.split("#")[1]);
        const passage = docs[doc.id]?.passages[index];
        const row = document.createElement("button");
        row.type = "button";
        row.className = "source-row";
        row.title = "Show this passage";
        const marker = textSpan(String(number), "cite cite-static");
        marker.dataset.rowKey = key;
        row.append(marker, textSpan(passage ? passageLabel(passage) : "Passage unavailable", "source-row-label"));
        row.onclick = () => openViewer(doc, index);
        rows.append(row);
      }
      card.append(rows);
    }
    el.sourceCards.append(card);
  }
}

function documentMeta(doc) {
  const parts = [doc.type ?? "File"];
  if (doc.pages) parts.push(plural(doc.pages, "page"));
  if (doc.addedAt) parts.push(`added ${shortWhen(doc.addedAt)}`);
  return parts.join(" · ");
}

function toggleSources() {
  sourcesOpen = !sourcesOpen;
  saveSetting("sourcesOpen", sourcesOpen);
  renderSources();
  refreshLines();
}

// ---------- Lines between citations and sources ----------
function setHover(value) {
  hover = value;
  refreshLines();
}

// Work out which lines should show and where they start and end, then draw them.
function refreshLines() {
  if (!sourcesOpen) return drawLines(el.lines, []);
  const threadBox = el.scroller.getBoundingClientRect();
  const sourcesBox = el.sourceCards.getBoundingClientRect();
  const traces = [];

  for (const cite of el.messages.querySelectorAll(".cite")) {
    const { anchor, key } = cite.dataset;
    const show =
      pinned.has(anchor) ||
      (hover?.type === "cite" && hover.anchor === anchor) ||
      (hover?.type === "source" && key.startsWith(hover.docId + "#"));
    if (!show) continue;

    const row = el.sourceCards.querySelector(`[data-row-key="${CSS.escape(key)}"]`);
    if (!row) continue;
    const from = centerOf(cite);
    const to = centerOf(row);
    // Skip lines whose ends are scrolled out of view.
    if (!isInside(from, threadBox) || !isInside(to, sourcesBox)) continue;
    traces.push({ key: anchor, from, to });
  }
  drawLines(el.lines, traces);
}

function centerOf(element) {
  const r = element.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}
const isInside = (p, box) => p.y >= box.top && p.y <= box.bottom && p.x >= box.left && p.x <= box.right;

// Redraw (at most once per frame) whenever something scrolls or the window resizes.
let lineFrame = 0;
const scheduleLines = () => {
  cancelAnimationFrame(lineFrame);
  lineFrame = requestAnimationFrame(refreshLines);
};
el.scroller.addEventListener("scroll", scheduleLines);
el.sourceCards.addEventListener("scroll", scheduleLines);
window.addEventListener("resize", scheduleLines);
document.fonts?.ready.then(scheduleLines);

// ---------- Document viewer (pop-up) ----------
// Shows the text we pulled out of a document, with page breaks marked, and
// optionally one passage highlighted and scrolled into view.
function openViewer(doc, passageIndex) {
  const { text = "", passages = [] } = docs[doc.id] ?? {};
  const highlight = passageIndex !== undefined ? passages[passageIndex] : null;

  $("file-viewer-title").textContent = doc.name;
  let note = documentMeta(doc) + ` · ${text.length.toLocaleString()} characters`;
  if (text.length > MAX_DOCUMENT_CHARS) note += ` · the AI only reads the first ${MAX_DOCUMENT_CHARS.toLocaleString()}`;
  $("file-viewer-note").textContent = note;

  const out = $("file-viewer-text");
  out.innerHTML = "";
  let offset = 0;
  text.split("\f").forEach((pageText, i) => {
    if (i > 0) out.append(textSpan(`Page ${i + 1}`, "page-break"));
    appendWithHighlight(out, pageText, offset, highlight);
    offset += pageText.length + 1;
  });
  if (!text) out.append(textSpan("This document's text couldn't be loaded.", "sources-empty"));

  el.viewer.showModal();
  out.querySelector("mark")?.scrollIntoView({ block: "center" });
}

// Add a chunk of text, wrapping the part inside `highlight` (if any) in <mark>.
function appendWithHighlight(parent, chunk, chunkStart, highlight) {
  const chunkEnd = chunkStart + chunk.length;
  if (!highlight || highlight.end <= chunkStart || highlight.start >= chunkEnd) {
    parent.append(chunk);
    return;
  }
  const from = Math.max(highlight.start, chunkStart) - chunkStart;
  const to = Math.min(highlight.end, chunkEnd) - chunkStart;
  const mark = document.createElement("mark");
  mark.textContent = chunk.slice(from, to);
  parent.append(chunk.slice(0, from), mark, chunk.slice(to));
}

$("file-viewer-close").addEventListener("click", () => el.viewer.close());

// ---------- Composer (the message box) ----------
async function addFiles(fileList) {
  for (const file of fileList) {
    const item = { key: storage.newId(), file, name: file.name, progress: 0, extracted: null };
    pending.push(item);
    renderComposer();
    try {
      const extracted = await extractText(file, (fraction) => {
        item.progress = fraction;
        renderComposer();
      });
      if (!extracted.text.trim()) {
        throw new Error(`No text found in "${file.name}". (Scanned PDFs are images, so there's no text to read.)`);
      }
      item.extracted = extracted;
    } catch (err) {
      pending = pending.filter((p) => p !== item);
      showError(err.message);
    }
    renderComposer();
  }
}

function renderComposer() {
  const isEmpty = el.main.classList.contains("is-empty");
  el.input.placeholder = isEmpty ? "Ask anything, or drop files here" : "Continue the thread";
  const stillReading = pending.some((p) => !p.extracted);
  el.hint.textContent = stillReading ? "Sends when all files are read" : "";
  el.send.disabled = isWaiting || stillReading;
  el.modelSelect.value = resolveModel(conversation.model);
  el.modelSelect.disabled = isWaiting; // no switching halfway through an answer
  el.composer.classList.toggle("has-pending", pending.length > 0);

  el.pending.innerHTML = "";
  for (const item of pending) {
    const chip = document.createElement("div");
    chip.className = "pending-chip" + (item.extracted ? "" : " is-reading");
    chip.innerHTML = icons.fileText(16);
    const text = document.createElement("div");
    text.append(textSpan(item.name, "pending-name"), textSpan(pendingStatus(item), "pending-status"));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip-remove";
    remove.title = "Remove";
    remove.innerHTML = icons.x(12);
    remove.onclick = () => {
      pending = pending.filter((p) => p !== item);
      renderComposer();
    };
    chip.append(text, remove);
    if (!item.extracted) {
      const bar = document.createElement("span");
      bar.className = "progress";
      bar.style.width = `${Math.round(item.progress * 100)}%`;
      chip.append(bar);
    }
    el.pending.append(chip);
  }
}

function pendingStatus(item) {
  if (!item.extracted) return `Reading · ${Math.round(item.progress * 100)}%`;
  const { type, pages, text } = item.extracted;
  const parts = [type];
  if (pages) parts.push(plural(pages, "page"));
  parts.push(text.length > MAX_DOCUMENT_CHARS ? `long, AI reads first ${MAX_DOCUMENT_CHARS.toLocaleString()} chars` : "Ready");
  return parts.join(" · ");
}

// ---------- Model picker ----------
const modelLabel = (id) => MODELS.find((m) => m.id === id)?.label ?? id;

for (const m of MODELS) el.modelSelect.add(new Option(m.label, m.id));

el.modelSelect.addEventListener("change", async () => {
  conversation.model = el.modelSelect.value;
  // Save it right away for threads that already exist, so reopening them keeps the choice.
  // (A brand-new thread gets saved with it when you send the first message.)
  if (conversation.messages.length > 0) await storage.saveConversation(conversation, { keepTimestamp: true });
  el.input.focus();
});

el.composer.addEventListener("submit", (event) => {
  event.preventDefault(); // stop the page from reloading
  send();
});

// Enter sends; Shift+Enter makes a new line.
el.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send();
  }
});

el.fileInput.addEventListener("change", () => {
  addFiles([...el.fileInput.files]);
  el.fileInput.value = ""; // lets you pick the same file again later
});

// Drag files from Finder onto the thread to attach them.
el.main.addEventListener("dragover", (event) => {
  event.preventDefault();
  el.main.classList.add("is-dropping");
});
el.main.addEventListener("dragleave", (event) => {
  if (!el.main.contains(event.relatedTarget)) el.main.classList.remove("is-dropping");
});
el.main.addEventListener("drop", (event) => {
  event.preventDefault();
  el.main.classList.remove("is-dropping");
  if (event.dataTransfer.files.length) addFiles([...event.dataTransfer.files]);
});

// ---------- Header ----------
function renderHeader() {
  el.title.textContent = conversation.title;
  const count = documentsIn(conversation).length;
  el.sourcesPill.hidden = count === 0;
  el.sourcesPill.textContent = plural(count, "source");
}

el.toggleSources.addEventListener("click", toggleSources);

// ---------- Sidebar (past threads) ----------
async function renderSidebar() {
  let saved = await storage.listConversations();
  if (searchText) {
    const q = searchText.toLowerCase();
    saved = saved.filter(
      (c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.text?.toLowerCase().includes(q))
    );
  }

  el.history.innerHTML = "";
  for (const group of groupByDate(saved)) {
    const section = document.createElement("div");
    section.className = "history-group";
    section.append(textSpan(group.label, "history-label"));
    const items = document.createElement("div");
    items.className = "history-items";
    for (const conv of group.items) items.append(historyItem(conv));
    section.append(items);
    el.history.append(section);
  }
  if (saved.length === 0 && searchText) el.history.append(textSpan("No threads match.", "history-empty"));
}

function historyItem(conv) {
  const item = document.createElement("div");
  item.className = "history-item" + (conv.id === conversation.id ? " is-active" : "");
  item.append(textSpan("", "history-node"));

  if (conv.id === renamingId) {
    item.append(renameBox(conv));
    return item;
  }

  const open = document.createElement("button");
  open.type = "button";
  open.className = "history-open";
  const talk = conv.messages.filter((m) => m.role === "user" || m.role === "assistant").length;
  const sourceCount = documentsIn(conv).length;
  const meta = plural(talk, "message") + (sourceCount ? ` · ${plural(sourceCount, "source")}` : "");
  open.append(textSpan(conv.title, "history-title"), textSpan(meta, "history-meta"));
  open.onclick = () => {
    if (!isWaiting) showConversation(conv);
  };
  open.ondblclick = () => startRenaming(conv);

  const actions = document.createElement("div");
  actions.className = "history-actions";
  actions.append(
    actionButton(icons.pencil(13), "Rename thread", () => startRenaming(conv)),
    actionButton(icons.x(14), "Delete thread", () => confirmDelete(conv))
  );
  item.append(open, actions);
  return item;
}

function actionButton(svg, title, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "history-action";
  button.title = title;
  button.innerHTML = svg;
  button.onclick = onClick;
  return button;
}

// Today / This week / Earlier, by when each thread last changed.
function groupByDate(list) {
  const startOfToday = new Date().setHours(0, 0, 0, 0);
  const weekAgo = startOfToday - 6 * 24 * 60 * 60 * 1000;
  const groups = [
    { label: "Today", items: [] },
    { label: "This week", items: [] },
    { label: "Earlier", items: [] },
  ];
  for (const conv of list) {
    const t = new Date(conv.updatedAt).getTime();
    groups[t >= startOfToday ? 0 : t >= weekAgo ? 1 : 2].items.push(conv);
  }
  return groups.filter((g) => g.items.length > 0);
}

el.search.addEventListener("input", () => {
  searchText = el.search.value.trim();
  renderSidebar();
});

el.newThread.addEventListener("click", () => {
  if (isWaiting) return;
  showConversation(makeNewThread());
  el.input.focus();
});

// ---------- Renaming a thread ----------
function startRenaming(conv) {
  renamingId = conv.id;
  renderSidebar();
}

// A text box in place of the title: Enter (or clicking away) saves, Escape cancels.
function renameBox(conv) {
  const box = document.createElement("input");
  box.className = "rename-box";
  box.value = conv.title;
  let finished = false;

  const finish = async (save) => {
    if (finished) return; // Enter and "clicking away" can both fire; only act once
    finished = true;
    renamingId = null;
    const newTitle = box.value.trim();
    if (save && newTitle && newTitle !== conv.title) {
      // If it's the thread on screen, rename that copy (it has the latest messages).
      const target = conv.id === conversation.id ? conversation : conv;
      target.title = newTitle.slice(0, 80);
      await storage.saveConversation(target, { keepTimestamp: true });
    }
    renderSidebar();
    renderHeader();
  };

  box.onkeydown = (event) => {
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  };
  box.onblur = () => finish(true);
  setTimeout(() => {
    box.focus();
    box.select();
  });
  return box;
}

// ---------- Deleting a thread ----------
// A native "Are you sure?" pop-up first, so one stray click can't lose a thread.
async function confirmDelete(conv) {
  if (isWaiting) return;
  const confirmed = await window.__TAURI__.dialog.ask(
    `Are you sure you want to delete "${conv.title}"?\n\nThis also deletes any files attached in it, and can't be undone.`,
    { title: "Delete thread", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" }
  );
  if (!confirmed) return;
  try {
    await storage.deleteConversation(conv);
  } catch (err) {
    showError(`Couldn't delete that thread: ${err.message}`);
    return;
  }
  // If we just deleted the thread on screen, show the next most recent one (or a new one).
  if (conv.id === conversation.id) {
    const saved = await storage.listConversations();
    await showConversation(saved[0] ?? makeNewThread());
  } else {
    renderSidebar();
  }
}

// ---------- Drawing everything ----------
function render() {
  renderSidebar();
  renderHeader();
  renderThread();
  renderSources();
  renderComposer();
  scheduleLines();
}

// ---------- Small helpers ----------
function textSpan(text, className) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// "09:13" if it was today, otherwise "Sep 25".
function shortWhen(iso) {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? clock(iso)
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Remembered view preferences (like whether Sources is open). Stored in the
// browser's local storage, which can be unavailable, so failures are ignored.
function readSetting(name, fallback) {
  try {
    const value = localStorage.getItem(name);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}
function saveSetting(name, value) {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch {
    // Not important enough to bother you about.
  }
}

start().catch((err) => showError(`Couldn't start: ${err.message}`));
