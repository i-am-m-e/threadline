// app.js — the interface: shows messages, handles typing, clicks and attachments.
//
// This file never talks to the AI directly. It builds the conversation and
// hands it to getModelResponse() in model.js.

import { getModelResponse } from "./model.js";
import { extractText } from "./extract.js";
import * as storage from "./storage.js";

// Small models can only read so much at once, so long documents get cut off here.
const MAX_DOCUMENT_CHARS = 30000;

// ---------- Grab the page elements we'll work with ----------
const conversationList = document.getElementById("conversation-list");
const newChatButton = document.getElementById("new-chat");
const messagesEl = document.getElementById("messages");
const form = document.getElementById("composer");
const input = document.getElementById("message-input");
const sendButton = document.getElementById("send");
const fileInput = document.getElementById("file-input");
const attachmentChip = document.getElementById("attachment-chip");

// ---------- App state (what's going on right now) ----------
let conversation = null;       // the chat currently on screen
let pendingAttachment = null;  // { file, text } picked but not sent yet
let isWaiting = false;         // true while the AI is thinking
let streamingBubble = null;    // the bubble the AI's reply is being written into
const documentTextCache = {};  // document id -> extracted text, so we don't re-read files

// ---------- Starting up ----------
async function start() {
  await storage.initStorage();
  const saved = await storage.listConversations();
  if (saved.length > 0) {
    conversation = saved[0]; // reopen the most recent chat
  } else {
    conversation = makeNewConversation();
  }
  render();
}

function makeNewConversation() {
  const now = new Date().toISOString();
  return { id: storage.newId(), title: "New chat", createdAt: now, updatedAt: now, messages: [] };
}

// ---------- Sending a message ----------
async function send() {
  const text = input.value.trim();
  if (isWaiting || (!text && !pendingAttachment)) return;

  // 1. Save the attached document (if any) and record the user's message.
  const message = { role: "user", text };
  if (pendingAttachment) {
    message.attachment = await storage.saveDocument(pendingAttachment.file, pendingAttachment.text);
    documentTextCache[message.attachment.id] = pendingAttachment.text;
  }
  conversation.messages.push(message);
  if (conversation.title === "New chat") {
    conversation.title = (text || message.attachment.name).slice(0, 40);
  }

  input.value = "";
  clearAttachment();
  await storage.saveConversation(conversation);

  // 2. Ask the AI. The "thinking" bubble fills in as the reply streams back.
  isWaiting = true;
  render();
  try {
    const reply = await getModelResponse(await buildModelMessages(), showReplySoFar);
    conversation.messages.push({ role: "assistant", text: reply });
    await storage.saveConversation(conversation);
    isWaiting = false;
    render();
  } catch (err) {
    isWaiting = false;
    render();
    addBubble("error", err.message);
  }
}

