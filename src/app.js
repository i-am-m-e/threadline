// app.js — the interface: the thread, sidebar, Sources panel, modes and message box.
//
// This file never talks to the AI directly. It builds the conversation and
// hands it to getModelResponse() in model.js.
//
// Sections, in order: state · starting up · sending · citations · formatted replies ·
// the thread · Focus notes · Sources panel · Review viewer · lines & hovering ·
// drag to link · document pop-up · composer · model picker · header & modes ·
// sidebar · renaming · deleting · drawing everything · helpers.

import { getModelResponse, MODELS, DEFAULT_MODEL, LINK_REVIEW_MODEL, resolveModel } from "./model.js";
import { extractText } from "./extract.js";
import * as storage from "./storage.js";
import { documentsIn } from "./storage.js";
import {
  splitIntoPassages, passageLabel, passagePlace, buildSourcesPrompt, findCitations, replaceCitations, stripCitations,
  CITE_REMINDER, TRUST_LABELS, guessTrustLabel, formatRulePack, matchHouseRules, unsupportedGapClaims,
  citationEvidence, words,
} from "./passages.js";
import { drawLines, styleFor, swatch, colorOf } from "./lines.js";
import { icons, logo } from "./icons.js";
import { initTheme } from "./theme.js";
import { threadToMarkdown } from "./export.js";
import { marked } from "./vendor/marked.esm.js";
import DOMPurify from "./vendor/purify.es.mjs";

// How much document text to send the AI with each question (about 4,500 words).
// Bigger documents are searched, and only the best-matching passages are sent.
// More text can mean better answers, but the AI takes longer to read it
// (Command R needs roughly 40 seconds for this much).
const PASSAGE_BUDGET_CHARS = 16000;

// ---------- Page elements we'll work with ----------
const $ = (id) => document.getElementById(id);
const el = {
  history: $("history"), newThread: $("new-thread"), search: $("search"),
  main: $("main"), title: $("thread-title"), sourcesPill: $("sources-pill"), toggleSources: $("toggle-sources"),
  scroller: $("scroller"), thread: $("thread"), messages: $("messages"),
  composer: $("composer"), composerRefs: $("composer-refs"), pending: $("pending"), input: $("message-input"),
  fileInput: $("file-input"), hint: $("composer-hint"), send: $("send"), modelSelect: $("model-select"),
  domainSelect: $("domain-select"), findGaps: $("find-gaps"), rulesDialog: $("rules-dialog"),
  sources: $("sources"), sourcesSummary: $("sources-summary"), sourceCards: $("source-cards"),
  review: $("review"), reviewTabs: $("review-tabs"), reviewScroll: $("review-scroll"), reviewPage: $("review-page"),
  reviewIndicator: $("review-page-indicator"), threadPicker: $("thread-picker"),
  lines: $("lines"), viewer: $("file-viewer"), toast: $("toast"),
  selectThreads: $("select-threads"), threadSelectBar: $("thread-select-bar"), threadSelectCount: $("thread-select-count"),
  selectSources: $("select-sources"), sourceSelectBar: $("source-select-bar"), sourceSelectCount: $("source-select-count"),
  helpBox: $("help-box"),
};

// ---------- App state (what's going on right now) ----------
let conversation = null;  // the thread on screen
let pending = [];         // files picked but not sent yet: { key, file, name, progress, extracted }
let isWaiting = false;    // true while the AI is answering
let live = null;          // while a reply streams in: { text, shown, numbers, row }
let hover = null;         // what the pointer is over (see refreshLines for the kinds)
const pinned = new Set(); // citations that were clicked, so their lines stay
let searchText = "";      // what's typed in "Search threads"
let renamingId = null;    // the thread whose title is being edited, if any
let sourcesOpen = readSetting("sourcesOpen", true);
let mode = readSetting("mode", "standard"); // "standard" | "focus" | "review"
let drag = null;          // while dragging a dot: { from: linkId, to: {x, y} }
let review = { docId: null, key: null, anchor: null }; // what Review mode is showing
const docs = {};          // document id -> { text, passages } (loaded from disk once)
let domainRules = {};     // house rules per domain, from domain_rules.json
let selectingThreads = false;       // "Select" mode in the sidebar
const selectedThreads = new Set();
let selectingSources = false;       // "Select" mode in the Sources panel
const selectedSources = new Set();

// ---------- Starting up ----------
async function start() {
  // Fill in the icons that index.html left empty.
  document.querySelectorAll(".logo-slot").forEach((slot) => (slot.innerHTML = logo()));
  el.newThread.innerHTML = icons.plus(15) + "New thread";
  $("search-icon").innerHTML = icons.search(15);
  $("attach-icon").innerHTML = icons.paperclip(16);
  $("rail-new").innerHTML = icons.plus(18);
  $("rail-history").innerHTML = icons.clock(18);
  $("rail-search").innerHTML = icons.search(18);
  $("thread-picker-icon").innerHTML = icons.chevronDown(15);
  el.send.innerHTML = icons.arrowUp(16);
  el.toggleSources.innerHTML = icons.panelRight(17);
  $("file-viewer-close").innerHTML = icons.x(18);
  $("rules-close").innerHTML = icons.x(18);
  document.querySelectorAll(".export-button").forEach((b) => {
    b.innerHTML = icons.download(16);
    b.addEventListener("click", exportThread);
  });
  initTheme();
  document.body.dataset.mode = mode;

  await storage.initStorage();
  domainRules = await storage.loadDomainRules();
  renderDomainOptions();
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
  conversation.links ??= [];         // your drag-made links (saved with the thread)
  conversation.composerRefs ??= [];  // sources dropped on the message box
  pinned.clear();
  hover = null;
  review = { docId: null, key: null, anchor: null };
  selectingSources = false;
  selectedSources.clear();
  closeDrawer();
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
    // Documents attached before passage-cutting version 2 keep version 1 (see passages.js).
    docs[doc.id] = { text, passages: splitIntoPassages(text, doc.splitVersion ?? 1) };
  }
}

// Saves small changes (links, references, model) without moving the thread to the top of the list.
async function saveQuietly() {
  if (conversation.messages.length > 0) await storage.saveConversation(conversation, { keepTimestamp: true });
}

// ---------- Sending ----------
async function send() {
  const text = el.input.value.trim();
  const stillReading = pending.some((p) => !p.extracted);
  if (isWaiting || stillReading || (!text && pending.length === 0)) return;
  const time = new Date().toISOString();

  // 1. Attached files become a "documents added" event on the thread.
  const added = [];
  if (pending.length > 0) {
    for (const item of pending) {
      const ref = await storage.saveDocument(item.file, item.extracted);
      // A first guess at what kind of source this is; you can change it on its card.
      ref.trustLabel = guessTrustLabel(ref.name, item.extracted.text);
      docs[ref.id] = { text: item.extracted.text, passages: splitIntoPassages(item.extracted.text) };
      added.push(ref);
    }
    conversation.messages.push({ role: "event", time, attachments: added });
    pending = [];
  }
  if (isUntitled(conversation)) conversation.title = (text || added[0].name).slice(0, 60);
  el.input.value = "";
  await storage.saveConversation(conversation);

  // 2. New files get a quick summary and an overview of how they connect to everything else.
  if (added.length > 0) await reviewNewDocuments(added);

  // 3. Then the question (if any), with any sources you dropped on the message box.
  if (text) {
    const message = { role: "user", text, time: new Date().toISOString() };
    if (conversation.composerRefs.length > 0) {
      message.refs = [...conversation.composerRefs];
      message.docIds = message.refs; // the AI only sees these documents for this question
    }
    conversation.messages.push(message);
    conversation.composerRefs = [];
    await storage.saveConversation(conversation);
    await askModel();
  }
}

// When files are added: summarize each one, then say how they connect to the thread's
// other documents (with citations) and to your other threads that share their topics.
async function reviewNewDocuments(added) {
  const names = added.map((d) => `"${d.name}"`).join(", ");
  const others = documentsIn(conversation).filter((d) => !added.includes(d));
  const related = await relatedThreads(added);

  let prompt = `I just added ${names}.\n\nFirst, summarize each new document in one or two sentences, citing it.`;
  if (others.length > 0) {
    prompt +=
      "\n\nThen give a short, high-level overview of how the new documents connect to the other documents " +
      "in this thread: where they agree, add detail, or conflict. Cite passages from both.";
  }
  if (related.length > 0) {
    prompt +=
      "\n\nFinally, say briefly which of my other threads below the new documents relate to, and why. " +
      "Refer to them by their title in quotes (their documents aren't included here, so don't cite them).\n\n" +
      "My other threads:\n" +
      related.map((r) => `- "${r.title}"${r.docs ? ` (documents: ${r.docs})` : ""}${r.question ? `; I asked: "${r.question}"` : ""}`).join("\n");
  }
  prompt += "\n\nKeep the whole overview brief.";

  conversation.messages.push({
    role: "user", kind: "intake", time: new Date().toISOString(),
    text: `Summary of ${names}${others.length || related.length ? " and how it connects" : ""}`,
    prompt,
    query: added.map((d) => (docs[d.id]?.text ?? "").slice(0, 800)).join(" "),
    // Each new document's opening passages always come along.
    mustInclude: added.flatMap((d) => (docs[d.id]?.passages ?? []).slice(0, 3).map((p) => `${d.id}#${p.index}`)),
  });
  await storage.saveConversation(conversation);
  await askModel();
}

