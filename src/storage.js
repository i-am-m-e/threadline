// storage.js — saves and loads conversations and documents on this Mac.
//
// Everything lives in the app's own data folder:
//   ~/Library/Application Support/com.threadline.desktop/
//     conversations/<id>.json        one file per chat
//     documents/<id>/<original file> the file you attached, untouched
//     documents/<id>/text.txt        the text we extracted from it
//
// Tauri gives us file access through window.__TAURI__.fs (a plain browser
// can't write to your disk, which is why this only works inside the app window).

import { CURRENT_SPLIT_VERSION } from "./passages.js";
import { parseRecordFile } from "./records.js";

const fs = window.__TAURI__.fs;
const inAppData = { baseDir: fs.BaseDirectory.AppData };
// The repo's data/ folder is packaged with the app as a read-only "resource".
const inResources = { baseDir: fs.BaseDirectory.Resource };

/** Make a unique id like "2026-09-25T19-30-12-a1b2" (sorts by time, safe as a filename). */
export function newId() {
  const time = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const random = Math.random().toString(36).slice(2, 6);
  return `${time}-${random}`;
}

/** Create our folders the first time the app runs. Call once at startup. */
export async function initStorage() {
  await fs.mkdir("conversations", { ...inAppData, recursive: true });
  await fs.mkdir("documents", { ...inAppData, recursive: true });
  // Signals: Threads, plus the watched folder and where processed files go.
  await fs.mkdir("signals/threads", { ...inAppData, recursive: true });
  await fs.mkdir("data/incoming", { ...inAppData, recursive: true });
  await fs.mkdir("data/processed", { ...inAppData, recursive: true });
}

// ---------- Conversations ----------
// A conversation looks like:
// {
//   id, title, createdAt, updatedAt,
//   model,                          ← which AI model answers (an id from MODELS in model.js)
//   messages: [
//     { role: "event", time, attachments: [ { id, name, type, pages, pageUnit, addedAt } ] }  ← "documents added"
//     { role: "user", text, time, refs: [docId] }   ← refs: sources dropped on the message box
//     { role: "assistant", text, time, model, citations: { "3": { docId, index } } }  ← see passages.js
//   ],
//   links: [ { a, b } ],   ← lines you drew by dragging ("m3" = message 3, "s:<docId>" = a source)
//   composerRefs: [docId],  ← sources dropped on the message box, not sent yet
// }
// (Chats from before the redesign kept one file per user message as `attachment`.)

/** Every document attached anywhere in a conversation, oldest first. */
export function documentsIn(conversation) {
  return conversation.messages.flatMap((msg) => msg.attachments ?? (msg.attachment ? [msg.attachment] : []));
}

// Pass { keepTimestamp: true } for small edits like renaming, so the chat
// doesn't jump to the top of the list as if it had new messages.
export async function saveConversation(conversation, { keepTimestamp = false } = {}) {
  if (!keepTimestamp) conversation.updatedAt = new Date().toISOString();
  const json = JSON.stringify(conversation, null, 2); // indented so it's readable
  await fs.writeTextFile(`conversations/${conversation.id}.json`, json, inAppData);
}

export async function loadConversation(id) {
  const json = await fs.readTextFile(`conversations/${id}.json`, inAppData);
  return JSON.parse(json);
}

/** Permanently delete a conversation and every document attached in it. */
export async function deleteConversation(conversation) {
  for (const doc of documentsIn(conversation)) {
    await fs.remove(`documents/${doc.id}`, { ...inAppData, recursive: true });
  }
  await fs.remove(`conversations/${conversation.id}.json`, inAppData);
}

/** Returns every saved conversation, newest first. */
export async function listConversations() {
  const entries = await fs.readDir("conversations", inAppData);
  const conversations = [];
  for (const entry of entries) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      conversations.push(await loadConversation(entry.name.replace(/\.json$/, "")));
    }
  }
  return conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ---------- Documents ----------

/**
 * Save an attached file and its extracted text.
 * @param {File} file
 * @param {{text: string, type: string, pages: number | null, pageUnit?: string}} extracted  What extractText() returned.
 * @returns {Promise<{id, name, type, pages, pageUnit?, addedAt}>}  A small reference to store in a message.
 */
export async function saveDocument(file, { text, type, pages, pageUnit }) {
  const id = newId();
  const folder = `documents/${id}`;
  const safeName = file.name.replace(/[\/\\:]/g, "_");

  await fs.mkdir(folder, { ...inAppData, recursive: true });
  await fs.writeFile(`${folder}/${safeName}`, new Uint8Array(await file.arrayBuffer()), inAppData);
  await fs.writeTextFile(`${folder}/text.txt`, text, inAppData);

  const ref = { id, name: file.name, type, pages, addedAt: new Date().toISOString() };
  if (pageUnit) ref.pageUnit = pageUnit; // "page" (PDF) or "sheet" (Excel)
  ref.splitVersion = CURRENT_SPLIT_VERSION; // which passage-cutting rules this document uses
  return ref;
}

// ---------- House rules (domain_rules.json) ----------
// Terms and rules per domain (Healthcare, Energy, …), shared by all threads.
// Shape: { "Healthcare": { acronyms: { CTAS: "…" }, user_overrides: [ { pattern, action, weight } ] } }
// See formatRulePack and matchHouseRules in passages.js for how they're used.

