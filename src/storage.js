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

const fs = window.__TAURI__.fs;
const inAppData = { baseDir: fs.BaseDirectory.AppData };

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
}

// ---------- Conversations ----------
// A conversation looks like:
// {
//   id, title, createdAt, updatedAt,
//   messages: [ { role: "user" | "assistant", text, attachment?: { id, name } } ]
// }

export async function saveConversation(conversation) {
  conversation.updatedAt = new Date().toISOString();
  const json = JSON.stringify(conversation, null, 2); // indented so it's readable
  await fs.writeTextFile(`conversations/${conversation.id}.json`, json, inAppData);
}

export async function loadConversation(id) {
  const json = await fs.readTextFile(`conversations/${id}.json`, inAppData);
  return JSON.parse(json);
}

/** Permanently delete a conversation and every document attached in it. */
export async function deleteConversation(conversation) {
  for (const msg of conversation.messages) {
    if (msg.attachment) {
      await fs.remove(`documents/${msg.attachment.id}`, { ...inAppData, recursive: true });
    }
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
 * @param {string} text  The text extractText() pulled out of it.
 * @returns {Promise<{id: string, name: string}>}  A small reference to store in a message.
 */
export async function saveDocument(file, text) {
  const id = newId();
  const folder = `documents/${id}`;
  const safeName = file.name.replace(/[\/\\:]/g, "_");

  await fs.mkdir(folder, { ...inAppData, recursive: true });
  await fs.writeFile(`${folder}/${safeName}`, new Uint8Array(await file.arrayBuffer()), inAppData);
  await fs.writeTextFile(`${folder}/text.txt`, text, inAppData);

  return { id, name: file.name };
}

export async function loadDocumentText(id) {
  return fs.readTextFile(`documents/${id}/text.txt`, inAppData);
}