// Your other threads that share topics with the new documents (by shared words in their
// titles, document names and questions), best first. Only the top few are mentioned.
async function relatedThreads(added) {
  const newWords = new Set(added.flatMap((d) => words((docs[d.id]?.text ?? "").slice(0, 5000))).filter((w) => w.length > 3));
  const all = await storage.listConversations();
  return all
    .filter((c) => c.id !== conversation.id && c.messages.length > 0)
    .map((c) => {
      const docNames = documentsIn(c).map((d) => d.name);
      const questions = c.messages.filter((m) => m.role === "user" && m.text && !m.kind).map((m) => m.text);
      const theirs = new Set(words(`${c.title} ${docNames.join(" ")} ${questions.join(" ")}`));
      return {
        title: c.title,
        docs: docNames.join(", "),
        question: (questions[0] ?? "").slice(0, 120),
        score: [...theirs].filter((w) => newWords.has(w)).length,
      };
    })
    .filter((r) => r.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

// `modelOverride` is for tasks that use a set model, like link reviews.
async function askModel(modelOverride) {
  const { messages, numbers } = buildModelMessages();
  // Threads from before model switching don't have a model saved yet; this fills it in.
  conversation.model = resolveModel(conversation.model);
  const model = modelOverride ?? conversation.model;
  isWaiting = true;
  live = { text: "", shown: "", numbers, row: null };
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
    const answer = { role: "assistant", text: reply, time: new Date().toISOString(), model, citations: citationsUsed(reply, numbers) };
    // Gap analyses get checked (evidence, unsupported claims, house rules) whenever they're shown.
    if (conversation.messages.findLast((m) => m.role === "user")?.task === "gaps") answer.gap = true;
    conversation.messages.push(answer);
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
  const documents = documentsIn(conversation).map((d) => ({
    id: d.id, name: d.name, pageUnit: d.pageUnit, text: docs[d.id]?.text ?? "", passages: docs[d.id]?.passages,
    trustLabel: d.trustLabel,
  }));
  const talk = conversation.messages.filter((m) => m.role === "user" || m.role === "assistant");
  const last = talk[talk.length - 1];
  // Some questions are about particular documents only (a linked source, or sources
  // dropped on the message box). Then the AI only sees those.
  const only = last?.docIds?.length ? new Set(last.docIds) : null;

  const messages = [];
  let numbers = {};
  if (documents.length > 0) {
    // Passages the last two answers cited always come along, so follow-ups work.
    const recent = conversation.messages.filter((m) => m.role === "assistant").slice(-2);
    const mustInclude = new Set([...recent.flatMap((m) => citedKeys(m.text, m.citations)), ...(last?.mustInclude ?? [])]);
    const built = buildSourcesPrompt(documents, {
      query: last?.query ?? last?.text ?? "", budgetChars: PASSAGE_BUDGET_CHARS, onlyDocIds: only, mustInclude,
      task: last?.task ?? "answer",
      rulePack: formatRulePack(conversation.domain, domainRules), // this thread's domain terms and house rules
    });
    messages.push({ role: "system", content: built.prompt });
    numbers = built.numbers;
  }

  // Tell the AI which files arrived when, so "the new documents" means the right ones.
  let justAttached = [];
  for (const m of conversation.messages) {
    if (m.role === "event") justAttached.push(...m.attachments.map((a) => a.name));
    if (m.attachment) justAttached.push(m.attachment.name);
    if (m.role !== "user" && m.role !== "assistant") continue;

    // Link requests show a short line on screen but send the full instructions.
    let content = m.prompt ?? (m.text || (m.attachment ? `Please summarize "${m.attachment.name}".` : ""));
    // Earlier answers go back without their [n] markers: those numbers may point at
    // passages that aren't included this time.
    if (m.role === "assistant") content = stripCitations(content);
    if (m.role === "user" && justAttached.length > 0) {
      content = `(I just attached: ${justAttached.map((n) => `"${n}"`).join(", ")}.)\n\n` + content;
      justAttached = [];
    }
    if (m.refs?.length) {
      const names = m.refs.map((id) => `"${docById(id)?.name ?? "a removed document"}"`).join(", ");
      content += `\n\n(Focus on these documents: ${names}.)`;
    }
    if (m === last && documents.length > 0) content += CITE_REMINDER;
    messages.push({ role: m.role, content });
  }
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
    for (const key of citedKeys(msg.text, msg.citations, true)) {
      if (!numberOf.has(key)) numberOf.set(key, numberOf.size + 1);
      uses += 1;
    }
  }
  return { numberOf, uses };
}

// The passage keys a reply cites, in order (every use, or each passage once).
function citedKeys(text, citations, everyUse = false) {
  const keys = [];
  for (const c of findCitations(text)) {
    for (const n of c.numbers) {
      const ref = citations?.[n];
      if (ref && docById(ref.docId)) keys.push(`${ref.docId}#${ref.index}`);
    }
  }
  return everyUse ? keys : [...new Set(keys)];
}

const docIdOf = (key) => key.split("#")[0];
const passageOf = (key) => docs[docIdOf(key)]?.passages[Number(key.split("#")[1])];
const docById = (id) => documentsIn(conversation).find((d) => d.id === id);
// Each source's line style (color + dash pattern) comes from its position in the thread.
const docStyle = (docId) => styleFor(Math.max(0, documentsIn(conversation).findIndex((d) => d.id === docId)));
const srcColor = (docId) => colorOf(docStyle(docId));
// A reply's citations, minus any pointing at documents that have since been deleted.
const existingCitations = (citations) =>
  citations && Object.fromEntries(Object.entries(citations).filter(([, ref]) => docById(ref.docId)));

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
// Every item gets a link id ("m3" = the 4th saved message) so links you draw stay attached.
// Chats from before the redesign kept a file on the user's message; that becomes its own
// "documents added" event, like new threads have.
function threadItems() {
  const items = [];
  conversation.messages.forEach((msg, i) => {
    if (msg.role === "event" && msg.attachments.length === 0) return; // all its documents were deleted
    if (msg.attachment) {
      items.push({ role: "event", time: msg.attachment.addedAt, attachments: [msg.attachment], linkId: `m${i}d` });
    }
    items.push({ ...msg, linkId: `m${i}` });
  });
  return items;
}

function renderThread({ keepScroll = false } = {}) {
  const scrollBefore = el.scroller.scrollTop;
  const items = threadItems();
  el.main.classList.toggle("is-empty", items.length === 0 && !live);
  el.thread.classList.toggle("is-live", Boolean(live));

  const { numberOf } = citationIndex();
  el.messages.innerHTML = "";
  for (const item of items) el.messages.append(messageRow(item, numberOf));
  if (live) {
    live.row = liveRow();
    el.messages.append(live.row);
  }
  wireCitations();
  el.scroller.scrollTop = keepScroll ? scrollBefore : el.scroller.scrollHeight;
}

// A row is the message itself, plus (in Focus mode) a connector and its margin notes.
function messageRow(item, numberOf) {
  const row = document.createElement("div");
  row.className = "msg-row";
  row.append(messageBlock(item, numberOf));
  if (item.role === "assistant") addNotes(row, item.text, item.citations, numberOf);
  return row;
}

function messageBlock(item, numberOf) {
  const block = document.createElement("div");
  block.className = `msg msg-${item.role}` + (item.kind ? " msg-link-request" : "");
  if (item.linkId) block.dataset.linkId = item.linkId;
  block.append(node(item.linkId), label(item));

  if (item.role === "event") {
    const chips = document.createElement("div");
    chips.className = "doc-chips";
    for (const doc of item.attachments) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "doc-chip";
      chip.title = "Read this document";
      chip.style.setProperty("--src", srcColor(doc.id));
      chip.innerHTML = icons.fileText(16);
      chip.append(textSpan(doc.name, "doc-chip-name"), textSpan(shortCount(doc), "doc-chip-meta"));
      chip.onclick = () => openViewer(doc);
      chips.append(chip);
    }
    block.append(chips);
    return block;
  }

  if (item.refs?.length) {
    const refs = document.createElement("div");
    refs.className = "msg-refs";
    for (const id of item.refs) {
      const ref = textSpan(docById(id)?.name ?? "Removed document", "ref-chip");
      ref.insertAdjacentHTML("afterbegin", icons.fileText(12));
      refs.append(ref);
    }
    block.append(refs);
  }

  if (item.text) {
    const body = document.createElement("div");
    body.className = "msg-body";
    if (item.role === "assistant") {
      body.classList.add("formatted");
      showFormatted(body, item.text, existingCitations(item.citations), numberOf);
      if (item.gap) {
        block.append(body);
        showGapChecks(block, body, item);
        return block;
      }
    } else {
      body.textContent = item.text; // your own words: always plain text
    }
    block.append(body);
  }
  return block;
}