const STARTER_RULES = {
  Healthcare: {
    acronyms: { CTAS: "Canadian Triage and Acuity Scale", CAM: "Confusion Assessment Method" },
    user_overrides: [
      {
        pattern: "Resuscitation in progress overrides standard waiting room walk-through",
        action: "Classify as Systemic Capacity Conflict rather than Staff Non-Compliance",
        weight: 1.0,
      },
    ],
  },
  Energy: {
    acronyms: { LOTO: "Lock-Out / Tag-Out", SAGD: "Steam-Assisted Gravity Drainage" },
    user_overrides: [
      { pattern: "Radio handovers during severe weather", action: "Flag as Weather-Induced SOP Bypass", weight: 1.0 },
    ],
  },
};

/** Load the house rules, creating the file with starter examples the first time. */
export async function loadDomainRules() {
  let rules;
  try {
    rules = JSON.parse(await fs.readTextFile("domain_rules.json", inAppData));
  } catch {
    rules = structuredClone(STARTER_RULES);
  }
  // Bring in anything new from the packaged data/domain_rules.json (triggers, safety
  // conditions, pattern types, control actions, terms). Fields you've already got,
  // like your house rules, are left exactly as they are.
  let seed = {};
  try {
    seed = JSON.parse(await fs.readTextFile("data/domain_rules.json", inResources));
  } catch {
    // Packaged rules not found (shouldn't happen in the built app); keep what we have.
  }
  for (const [domain, pack] of Object.entries(seed)) {
    rules[domain] ??= {};
    for (const [field, value] of Object.entries(pack)) {
      if (field === "acronyms") rules[domain].acronyms = { ...value, ...(rules[domain].acronyms ?? {}) };
      else if (!(field in rules[domain])) rules[domain][field] = value;
    }
  }
  await saveDomainRules(rules);
  return rules;
}

export async function saveDomainRules(rules) {
  await fs.writeTextFile("domain_rules.json", JSON.stringify(rules, null, 2), inAppData);
}

// ---------- Signals: Threads, incoming records, packaged data ----------

/** Every Signals Thread, newest first. */
export async function listSignalThreads() {
  const threads = [];
  for (const entry of await fs.readDir("signals/threads", inAppData)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      threads.push(JSON.parse(await fs.readTextFile(`signals/threads/${entry.name}`, inAppData)));
    }
  }
  return threads.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function saveSignalThread(thread) {
  await fs.writeTextFile(`signals/threads/${thread.id}.json`, JSON.stringify(thread, null, 2), inAppData);
}

// Small Signals settings and counters (e.g. which flags were raised when).
export async function loadSignalsState() {
  try {
    return JSON.parse(await fs.readTextFile("signals/state.json", inAppData));
  } catch {
    return {};
  }
}
export async function saveSignalsState(state) {
  await fs.writeTextFile("signals/state.json", JSON.stringify(state, null, 2), inAppData);
}

/**
 * Folder access for the monitor (see monitor.js). New record files are dropped into
 * data/incoming/; once read, they're moved to data/processed/ so each is handled once.
 */
export const monitorIO = {
  async listIncoming() {
    const entries = await fs.readDir("data/incoming", inAppData);
    return entries.filter((e) => e.isFile && /\.(csv|json)$/i.test(e.name)).map((e) => e.name).sort();
  },
  readIncoming: (name) => fs.readTextFile(`data/incoming/${name}`, inAppData),
  async archiveIncoming(name) {
    await fs.rename(`data/incoming/${name}`, `data/processed/${name}`, { oldPathBaseDir: fs.BaseDirectory.AppData, newPathBaseDir: fs.BaseDirectory.AppData });
  },
  async loadProcessedRecords() {
    const records = [];
    for (const entry of await fs.readDir("data/processed", inAppData)) {
      if (!entry.isFile || !/\.(csv|json)$/i.test(entry.name)) continue;
      try {
        records.push(...parseRecordFile(entry.name, await fs.readTextFile(`data/processed/${entry.name}`, inAppData)));
      } catch {
        // A file that can't be read is skipped (it was reported when it first arrived).
      }
    }
    return records;
  },
  loadThreads: () => listSignalThreads(),
  saveThread: (thread) => saveSignalThread(thread),
};

/** The full path of the incoming folder (to show it in Finder). */
export async function incomingFolderPath() {
  const { appDataDir, join } = window.__TAURI__.path;
  return join(await appDataDir(), "data", "incoming");
}

/** A JSON or text file from the packaged data/ folder, e.g. "data/evidence/EV-HC-001.json". */
export const readPackaged = (path) => fs.readTextFile(path, inResources);

/** Every evidence item in the packaged evidence library (data/evidence/). */
export async function loadEvidenceLibrary() {
  const items = [];
  for (const entry of await fs.readDir("data/evidence", inResources)) {
    if (entry.isFile && entry.name.endsWith(".json")) items.push(JSON.parse(await readPackaged(`data/evidence/${entry.name}`)));
  }
  return items;
}

/** Copy a packaged folder's record files (a benchmark pack or the test file) into incoming. */
export async function copyPackagedToIncoming(folder) {
  const copied = [];
  for (const entry of await fs.readDir(folder, inResources)) {
    if (!entry.isFile || !/\.(csv|json)$/i.test(entry.name)) continue;
    await fs.writeTextFile(`data/incoming/${entry.name}`, await readPackaged(`${folder}/${entry.name}`), inAppData);
    copied.push(entry.name);
  }
  return copied;
}

/** Permanently delete one document's folder (the original file and its text). */
export async function deleteDocument(id) {
  await fs.remove(`documents/${id}`, { ...inAppData, recursive: true });
}

export async function loadDocumentText(id) {
  return fs.readTextFile(`documents/${id}/text.txt`, inAppData);
}