// Called by getModelResponse each time more of the reply arrives.
// We only show up to the last finished sentence or line, so text appears in
// whole pieces rather than half-words. (Show `textSoFar` as-is for word-by-word.)
function showReplySoFar(textSoFar) {
  const finished = upToLastCompletePiece(textSoFar);
  if (!finished || !streamingBubble) return;
  streamingBubble.classList.remove("thinking");
  streamingBubble.textContent = finished;
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// A piece is complete when it ends in . ! or ? followed by a space, or at a line break
// (which also covers list items). "3.14" doesn't count because no space follows the dot.
function upToLastCompletePiece(text) {
  const endings = [...text.matchAll(/[.!?]["')\]]*\s|\n/g)];
  if (endings.length === 0) return "";
  const last = endings[endings.length - 1];
  return text.slice(0, last.index + last[0].length).trimEnd();
}

// Turn our saved messages into the { role, content } list the model expects.
// A message with an attachment gets the document's text placed in front of it.
async function buildModelMessages() {
  const result = [];
  for (const msg of conversation.messages) {
    let content = msg.text;
    if (msg.attachment) {
      const docText = await getDocumentText(msg.attachment.id);
      content =
        `Here is the document "${msg.attachment.name}":\n` +
        `<document>\n${docText.slice(0, MAX_DOCUMENT_CHARS)}\n</document>\n\n` +
        (msg.text || "Please summarize this document.");
    }
    result.push({ role: msg.role, content });
  }
  return result;
}

async function getDocumentText(id) {
  if (!(id in documentTextCache)) {
    documentTextCache[id] = await storage.loadDocumentText(id);
  }
  return documentTextCache[id];
}

// ---------- Attachments ----------
async function onFilePicked() {
  const file = fileInput.files[0];
  fileInput.value = ""; // lets you pick the same file again later
  if (!file) return;

  try {
    const text = await extractText(file);
    if (!text) {
      addBubble("error", `No text found in "${file.name}". (Scanned PDFs are images, so they have no text to read.)`);
      return;
    }
    pendingAttachment = { file, text };
    let label = `📎 ${file.name}`;
    if (text.length > MAX_DOCUMENT_CHARS) {
      label += ` — long document, only the first ${MAX_DOCUMENT_CHARS.toLocaleString()} characters will be used`;
    }
    showAttachmentChip(label);
  } catch (err) {
    addBubble("error", err.message);
  }
}

function showAttachmentChip(label) {
  attachmentChip.innerHTML = "";
  const span = document.createElement("span");
  span.textContent = label;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "×";
  remove.title = "Remove attachment";
  remove.onclick = clearAttachment;
  attachmentChip.append(span, remove);
  attachmentChip.hidden = false;
}

function clearAttachment() {
  pendingAttachment = null;
  attachmentChip.hidden = true;
  attachmentChip.innerHTML = "";
}

// ---------- Drawing the screen ----------
function render() {
  renderMessages();
  renderConversationList();
  sendButton.disabled = isWaiting;
}

function renderMessages() {
  messagesEl.innerHTML = "";
  if (conversation.messages.length === 0) {
    addBubble("empty", "Ask anything, or attach a .txt or .pdf file with 📎.");
  }
  for (const msg of conversation.messages) {
    addBubble(msg.role, msg.text, msg.attachment);
  }
  streamingBubble = isWaiting ? addBubble("assistant thinking", "Thinking…") : null;
}

// Adds one chat bubble. We use textContent (not innerHTML) so any text,
// including text from the AI, is shown as plain text and never run as code.
function addBubble(kind, text, attachment) {
  const bubble = document.createElement("div");
  bubble.className = `bubble ${kind}`;
  if (attachment) {
    const tag = document.createElement("div");
    tag.className = "attachment-tag";
    tag.textContent = `📎 ${attachment.name}`;
    bubble.append(tag);
  }
  if (text) {
    const body = document.createElement("div");
    body.textContent = text;
    bubble.append(body);
  }
  messagesEl.append(bubble);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return bubble;
}

async function renderConversationList() {
  const saved = await storage.listConversations();
  conversationList.innerHTML = "";
  for (const conv of saved) {
    const row = document.createElement("div");
    row.className = "conversation-row" + (conv.id === conversation.id ? " active" : "");

    const item = document.createElement("button");
    item.className = "conversation-item";
    item.textContent = conv.title;
    item.onclick = () => {
      if (isWaiting) return;
      conversation = conv;
      clearAttachment();
      render();
    };

    row.append(item, makeDeleteButton(conv));
    conversationList.append(row);
  }
}

// The × button shows a native "Are you sure?" pop-up before deleting,
// so one stray click can't lose a chat.
function makeDeleteButton(conv) {
  const button = document.createElement("button");
  button.className = "delete-chat";
  button.textContent = "×";
  button.title = "Delete chat";
  button.onclick = async () => {
    if (isWaiting) return;
    const confirmed = await window.__TAURI__.dialog.ask(
      `Are you sure you want to delete "${conv.title}"?\n\nThis also deletes any files attached in it, and can't be undone.`,
      { title: "Delete chat", kind: "warning", okLabel: "Delete", cancelLabel: "Cancel" }
    );
    if (confirmed) await deleteChat(conv);
  };
  return button;
}

async function deleteChat(conv) {
  try {
    await storage.deleteConversation(conv);
  } catch (err) {
    addBubble("error", `Couldn't delete that chat: ${err.message}`);
    return;
  }
  // If we just deleted the chat on screen, show the next most recent one (or a new chat).
  if (conv.id === conversation.id) {
    const saved = await storage.listConversations();
    conversation = saved[0] ?? makeNewConversation();
    clearAttachment();
  }
  render();
}

// ---------- Wiring up events ----------
form.addEventListener("submit", (event) => {
  event.preventDefault(); // stop the page from reloading
  send();
});

// Enter sends; Shift+Enter makes a new line.
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    send();
  }
});

fileInput.addEventListener("change", onFilePicked);

newChatButton.addEventListener("click", () => {
  if (isWaiting) return;
  conversation = makeNewConversation();
  clearAttachment();
  render();
  input.focus();
});

start().catch((err) => addBubble("error", `Couldn't start: ${err.message}`));