// The dot on the thread line. You can drag it onto something to link them.
function node(linkId) {
  const span = document.createElement("span");
  span.className = "node";
  if (linkId) {
    span.dataset.dragFrom = linkId;
    span.title = "Drag to link";
  }
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
  if (item.kind === "link") div.firstChild.textContent = "You linked";
  if (item.kind === "gaps") div.firstChild.textContent = "Gap analysis";
  if (item.kind === "intake") div.firstChild.textContent = "New documents";
  // One chip per source this message is linked to: "↔ MedRec_Policy_2024".
  // The link's line starts here, so you can see what it's attached to.
  if (item.linkId) {
    conversation.links.forEach((link, index) => {
      const other = link.a === item.linkId ? link.b : link.b === item.linkId ? link.a : null;
      if (!other?.startsWith("s:")) return;
      const doc = docById(other.slice(2));
      const chip = textSpan(`↔ ${shortName(doc?.name ?? "removed document")}`, "link-chip");
      chip.dataset.linkPort = String(index);
      chip.style.setProperty("--src", srcColor(other.slice(2)));
      chip.title = "Linked to this source. Click the line to remove the link.";
      div.append(chip);
    });
  }
  return div;
}

// The reply being written right now: a pulsing node, a status, and a blinking caret.
function liveRow() {
  const row = document.createElement("div");
  row.className = "msg-row";
  const block = document.createElement("div");
  block.className = "msg msg-assistant is-live";
  const lastQuestion = conversation.messages.findLast((m) => m.role === "user");
  const docCount = lastQuestion?.docIds?.length ?? documentsIn(conversation).length;
  const status = docCount ? `Tracing ${plural(docCount, "source")}…` : "Thinking…";
  const head = label({ role: "assistant" });
  head.append(textSpan(status, "live-status"));
  const body = document.createElement("div");
  body.className = "msg-body formatted";
  body.innerHTML = '<span class="caret"></span>';
  const seg = document.createElement("span");
  seg.className = "live-seg";
  seg.innerHTML = '<svg width="3" height="26"><line x1="1.5" y1="0" x2="1.5" y2="26"/></svg>';
  block.append(seg, node(), head, body);
  row.append(block);
  return row;
}

// Called by getModelResponse each time more of the reply arrives.
// We only show up to the last finished sentence or line, so text appears in
// whole pieces rather than half-words. (Show `live.text` as-is for word-by-word.)
function updateLiveReply() {
  if (!live?.row) return;
  const finished = upToLastCompletePiece(live.text);
  if (!finished || finished === live.shown) return;
  live.shown = finished;

  const { numberOf } = citationIndex();
  const body = live.row.querySelector(".msg-body");
  showFormatted(body, finished, live.numbers, numberOf);
  // Put the blinking caret at the end of the last paragraph or list item.
  let last = body;
  while (last.lastElementChild && !last.lastElementChild.matches("pre, table, .cite")) last = last.lastElementChild;
  last.insertAdjacentHTML("beforeend", '<span class="caret"></span>');

  addNotes(live.row, finished, live.numbers, numberOf);
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
  const row = document.createElement("div");
  row.className = "msg-row";
  const block = document.createElement("div");
  block.className = "msg msg-error";
  block.append(node(), textSpan(message, "msg-body"));
  row.append(block);
  el.main.classList.remove("is-empty");
  el.messages.append(row);
  el.scroller.scrollTop = el.scroller.scrollHeight;
}

// Give each citation an id (so a pinned one stays pinned after redrawing),
// and hook up hovering and clicking.
function wireCitations() {
  el.messages.querySelectorAll(".cite[data-key]").forEach((cite, i) => {
    const anchor = `c${i}`;
    const key = cite.dataset.key;
    cite.dataset.anchor = anchor;
    cite.classList.toggle("is-pinned", pinned.has(anchor) || review.anchor === anchor);
    cite.style.setProperty("--src", srcColor(docIdOf(key)));
    cite.title = mode === "review" ? "Show this passage" : "Hover to trace · click to keep the line";
    cite.onmouseenter = () => setHover({ type: "cite", anchor });
    cite.onmouseleave = () => setHover(null);
    cite.onclick = () => {
      if (mode === "review") return showInReview(docIdOf(key), key, anchor);
      pinned.has(anchor) ? pinned.delete(anchor) : pinned.add(anchor);
      cite.classList.toggle("is-pinned", pinned.has(anchor));
      if (mode === "standard" && !sourcesOpen) toggleSources(); // the line needs the panel to land on
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

// ---------- Focus mode: margin notes ----------
// Beside each answer: one note per passage it cites, with a quote from the passage.
// (The notes exist in every mode but styles.css only shows them in Focus.)
function addNotes(row, text, citations, numberOf) {
  row.querySelectorAll(".msg-gutter, .msg-notes").forEach((n) => n.remove());
  const keys = citedKeys(text, citations);
  if (keys.length === 0) return;

  const gutter = document.createElement("div");
  gutter.className = "msg-gutter";
  gutter.innerHTML =
    '<svg width="64" height="36" viewBox="0 0 64 36" fill="none" aria-hidden="true">' +
    '<path d="M4 8 C 22 8, 24 26, 34 26 S 48 12, 60 12"/></svg>';

  const notes = document.createElement("div");
  notes.className = "msg-notes";
  for (const key of keys) {
    const doc = docById(docIdOf(key));
    const passage = passageOf(key);
    if (!doc || !passage) continue;
    const note = document.createElement("button");
    note.type = "button";
    note.className = "note";
    note.dataset.noteKey = key;
    note.style.setProperty("--src", srcColor(doc.id));
    note.title = "Read this passage";

    const head = document.createElement("div");
    head.className = "note-head";
    const marker = textSpan(String(numberOf.get(key) ?? "?"), "cite cite-static");
    const place = passagePlace(passage, doc.pageUnit);
    head.append(marker, textSpan(shortName(doc.name) + (place ? ` · ${place}` : ""), "note-source"));
    const quote = passage.text.replace(/\s+/g, " ");
    note.append(head, textSpan(`“${quote.length > 150 ? quote.slice(0, 150) + "…" : quote}”`, "note-quote"));

    note.onmouseenter = () => setHover({ type: "note", key, row });
    note.onmouseleave = () => setHover(null);
    note.onclick = () => openViewer(doc, Number(key.split("#")[1]));
    notes.append(note);
  }
  row.append(gutter, notes);
}

// ---------- Sources panel (right column, Standard mode) ----------
let trustPicker = null;
function renderSources() {
  el.sources.classList.toggle("is-closed", !sourcesOpen);
  el.toggleSources.setAttribute("aria-pressed", String(sourcesOpen));

  const list = documentsIn(conversation);
  const { numberOf, uses } = citationIndex();
  if (list.length === 0) selectingSources = false;
  el.selectSources.hidden = list.length === 0 || selectingSources;
  el.sourceSelectBar.hidden = !selectingSources;
  el.helpBox.hidden = selectingSources;
  el.sourceSelectCount.textContent = `${selectedSources.size} selected`;
  el.sourcesSummary.textContent = list.length ? `${plural(list.length, "document")} · ${plural(uses, "citation")}` : "";

  el.sourceCards.innerHTML = "";
  if (list.length === 0) {
    el.sourceCards.append(textSpan("Attached documents appear here, with the passages each answer cites.", "sources-empty"));
    return;
  }

  for (const doc of list) {
    const style = docStyle(doc.id);
    const card = document.createElement("div");
    card.className = "source-card";
    card.dataset.linkId = `s:${doc.id}`;
    card.style.setProperty("--src", colorOf(style));
    card.onmouseenter = () => hoverSource({ type: "source", docId: doc.id });
    card.onmouseleave = () => hoverSource(null);

    // The diamond on the card's edge: drag it onto a message to link them,
    // or onto the message box to ask about this document.
    const handle = document.createElement("span");
    const isLinked = conversation.links.some((l) => l.a === `s:${doc.id}` || l.b === `s:${doc.id}`);
    handle.className = "source-handle" + (isLinked ? " is-linked" : "");
    handle.dataset.dragFrom = `s:${doc.id}`;
    handle.title = "Drag to link, or drop on the message box to ask about it";

    const head = document.createElement("button");
    head.type = "button";
    head.className = "source-head";
    head.title = "Read this document";
    head.innerHTML = icons.fileText(18);
    const text = document.createElement("div");
    // The small line sample shows this source's line color and pattern, like a map legend.
    const meta = textSpan(documentMeta(doc), "source-meta");
    meta.insertAdjacentHTML("afterbegin", swatch(style, 20));
    text.append(textSpan(doc.name, "source-name"), meta);
    head.append(text);
    trustPicker = makeTrustPicker(doc);
    head.onclick = () => (selectingSources ? toggleIn(selectedSources, doc.id, renderSources) : openViewer(doc));
    card.append(handle, head, trustPicker);
    if (selectingSources) {
      card.classList.toggle("is-selected", selectedSources.has(doc.id));
      card.append(checkMark(selectedSources.has(doc.id)));
    } else {
      const remove = actionButton(icons.trash(14), "Delete this source", () => removeSources([doc.id]));
      remove.className = "source-delete";
      card.append(remove);
    }

    // One row per passage of this document that has been cited, in citation order.
    const cited = [...numberOf].filter(([key]) => docIdOf(key) === doc.id);
    if (cited.length > 0) {
      const rows = document.createElement("div");
      rows.className = "source-rows";
      for (const [key, number] of cited) {
        const passage = passageOf(key);
        const row = document.createElement("button");
        row.type = "button";
        row.className = "source-row";
        row.title = "Show this passage";
        const marker = textSpan(String(number), "cite cite-static");
        marker.dataset.rowKey = key;
        row.append(marker, textSpan(passage ? passageLabel(passage, doc.pageUnit) : "Passage unavailable", "source-row-label"));
        row.onmouseenter = () => hoverSource({ type: "passage", key });
        row.onmouseleave = () => hoverSource({ type: "source", docId: doc.id });
        row.onclick = () => openViewer(doc, Number(key.split("#")[1]));
        rows.append(row);
      }
      card.append(rows);
    }

    const linkCount = conversation.links.filter((l) => l.a === `s:${doc.id}` || l.b === `s:${doc.id}`).length;
    if (linkCount > 0) card.append(textSpan(`Linked to ${plural(linkCount, "item")}`, "source-linked"));
    el.sourceCards.append(card);
  }
}

function documentMeta(doc) {
  const parts = [doc.type ?? "File"];
  if (doc.pages) parts.push(plural(doc.pages, doc.pageUnit === "sheet" ? "sheet" : "page"));
  if (doc.addedAt) parts.push(`added ${shortWhen(doc.addedAt)}`);
  return parts.join(" · ");
}

// "18 pp", "3 sheets" or just the type, for the small chips.
function shortCount(doc) {
  if (!doc.pages) return doc.type ?? "";
  return doc.pageUnit === "sheet" ? plural(doc.pages, "sheet") : `${doc.pages} pp`;
}

function toggleSources() {
  sourcesOpen = !sourcesOpen;
  saveSetting("sourcesOpen", sourcesOpen);
  renderSources();
  refreshLines();
}

// ---------- Review mode: the document viewer ----------
// Shows one of the thread's documents beside the conversation. Clicking a citation
// switches to its document, sweeps a highlight over the passage and draws a line to it.
function renderReview() {
  if (mode !== "review") return;
  const list = documentsIn(conversation);
  if (!list.some((d) => d.id === review.docId)) review.docId = list[0]?.id ?? null;

  el.reviewTabs.innerHTML = "";
  for (const doc of list) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "review-tab" + (doc.id === review.docId ? " is-active" : "");
    tab.style.setProperty("--src", srcColor(doc.id));
    tab.innerHTML = icons.fileText(14);
    tab.append(textSpan(doc.name, "review-tab-name"));
    tab.onclick = () => showInReview(doc.id, null, null);
    el.reviewTabs.append(tab);
  }

  el.reviewPage.innerHTML = "";
  const doc = docById(review.docId);
  if (!doc) {
    el.reviewPage.append(textSpan("Attach documents to review them here, next to the conversation.", "sources-empty"));
    el.reviewIndicator.textContent = "";
    return;
  }

  el.reviewPage.append(textSpan(`${doc.name} · ${documentMeta(doc)}`, "review-doc-meta"));
  let page = 1;
  for (const passage of docs[doc.id]?.passages ?? []) {
    if (passage.page && passage.page !== page) {
      page = passage.page;
      el.reviewPage.append(textSpan(doc.pageUnit === "sheet" ? `Sheet ${page}` : `Page ${page}`, "page-break"));
    }
    const p = document.createElement("p");
    p.className = "review-passage";
    p.dataset.passageKey = `${doc.id}#${passage.index}`;
    p.dataset.page = passage.page ?? "";
    p.textContent = passage.text;
    el.reviewPage.append(p);
  }

  const selected = review.key && el.reviewPage.querySelector(`[data-passage-key="${CSS.escape(review.key)}"]`);
  if (selected) {
    selected.scrollIntoView({ block: "center", behavior: "instant" });
    selected.classList.add("is-selected"); // plays the sweep + margin bar animation
  } else {
    el.reviewScroll.scrollTop = 0;
  }
  updatePageIndicator();
}

function showInReview(docId, key, anchor) {
  review = { docId, key, anchor };
  renderReview();
  wireCitations();
  refreshLines();
}

// "p. 3 / 18": the page at the top of the viewer (or the highlighted passage's page).
function updatePageIndicator() {
  const doc = docById(review.docId);
  if (!doc) return;
  if (!doc.pages) {
    el.reviewIndicator.textContent = plural(docs[doc.id]?.passages.length ?? 0, "passage");
    return;
  }
  // The highlighted passage's page while it's in view; otherwise the page at the top.
  const box = el.reviewScroll.getBoundingClientRect();
  const selected = el.reviewPage.querySelector(".review-passage.is-selected");
  const passages = [...el.reviewPage.querySelectorAll(".review-passage")];
  const current =
    selected && isInside(centerOf(selected), box)
      ? selected
      : passages.find((p) => p.getBoundingClientRect().bottom > box.top + 40) ?? passages[0];
  const unit = doc.pageUnit === "sheet" ? "sheet" : "p.";
  el.reviewIndicator.textContent = `${unit} ${current?.dataset.page || 1} / ${doc.pages}`;
}

// ---------- Lines and hovering ----------
// Kinds of hover: a citation, a source card, a cited passage (Sources row), or a Focus note.
function setHover(value) {
  hover = value;
  refreshLines();
}

// Hovering something on the right also scrolls the thread to where it's cited,
// after a short pause (so sweeping the mouse across doesn't jerk the page around).
let hoverTimer = 0;
function hoverSource(value) {
  setHover(value);
  clearTimeout(hoverTimer);
  if (value) hoverTimer = setTimeout(() => scrollToCitations(value), 250);
}

function scrollToCitations(target) {
  const matches = [...el.messages.querySelectorAll(".cite[data-key]")].filter((c) =>
    target.type === "source" ? docIdOf(c.dataset.key) === target.docId : c.dataset.key === target.key
  );
  if (matches.length === 0) return;
  const box = el.scroller.getBoundingClientRect();
  if (matches.some((c) => isInside(centerOf(c), box))) return; // one is already in view

  const middle = box.top + box.height / 2;
  const nearest = matches.reduce((a, b) =>
    Math.abs(centerOf(a).y - middle) <= Math.abs(centerOf(b).y - middle) ? a : b
  );
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scroller.scrollTo({ top: el.scroller.scrollTop + (centerOf(nearest).y - middle), behavior: smooth ? "smooth" : "auto" });
}

// Work out which lines should show and where they start and end, then draw them.
function refreshLines() {
  const traces = [];
  for (const cite of el.messages.querySelectorAll(".cite[data-key]")) {
    const { anchor, key } = cite.dataset;
    const show =
      pinned.has(anchor) ||
      (mode === "review" && review.anchor === anchor) ||
      (hover?.type === "cite" && hover.anchor === anchor) ||
      (hover?.type === "source" && docIdOf(key) === hover.docId) ||
      (hover?.type === "passage" && key === hover.key) ||
      (hover?.type === "note" && key === hover.key && hover.row.contains(cite));
    if (!show) continue;

    const target = lineTargetFor(cite, key);
    if (!target) continue;
    const from = centerOf(cite);
    // In Review, the line lands in the margin beside the passage, where the bar grows.
    const to = mode === "review" ? marginOf(target) : centerOf(target);
    if (!isVisible(from, cite) || !isVisible(to, target)) continue;
    traces.push({ key: anchor, from, to, style: docStyle(docIdOf(key)) });
  }

  drawLines(el.lines, { traces, links: linkLines(), drag: dragLine() });
}

// Where a citation's line ends, depending on the mode.
function lineTargetFor(cite, key) {
  if (mode === "focus") return cite.closest(".msg-row")?.querySelector(`[data-note-key="${CSS.escape(key)}"] .cite`);
  if (mode === "review") return el.reviewPage.querySelector(`[data-passage-key="${CSS.escape(key)}"]`);
  return el.sourceCards.querySelector(`[data-row-key="${CSS.escape(key)}"]`);
}

function centerOf(element) {
  const r = element.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
}
function marginOf(element) {
  const r = element.getBoundingClientRect();
  return { x: Math.round(r.left - 25), y: Math.round(r.top + 10) };
}
const isInside = (p, box) => p.y >= box.top && p.y <= box.bottom && p.x >= box.left - 30 && p.x <= box.right;

// A point counts as visible if it's inside the scrolling area its element lives in.
function isVisible(point, element) {
  if (!element.isConnected || element.getClientRects().length === 0) return false;
  const area = element.closest(".scroller, .source-cards, .review-scroll");
  return area ? isInside(point, area.getBoundingClientRect()) : true;
}

// Redraw (at most once per frame) whenever something scrolls or the window resizes.
let lineFrame = 0;
const scheduleLines = () => {
  cancelAnimationFrame(lineFrame);
  lineFrame = requestAnimationFrame(refreshLines);
};
el.scroller.addEventListener("scroll", scheduleLines);
el.sourceCards.addEventListener("scroll", scheduleLines);
el.reviewScroll.addEventListener("scroll", () => {
  scheduleLines();
  updatePageIndicator();
});
window.addEventListener("resize", scheduleLines);
document.fonts?.ready.then(scheduleLines);

// ---------- Drag a dot to link things ----------
// Press on a message's dot (or a source's diamond), drag, and let go over:
//   • another message or a source card → a saved link line between them
//   • the message box (sources only)  → the next question will focus on that source
document.addEventListener("pointerdown", (event) => {
  const handle = event.target.closest("[data-drag-from]");
  if (!handle || event.button !== 0) return;
  event.preventDefault(); // don't start selecting text
  drag = { from: handle.dataset.dragFrom, to: { x: event.clientX, y: event.clientY } };
  hover = null;
  document.body.classList.add("is-dragging");
  scheduleLines();
});

document.addEventListener("pointermove", (event) => {
  if (!drag) return;
  drag.to = { x: event.clientX, y: event.clientY };
  document.querySelectorAll(".is-drop-target").forEach((t) => t.classList.remove("is-drop-target"));
  const target = dropTargetAt(event.clientX, event.clientY);
  target?.classList.add("is-drop-target");
  // Over something you can link to, the line snaps onto its anchor point.
  drag.snap = target ? snapPoint(target) : null;
  scheduleLines();
});

document.addEventListener("pointerup", async (event) => {
  if (!drag) return;
  const from = drag.from;
  const target = dropTargetAt(event.clientX, event.clientY);
  drag = null;
  document.body.classList.remove("is-dragging");
  document.querySelectorAll(".is-drop-target").forEach((t) => t.classList.remove("is-drop-target"));
  await finishDrag(from, target);
  scheduleLines();
});

// What's under the pointer that a dot can be dropped on (looking through the lines layer).
function dropTargetAt(x, y) {
  for (const element of document.elementsFromPoint(x, y)) {
    const target = element.closest("[data-link-id], #composer");
    if (target && !target.closest("#lines")) return target;
  }
  return null;
}

// Where a dragged line attaches on a target: a source's diamond, a message's dot,
// or the top of the message box.
function snapPoint(target) {
  if (target === el.composer) {
    const r = target.getBoundingClientRect();
    return { x: Math.round(r.left + 40), y: Math.round(r.top) };
  }
  const anchor = target.querySelector(":scope > .source-handle, :scope > .node");
  return anchor ? centerOf(anchor) : null;
}

async function finishDrag(from, target) {
  if (!target) return;
  if (target === el.composer) {
    if (!from.startsWith("s:")) return; // only sources can be dropped on the message box
    const docId = from.slice(2);
    if (!conversation.composerRefs.includes(docId)) conversation.composerRefs.push(docId);
    await saveQuietly();
    renderComposer();
    el.input.focus();
    return;
  }
  const to = target.dataset.linkId;
  const exists = conversation.links.some((l) => (l.a === from && l.b === to) || (l.a === to && l.b === from));
  if (to === from || exists) return;
  conversation.links.push({ a: from, b: to });
  await saveQuietly();
  if (isWaiting) return render({ keepScroll: true }); // busy answering: just keep the link
  await reviewConnection(from, to);
}

// When you link two things, Threadline looks through the material for how they connect.
// A short "You linked A ↔ B" line goes on the thread; the AI gets fuller instructions
// and only the documents involved (or all of them, when you link two messages).
async function reviewConnection(a, b) {
  const A = describeEnd(a);
  const B = describeEnd(b);
  if (!A || !B) return render({ keepScroll: true });

  const docIds = [A, B].flatMap((end) => end.docIds);
  const prompt =
    `I linked ${A.long}\n\nwith ${B.long}.\n\n` +
    "Review the documents for how these two connect: where the material supports, adds to, " +
    "or contradicts one against the other. Be specific and cite the passages you rely on. " +
    "If you find no real connection, say so plainly.";
  conversation.messages.push({
    role: "user", kind: "link", time: new Date().toISOString(),
    text: `${A.short} ↔ ${B.short}`, prompt, docIds: docIds.length > 0 ? docIds : null,
    query: [A.searchText, B.searchText].join(" "),
  });
  await storage.saveConversation(conversation);
  await askModel(LINK_REVIEW_MODEL);
}

// How to describe one end of a link: shortly (on screen) and fully (to the AI).
function describeEnd(linkId) {
  if (linkId.startsWith("s:")) {
    const doc = docById(linkId.slice(2));
    if (!doc) return null;
    return { short: doc.name, long: `the document "${doc.name}"`, docIds: [doc.id], searchText: "" };
  }
  const item = threadItems().find((i) => i.linkId === linkId);
  if (!item) return null;
  if (item.role === "event") {
    const names = item.attachments.map((d) => `"${d.name}"`).join(", ");
    return { short: names, long: `the documents ${names}`, docIds: item.attachments.map((d) => d.id), searchText: "" };
  }
  const who = item.kind === "link" ? "my link request" : item.role === "user" ? "my question" : "your earlier answer";
  const text = item.text ?? "";
  return {
    short: `“${text.length > 50 ? text.slice(0, 50) + "…" : text}”`,
    long: `${who}:\n"""\n${text}\n"""`,
    docIds: [],
    searchText: stripCitations(text),
  };
}

// Click a link line to remove it.
el.lines.addEventListener("click", async (event) => {
  const hit = event.target.closest(".link-hit");
  if (!hit) return;
  conversation.links.splice(Number(hit.dataset.linkIndex), 1);
  await saveQuietly();
  render({ keepScroll: true });
});

// The saved links, as lines. Message↔source links start just right of the message
// (so the line stays out of the text); message↔message links bow out to the left.
function linkLines() {
  const lines = [];
  conversation.links.forEach((link, index) => {
    const a = linkEnd(link.a, link.b, index);
    const b = linkEnd(link.b, link.a, index);
    if (!a || !b) return; // an end isn't on screen in this mode
    const sourceId = [link.a, link.b].find((id) => id.startsWith("s:"));
    lines.push({
      key: `l${link.a}-${link.b}`, from: a, to: b, index, faded: a.offScreen || b.offScreen,
      style: sourceId && ![link.a, link.b].every((id) => id.startsWith("s:")) ? docStyle(sourceId.slice(2)) : "thread",
    });
  });
  return lines;
}

// If an end is scrolled out of view, the line runs to the edge of that panel instead
// (pointing the way to it), so links stay visible. Ends that aren't shown at all in
// this mode (e.g. Sources in Focus mode) hide the line.
function linkEnd(id, otherId, index) {
  if (id.startsWith("s:")) {
    const handle = el.sourceCards.querySelector(`[data-link-id="${CSS.escape(id)}"] .source-handle`);
    return handle ? keepInView(centerOf(handle), handle) : null;
  }
  const block = el.messages.querySelector(`[data-link-id="${CSS.escape(id)}"]`);
  if (!block) return null;
  // Linked to a source: start at the "↔ source" chip beside the message's name.
  // Linked to another message: start at the message's dot on the thread line.
  const chip = otherId.startsWith("s:") && block.querySelector(`[data-link-port="${index}"]`);
  let p;
  if (chip) {
    const r = chip.getBoundingClientRect();
    p = { x: Math.round(r.right + 3), y: Math.round(r.top + r.height / 2) };
  } else {
    p = centerOf(block.querySelector(".node"));
  }
  const kept = keepInView(p, block);
  // Scrolled out of view: run along the empty margin right of the text, not across it.
  if (kept?.offScreen && otherId.startsWith("s:")) kept.x = Math.round(block.getBoundingClientRect().right + 12);
  return kept;
}

function keepInView(point, element) {
  if (!element.isConnected || element.getClientRects().length === 0) return null;
  const area = element.closest(".scroller, .source-cards, .review-scroll");
  if (!area) return point;
  const box = area.getBoundingClientRect();
  if (box.height === 0) return null;
  const y = Math.min(Math.max(point.y, box.top + 6), box.bottom - 6);
  return { x: point.x, y, offScreen: y !== point.y };
}

function dragLine() {
  if (!drag) return null;
  const handle = document.querySelector(`[data-drag-from="${CSS.escape(drag.from)}"]`);
  return handle ? { from: centerOf(handle), to: drag.snap ?? drag.to } : null;
}

// ---------- Document pop-up (Standard and Focus) ----------
// Shows the text we pulled out of a document, with page breaks marked, and
// optionally one passage highlighted and scrolled into view. In Review mode,
// documents open in the viewer beside the conversation instead.
function openViewer(doc, passageIndex) {
  if (mode === "review") {
    return showInReview(doc.id, passageIndex !== undefined ? `${doc.id}#${passageIndex}` : null, null);
  }
  const { text = "", passages = [] } = docs[doc.id] ?? {};
  const highlight = passageIndex !== undefined ? passages[passageIndex] : null;

  $("file-viewer-title").textContent = doc.name;
  let note = documentMeta(doc) + ` · ${text.length.toLocaleString()} characters`;
  $("file-viewer-note").textContent = note;

  const out = $("file-viewer-text");
  out.innerHTML = "";
  let offset = 0;
  text.split("\f").forEach((pageText, i) => {
    if (i > 0) out.append(textSpan(doc.pageUnit === "sheet" ? `Sheet ${i + 1}` : `Page ${i + 1}`, "page-break"));
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
  el.input.placeholder =
    isEmpty ? "Ask anything, or drop files here" : mode === "review" ? "Ask about these sources" : "Continue the thread";
  const stillReading = pending.some((p) => !p.extracted);
  el.hint.textContent = stillReading ? "Sends when all files are read" : "";
  el.send.disabled = isWaiting || stillReading;
  el.modelSelect.value = resolveModel(conversation.model);
  el.modelSelect.disabled = isWaiting; // no switching halfway through an answer
  el.domainSelect.value = domainRules[conversation.domain] ? conversation.domain : "";
  el.domainSelect.disabled = isWaiting;
  const labels = new Set(documentsIn(conversation).map((d) => d.trustLabel));
  el.findGaps.hidden = !(labels.has("Authoritative") && labels.has("Observed"));
  el.findGaps.disabled = isWaiting || stillReading;
  el.composer.classList.toggle("has-pending", pending.length > 0);

  // Sources dropped on the box: "ask about these".
  el.composerRefs.innerHTML = "";
  for (const docId of conversation.composerRefs) {
    const chip = textSpan(docById(docId)?.name ?? "Removed document", "ref-chip");
    chip.insertAdjacentHTML("afterbegin", icons.fileText(13));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip-remove";
    remove.title = "Remove";
    remove.innerHTML = icons.x(12);
    remove.onclick = async () => {
      conversation.composerRefs = conversation.composerRefs.filter((id) => id !== docId);
      await saveQuietly();
      renderComposer();
    };
    chip.append(remove);
    el.composerRefs.append(chip);
  }

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
  const { type, pages, pageUnit, text } = item.extracted;
  const parts = [type];
  if (pages) parts.push(plural(pages, pageUnit === "sheet" ? "sheet" : "page"));
  parts.push("Ready");
  return parts.join(" · ");
}

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
  if (!event.dataTransfer?.types.includes("Files")) return;
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

// ---------- Model picker ----------
const modelLabel = (id) => MODELS.find((m) => m.id === id)?.label ?? id;

for (const m of MODELS) el.modelSelect.add(new Option(m.label, m.id));

el.modelSelect.addEventListener("change", async () => {
  conversation.model = el.modelSelect.value;
  // Save it right away for threads that already exist, so reopening them keeps the choice.
  // (A brand-new thread gets saved with it when you send the first message.)
  await saveQuietly();
  el.input.focus();
});

// ---------- Header and modes ----------
function renderHeader() {
  el.title.textContent = conversation.title;
  const count = documentsIn(conversation).length;
  el.sourcesPill.hidden = count === 0;
  el.sourcesPill.textContent = plural(count, "source");

  // The Standard / Focus / Review switch (there's one in each header).
  for (const container of document.querySelectorAll(".mode-switch")) {
    container.innerHTML = "";
    for (const [id, name] of [["standard", "Standard"], ["focus", "Focus"], ["review", "Review"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mode-option";
      button.textContent = name;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(mode === id));
      button.onclick = () => setMode(id);
      container.append(button);
    }
  }
}

// Switching modes keeps the thread, its messages, pinned lines and links.
function setMode(newMode) {
  if (newMode === mode) return;
  mode = newMode;
  saveSetting("mode", mode);
  document.body.dataset.mode = mode;
  closeDrawer();
  render();
}

el.toggleSources.addEventListener("click", toggleSources);

// ---------- Sidebar (past threads) ----------
async function renderSidebar() {
  const all = await storage.listConversations();
  el.selectThreads.hidden = selectingThreads || all.length === 0;
  el.threadSelectBar.hidden = !selectingThreads;
  el.threadSelectCount.textContent = `${selectedThreads.size} selected`;
  renderThreadPicker(all);

  let saved = all;
  if (searchText) {
    const q = searchText.toLowerCase();
    saved = all.filter((c) => c.title.toLowerCase().includes(q) || c.messages.some((m) => m.text?.toLowerCase().includes(q)));
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
  if (selectingThreads) item.classList.toggle("is-selected", selectedThreads.has(conv.id));

  if (conv.id === renamingId) {
    item.append(renameBox(conv));
    return item;
  }

  const open = document.createElement("button");
  open.type = "button";
  open.className = "history-open";
  open.title = "Double-click to open in Focus mode";
  const talk = conv.messages.filter((m) => m.role === "user" || m.role === "assistant").length;
  const sourceCount = documentsIn(conv).length;
  const meta = plural(talk, "message") + (sourceCount ? ` · ${plural(sourceCount, "source")}` : "");
  open.append(textSpan(conv.title, "history-title"), textSpan(meta, "history-meta"));
  open.onclick = () => {
    if (selectingThreads) return toggleIn(selectedThreads, conv.id, renderSidebar);
    if (!isWaiting && conv.id !== conversation.id) showConversation(conv);
  };
  // Double-click: open this thread in Focus mode (sidebar folds away, sources move beside the answers).
  open.ondblclick = () => {
    if (!isWaiting && !selectingThreads) setMode("focus");
  };
  if (selectingThreads) {
    item.append(open, checkMark(selectedThreads.has(conv.id)));
    return item;
  }

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

// Review mode's thread switcher (in its top bar, since there's no sidebar).
function renderThreadPicker(all) {
  el.threadPicker.innerHTML = "";
  el.threadPicker.add(new Option("+ New thread", "__new"));
  if (!all.some((c) => c.id === conversation.id)) el.threadPicker.add(new Option(conversation.title, conversation.id));
  for (const conv of all) el.threadPicker.add(new Option(conv.title, conv.id));
  el.threadPicker.value = conversation.id;
}

el.threadPicker.addEventListener("change", async () => {
  if (isWaiting) return (el.threadPicker.value = conversation.id);
  if (el.threadPicker.value === "__new") return showConversation(makeNewThread());
  const conv = (await storage.listConversations()).find((c) => c.id === el.threadPicker.value);
  if (conv) showConversation(conv);
});

el.search.addEventListener("input", () => {
  searchText = el.search.value.trim();
  renderSidebar();
});

function newThread() {
  if (isWaiting) return;
  showConversation(makeNewThread());
  el.input.focus();
}
el.newThread.addEventListener("click", newThread);
$("rail-new").addEventListener("click", newThread);

// In Focus mode, History and Search slide the full sidebar out over the page.
function openDrawer(focusSearch) {
  document.body.classList.add("drawer-open");
  if (focusSearch) el.search.focus();
}
function closeDrawer() {
  document.body.classList.remove("drawer-open");
}
$("rail-history").addEventListener("click", () => openDrawer(false));
$("rail-search").addEventListener("click", () => openDrawer(true));
$("drawer-backdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
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
    event.stopPropagation(); // Escape here cancels the rename, not the drawer
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

// ---------- Gaps, trust labels, domains and house rules ----------

// "Find gaps": compare what the Authoritative sources require with what the Observed ones show.
el.findGaps.addEventListener("click", async () => {
  if (isWaiting) return;
  const byLabel = (label) => documentsIn(conversation).filter((d) => d.trustLabel === label);
  const list = (ds) => ds.map((d) => d.name).join(", ");
  conversation.messages.push({
    role: "user", kind: "gaps", task: "gaps", time: new Date().toISOString(),
    text: `${list(byLabel("Authoritative"))} vs. ${list(byLabel("Observed"))}`,
    prompt: "Where does practice deviate from policy? Check each requirement against what was observed.",
    // Search the policies with the words of what was observed.
    query: byLabel("Observed").map((d) => (docs[d.id]?.text ?? "").slice(0, 1500)).join(" "),
  });
  await storage.saveConversation(conversation);
  await askModel();
});

// The checks under a gap answer, worked out fresh each time it's shown (so relabelling a
// source or adding a house rule updates earlier answers):
//   • claims citing only one side get an "Unsupported" badge
//   • claims that match a house rule get its classification
//   • a line counting the Observed and Authoritative evidence
//   • "Make a rule" on each claim, to record how you'd classify it
function showGapChecks(block, body, item) {
  const citations = existingCitations(item.citations) ?? {};
  const trustOf = (id) => docById(id)?.trustLabel;
  const passageText = (n) => (citations[n] ? passageOf(`${citations[n].docId}#${citations[n].index}`)?.text ?? "" : "");
  const unsupported = unsupportedGapClaims(item.text, citations, trustOf);
  const rules = matchHouseRules(item.text, formatRulePack(conversation.domain, domainRules).applied, passageText);
  const evidence = citationEvidence(item.text, citations, trustOf);

  // Find the paragraph or list item on screen that shows a claim.
  const plain = (s) => stripCitations(s).replace(/[*_`#>]/g, "").replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").replace(/\s+/g, " ").trim().toLowerCase();
  const shown = (element) => {
    const copy = element.cloneNode(true);
    copy.querySelectorAll(".cite, .claim-badges").forEach((c) => c.remove());
    return plain(copy.textContent);
  };
  const blocks = [...body.querySelectorAll("li, p")].filter((b) => !b.querySelector("li, p"));
  const blockFor = (claim) => {
    const key = plain(claim).slice(0, 40);
    return blocks.find((b) => shown(b).startsWith(key)) ?? blocks.find((b) => shown(b).includes(key.slice(0, 25)));
  };
  const badgesOf = (b) => {
    let row = b.querySelector(":scope > .claim-badges");
    if (!row) {
      row = document.createElement("span");
      row.className = "claim-badges";
      b.append(row);
    }
    return row;
  };

  const missingByClaim = new Map();
  for (const u of unsupported) missingByClaim.set(u.claim, [...(missingByClaim.get(u.claim) ?? []), u.missing]);
  for (const [claim, missing] of missingByClaim) {
    const b = blockFor(claim);
    if (!b) continue;
    b.classList.add("is-unsupported");
    const badge = textSpan(`Unsupported: no ${missing.join(" or ")} evidence cited`, "claim-badge badge-warn");
    badge.title = "A gap needs both what happened (Observed) and the rule it breaks (Authoritative).";
    badgesOf(b).append(badge);
  }
  for (const r of rules) {
    const b = blockFor(r.claim);
    if (!b) continue;
    const badge = textSpan(r.action, "claim-badge badge-rule");
    badge.title = `House rule (${conversation.domain}): when the evidence mentions "${r.pattern}"`;
    badgesOf(b).append(badge);
  }
  // "Make a rule" on each finding (a claim citing both a requirement and a log entry);
  // it starts from the log entry, since rules are matched against what happened.
  for (const b of blocks) {
    const keys = [...b.querySelectorAll(".cite[data-key]")].map((c) => c.dataset.key);
    const labelOf = (k) => docById(docIdOf(k))?.trustLabel;
    const observed = keys.find((k) => labelOf(k) === "Observed");
    if (!observed || !keys.some((k) => labelOf(k) === "Authoritative")) continue;
    const add = document.createElement("button");
    add.type = "button";
    add.className = "claim-action";
    add.textContent = "Make a rule";
    add.title = "Record how situations like this should be classified";
    const evidenceText = (passageOf(observed)?.text ?? "").replace(/^\s*\d{1,2}:\d{2}\s*[-–—]\s*/, "");
    add.onclick = () => openRulesDialog({ pattern: evidenceText.split(/\s+/).slice(0, 12).join(" "), fromClaim: true });
    badgesOf(b).append(add);
  }

  const claimsWithIssues = missingByClaim.size;
  block.append(textSpan(
    `Evidence cited: ${plural(evidence.Observed, "Observed passage")} · ${plural(evidence.Authoritative, "Authoritative passage")}` +
      (claimsWithIssues ? ` · ${plural(claimsWithIssues, "unsupported claim")}` : "") +
      (rules.length ? ` · ${plural(rules.length, "house rule")} applied` : ""),
    "gap-evidence"
  ));
}

// The "Authoritative / Observed / Experiential" picker on a source card.
function makeTrustPicker(doc) {
  const row = document.createElement("label");
  row.className = "trust-row";
  row.append("Source type");
  const select = document.createElement("select");
  select.className = "trust-select";
  select.dataset.label = doc.trustLabel ?? "";
  select.add(new Option("Unlabelled", ""));
  for (const [name, meaning] of Object.entries(TRUST_LABELS)) {
    const option = new Option(name, name);
    option.title = meaning;
    select.add(option);
  }
  select.value = doc.trustLabel ?? "";
  select.title = doc.trustLabel ? TRUST_LABELS[doc.trustLabel] : "Choose what kind of source this is";
  select.onchange = async () => {
    doc.trustLabel = select.value || null; // saved with the thread
    await saveQuietly();
    render({ keepScroll: true }); // gap checks and the Find gaps button depend on labels
  };
  row.append(select);
  return row;
}

// The domain picker in the message box.
function renderDomainOptions() {
  el.domainSelect.innerHTML = "";
  el.domainSelect.add(new Option("No domain", ""));
  for (const name of Object.keys(domainRules)) el.domainSelect.add(new Option(name, name));
  el.domainSelect.add(new Option("Edit house rules…", "__rules"));
}
el.domainSelect.addEventListener("change", async () => {
  if (el.domainSelect.value === "__rules") {
    el.domainSelect.value = conversation.domain ?? "";
    return openRulesDialog();
  }
  conversation.domain = el.domainSelect.value || null;
  await saveQuietly();
  render({ keepScroll: true }); // house-rule badges depend on the domain
});

// ----- The House rules window -----
let rulesDomain = null;
let rulesFromClaim = false;

function openRulesDialog({ pattern = "", fromClaim = false } = {}) {
  rulesDomain = domainRules[conversation.domain] ? conversation.domain : Object.keys(domainRules)[0] ?? null;
  rulesFromClaim = fromClaim;
  renderRulesDialog();
  $("rules-pattern").value = pattern;
  $("rules-action").value = "";
  el.rulesDialog.showModal();
  (pattern ? $("rules-action") : $("rules-pattern")).focus();
}

function renderRulesDialog() {
  const select = $("rules-domain");
  select.innerHTML = "";
  for (const name of Object.keys(domainRules)) select.add(new Option(name, name));
  select.value = rulesDomain ?? "";
  const pack = domainRules[rulesDomain] ?? { acronyms: {}, user_overrides: [] };

  const terms = $("rules-terms");
  terms.innerHTML = "";
  for (const [short, long] of Object.entries(pack.acronyms ?? {})) {
    terms.append(rulesRow(`${short} = ${long}`, async () => {
      delete pack.acronyms[short];
      await saveRules();
    }));
  }
  if (!terms.children.length) terms.append(textSpan("No terms yet.", "sources-empty"));

  const list = $("rules-list");
  list.innerHTML = "";
  (pack.user_overrides ?? []).forEach((rule, i) => {
    list.append(rulesRow(`When the evidence mentions “${rule.pattern}” → ${rule.action}`, async () => {
      pack.user_overrides.splice(i, 1);
      await saveRules();
    }));
  });
  if (!list.children.length) list.append(textSpan("No rules yet.", "sources-empty"));
}

function rulesRow(text, onRemove) {
  const row = document.createElement("div");
  row.className = "rules-item";
  const remove = actionButton(icons.x(13), "Remove", onRemove);
  remove.className = "chip-remove";
  row.append(textSpan(text, ""), remove);
  return row;
}

async function saveRules() {
  await storage.saveDomainRules(domainRules);
  renderRulesDialog();
  renderDomainOptions();
  render({ keepScroll: true }); // re-check gap answers against the new rules
}

$("rules-domain").addEventListener("change", () => {
  rulesDomain = $("rules-domain").value;
  renderRulesDialog();
});
$("rules-add-domain").addEventListener("click", async () => {
  const name = $("rules-new-domain").value.trim().slice(0, 40);
  if (!name || name.startsWith("__")) return;
  domainRules[name] ??= { acronyms: {}, user_overrides: [] };
  rulesDomain = name;
  $("rules-new-domain").value = "";
  await saveRules();
});
$("rules-add-term").addEventListener("click", async () => {
  const short = $("rules-term-short").value.trim();
  const long = $("rules-term-long").value.trim();
  if (!rulesDomain || !short || !long) return;
  (domainRules[rulesDomain].acronyms ??= {})[short] = long;
  $("rules-term-short").value = $("rules-term-long").value = "";
  await saveRules();
});
$("rules-add-rule").addEventListener("click", async () => {
  const pattern = $("rules-pattern").value.trim();
  const action = $("rules-action").value.trim();
  if (!rulesDomain || !pattern || !action) return;
  (domainRules[rulesDomain].user_overrides ??= []).push({ pattern, action, weight: 1.0 });
  // A rule made from a finding should apply to this thread.
  if (rulesFromClaim && !conversation.domain) {
    conversation.domain = rulesDomain;
    await saveQuietly();
  }
  $("rules-pattern").value = $("rules-action").value = "";
  await saveRules();
  showToast("House rule added");
});
$("rules-close").addEventListener("click", () => el.rulesDialog.close());

// ---------- Selecting several threads or sources ----------
function toggleIn(set, id, redraw) {
  set.has(id) ? set.delete(id) : set.add(id);
  redraw();
}

function checkMark(on) {
  const span = document.createElement("span");
  span.className = "check" + (on ? " is-on" : "");
  if (on) span.innerHTML = icons.check(12);
  return span;
}

el.selectThreads.addEventListener("click", () => {
  selectingThreads = true;
  selectedThreads.clear();
  renderSidebar();
});
$("thread-select-cancel").addEventListener("click", () => {
  selectingThreads = false;
  selectedThreads.clear();
  renderSidebar();
});
$("thread-select-all").addEventListener("click", async () => {
  for (const conv of await storage.listConversations()) selectedThreads.add(conv.id);
  renderSidebar();
});
$("thread-select-delete").addEventListener("click", async () => {
  if (selectedThreads.size === 0 || isWaiting) return;
  const all = await storage.listConversations();
  const chosen = all.filter((c) => selectedThreads.has(c.id));
  const names = chosen.slice(0, 5).map((c) => `• ${c.title}`).join("\n") + (chosen.length > 5 ? `\n…and ${chosen.length - 5} more` : "");
  const confirmed = await window.__TAURI__.dialog.ask(
    `Are you sure you want to delete ${plural(chosen.length, "thread")}?\n\n${names}\n\nThis also deletes any files attached in them, and can't be undone.`,
    { title: "Delete threads", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" }
  );
  if (!confirmed) return;
  for (const conv of chosen) {
    try {
      await storage.deleteConversation(conv);
    } catch (err) {
      showError(`Couldn't delete "${conv.title}": ${err.message}`);
    }
  }
  selectingThreads = false;
  selectedThreads.clear();
  if (chosen.some((c) => c.id === conversation.id)) {
    const saved = await storage.listConversations();
    await showConversation(saved[0] ?? makeNewThread());
  } else {
    renderSidebar();
  }
});

el.selectSources.addEventListener("click", () => {
  selectingSources = true;
  selectedSources.clear();
  renderSources();
  refreshLines();
});
$("source-select-cancel").addEventListener("click", () => {
  selectingSources = false;
  selectedSources.clear();
  renderSources();
  refreshLines();
});
$("source-select-all").addEventListener("click", () => {
  for (const doc of documentsIn(conversation)) selectedSources.add(doc.id);
  renderSources();
});
$("source-select-delete").addEventListener("click", () => {
  if (selectedSources.size > 0) removeSources([...selectedSources]);
});

// Delete sources from this thread: the files, their links, and message-box references.
// Answers that cited them keep their words, but those citations stop being clickable.
async function removeSources(ids) {
  if (isWaiting) return;
  const docsToGo = documentsIn(conversation).filter((d) => ids.includes(d.id));
  if (docsToGo.length === 0) return;
  const names = docsToGo.slice(0, 5).map((d) => `• ${d.name}`).join("\n") + (docsToGo.length > 5 ? `\n…and ${docsToGo.length - 5} more` : "");
  const confirmed = await window.__TAURI__.dialog.ask(
    `Are you sure you want to delete ${plural(docsToGo.length, "source")} from this thread?\n\n${names}\n\n` +
      "Answers that cited them keep their text, but those citations will no longer link. This can't be undone.",
    { title: "Delete sources", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" }
  );
  if (!confirmed) return;

  const gone = new Set(docsToGo.map((d) => d.id));
  conversation.messages.forEach((msg, i) => {
    if (msg.role === "event") {
      msg.attachments = msg.attachments.filter((a) => !gone.has(a.id));
      // An event with no documents left disappears, so links to it go too.
      if (msg.attachments.length === 0) conversation.links = conversation.links.filter((l) => l.a !== `m${i}` && l.b !== `m${i}`);
    }
    if (msg.attachment && gone.has(msg.attachment.id)) {
      conversation.links = conversation.links.filter((l) => l.a !== `m${i}d` && l.b !== `m${i}d`);
      delete msg.attachment;
    }
  });
  conversation.links = conversation.links.filter((l) => ![l.a, l.b].some((id) => gone.has(id.slice(2)) && id.startsWith("s:")));
  conversation.composerRefs = conversation.composerRefs.filter((id) => !gone.has(id));
  await storage.saveConversation(conversation, { keepTimestamp: true });

  for (const id of gone) {
    try {
      await storage.deleteDocument(id);
    } catch {
      // Already gone from disk; nothing else to do.
    }
    delete docs[id];
    selectedSources.delete(id);
  }
  if (gone.has(review.docId)) review = { docId: null, key: null, anchor: null };
  pinned.clear();
  selectingSources = false;
  render({ keepScroll: true });
  showToast(`Deleted ${plural(gone.size, "source")}`);
}

// ---------- Export ----------
// Saves the thread as a Markdown file wherever you choose (the Save dialog gives
// the app permission to write just that one file).
async function exportThread() {
  if (conversation.messages.length === 0) return showToast("Nothing to export yet");
  const safeName = conversation.title.replace(/[\/\\:*?"<>|]/g, "-").slice(0, 80) || "Threadline thread";
  const path = await window.__TAURI__.dialog.save({
    title: "Export thread",
    defaultPath: `${safeName}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!path) return; // cancelled
  const markdown = threadToMarkdown({
    conversation,
    documents: documentsIn(conversation),
    passagesOf: (id) => docs[id]?.passages,
    numberOf: citationIndex().numberOf,
    modelLabel,
  });
  try {
    await window.__TAURI__.fs.writeTextFile(path, markdown);
    showToast(`Exported to ${path.split("/").pop()}`);
  } catch (err) {
    showError(`Couldn't export: ${err.message ?? err}`);
  }
}

// A short message at the bottom of the window that fades away.
let toastTimer = 0;
function showToast(text) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), 3000);
}

// ---------- Drawing everything ----------
function render({ keepScroll = false } = {}) {
  renderSidebar();
  renderHeader();
  renderThread({ keepScroll });
  renderSources();
  renderReview();
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

// "MedRec_Policy_v3.pdf" → "MedRec_Policy_v3" (shortened if very long), for Focus notes.
function shortName(name) {
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  return base.length > 26 ? base.slice(0, 25) + "…" : base;
}

// "09:13" if it was today, otherwise "Sep 25".
function shortWhen(iso) {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? clock(iso)
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

// Remembered view preferences (like the mode, or whether Sources is open). Stored in
// the browser's local storage, which can be unavailable, so failures are ignored.
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
