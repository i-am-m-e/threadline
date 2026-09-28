// signals-ui.js — the Signals mode screen (system signals / operational patterns).
//
// Layout: a toolbar (role, Check now, Digest, alert volume), the Thread list on the left,
// and the selected Thread on the right: the front-line review card, the manager brief,
// the Thread map and the history.
//
// Guardrails in the interface:
//  • Every button records the ROLE that pressed it (never a name).
//  • Buttons are only active in the statuses and roles the spec allows; otherwise they're
//    greyed out with a line saying why. The status rules themselves live in threads.js.
//  • Model text is always shown as plain text (textContent), never as HTML.

import * as storage from "./storage.js";
import { checkForSignals, startMonitorTimer } from "./monitor.js";
import {
  current, ROLES, isOpen, rejectionCounts,
  confirmPattern, addContext, doesNotMatch,
} from "./threads.js";
import { SIGNALS_CONFIG } from "./config.js";

const $ = (id) => document.getElementById(id);
let threads = [];          // all Signals Threads, newest first
let selectedId = null;     // the Thread shown on the right
let role = readSetting("signalsRole", "");
let busy = false;          // a check is running
let form = null;           // an inline form that's open: { threadId, kind }
let rules, schemas, evidenceLibrary, toast;

// ---------- Setup ----------
export async function initSignals({ domainRules, showToast }) {
  rules = domainRules;
  toast = showToast;
  schemas = Object.fromEntries(await Promise.all(
    ["pattern", "analysis", "options", "reviewCard"].map(async (n) => [n, await (await fetch(`schemas/${n}.schema.json`)).json()])
  ));
  try {
    evidenceLibrary = await storage.loadEvidenceLibrary();
  } catch {
    evidenceLibrary = []; // no library found: options will say "No library evidence"
  }
  threads = await storage.listSignalThreads();
  selectedId = threads[0]?.id ?? null;

  const roleSelect = $("signals-role");
  roleSelect.add(new Option("Choose a role…", ""));
  for (const r of ROLES) roleSelect.add(new Option(r, r));
  roleSelect.value = role;
  roleSelect.onchange = () => {
    role = roleSelect.value;
    saveSetting("signalsRole", role);
    form = null;
    renderSignals();
  };
  $("signals-check").onclick = () => checkNow();
  $("signals-show-incoming").onclick = async () => window.__TAURI__.opener.revealItemInDir(await storage.incomingFolderPath());
  $("signals-benchmarks").onclick = async () => {
    const files = [
      ...(await storage.copyPackagedToIncoming("data/benchmarks/healthcare")),
      ...(await storage.copyPackagedToIncoming("data/benchmarks/energy")),
    ];
    toast(`Copied ${files.length} benchmark files to the incoming folder`);
    checkNow();
  };
  $("signals-test-file").onclick = async () => {
    const files = await storage.copyPackagedToIncoming("data/test_incoming");
    toast(`Copied ${files.join(", ")} to the incoming folder`);
  };
  // Optional automatic checks (config.js; 0 = manual "Check now" only).
  startMonitorTimer(SIGNALS_CONFIG.monitorIntervalMinutes, () => checkNow({ quiet: true }));
  updateBadge();
}

// ---------- Check now ----------
async function checkNow({ quiet = false } = {}) {
  if (busy) return;
  busy = true;
  showProgress("Checking the incoming folder…");
  renderSignals();
  try {
    const summary = await checkForSignals({
      io: storage.monitorIO, rules, schemas, config: SIGNALS_CONFIG, evidenceLibrary, onProgress: showProgress,
    });
    threads = await storage.listSignalThreads();
    const changed = [...summary.created, ...summary.updated];
    if (changed.length) selectedId = changed[0];
    const parts = [];
    if (summary.files.length === 0 && summary.errors.length === 0) parts.push("No new files in the incoming folder");
    else parts.push(`${plural(summary.files.length, "file")} read`, `${plural(summary.created.length, "new Thread")}`, `${summary.updated.length} updated`);
    if (!quiet || changed.length) toast(parts.join(" · "));
    if (summary.errors.length) showProgress(`Couldn't finish everything: ${summary.errors.join("; ")}`, true);
    else showProgress(null);
  } catch (err) {
    showProgress(`Check failed: ${err.message}`, true);
  } finally {
    busy = false;
    updateBadge();
    renderSignals();
  }
}

function showProgress(message, isError = false) {
  const box = $("signals-progress");
  box.hidden = !message;
  box.textContent = message ?? "";
  box.classList.toggle("is-error", isError);
}

// ---------- Drawing ----------
export function renderSignals() {
  $("signals-check").disabled = busy;
  $("signals-check").textContent = busy ? "Checking…" : "Check now";
  renderList();
  renderTuning();
  renderDetail();
}

function renderList() {
  const list = $("signals-threads");
  list.innerHTML = "";
  if (threads.length === 0) {
    list.append(text("p", "signals-empty",
      "No Threads yet. Add record files to the incoming folder and press Check now, or run the benchmark packs."));
    return;
  }
  for (const t of threads) {
    const run = current(t);
    const row = document.createElement("button");
    row.type = "button";
    row.className = "signals-row" + (t.id === selectedId ? " is-selected" : "");
    row.append(
      text("span", "signals-row-title", t.pattern_type),
      text("span", "signals-row-meta", `${t.location} · ${t.domain}`),
    );
    const facts = document.createElement("span");
    facts.className = "signals-row-facts";
    facts.append(statusPill(t.status), text("span", "signals-conf", `${run.steps.pattern.confidence} confidence`), text("span", "signals-when", `updated ${shortWhen(t.updated_at)}`));
    row.append(facts);
    row.onclick = () => {
      selectedId = t.id;
      form = null;
      renderSignals();
    };
    list.append(row);
  }
}

// "Not confirmed" reasons per pattern type, for tuning trigger thresholds later.
function renderTuning() {
  const box = $("signals-tuning");
  box.innerHTML = "";
  const counts = rejectionCounts(threads);
  const types = Object.keys(counts);
  if (types.length === 0) return;
  box.append(text("div", "signals-tuning-title", "Not confirmed, by pattern type"));
  for (const type of types) {
    const c = counts[type];
    const row = text("div", "signals-tuning-row", `${type}: ${c["Doesn't match what I see"]} doesn't match · ${c["Not a real pattern"]} not a real pattern`);
    row.title = c.reasons.join("\n");
    box.append(row);
  }
}

function renderDetail() {
  const detail = $("signals-detail");
  detail.innerHTML = "";
  const thread = threads.find((t) => t.id === selectedId);
  if (!thread) {
    detail.append(text("p", "signals-empty", "Select a Thread to see its review card, manager brief and map."));
    return;
  }
  const run = current(thread);
  const head = document.createElement("header");
  head.className = "signals-detail-head";
  head.append(
    text("span", "signals-id", `${thread.id} · ${thread.domain} · ${thread.location}`),
    text("h2", "", thread.pattern_type),
  );
  const facts = document.createElement("div");
  facts.className = "signals-facts";
  facts.append(
    statusPill(thread.status),
    text("span", "", `Pattern confidence: ${run.steps.pattern.confidence}`),
    text("span", "", `Time window${thread.windows.length === 1 ? "" : "s"}: ${run.steps.pattern.time_window}`),
  );
  if (thread.outcome_review_due && thread.status === "Outcome review due") facts.append(text("span", "signals-due", `Outcome review due ${thread.outcome_review_due}`));
  head.append(facts);
  detail.append(head, renderCard(thread));
  detail.append(renderHistory(thread));
}

// ---------- Front-line review card (Prompt 4) ----------
function renderCard(thread) {
  const run = current(thread);
  const card = run.steps.card;
  const box = document.createElement("section");
  box.className = "review-card";
  box.append(text("div", "card-kicker", "Front-line review"), text("h3", "", card.card_title), text("p", "", card.noticed));
  const why = text("p", "", ` ${card.why_it_may_matter}`);
  why.prepend(text("strong", "", "Why it may matter:"));
  box.append(why, text("div", "card-label", "Possible options:"));
  const ul = document.createElement("ul");
  for (const o of card.possible_options) ul.append(text("li", "", o));
  box.append(ul);
  const windows = thread.windows.length === 1 ? "single time window" : `${thread.windows.length} time windows`;
  box.append(text("div", "card-badge", card.evidence_badge), text("div", "card-confidence", `Confidence: ${card.confidence} (${windows})`));
  if (run.meta.placeholder_evidence) box.append(placeholderTag());
  box.append(text("p", "card-question", card.question));

  // Buttons: active only while Under review, for the Front-line lead role.
  const frontLine = role === "Front-line lead";
  const reviewable = thread.status === "Under review";
  const why2 = !reviewable
    ? thread.status === "Inferred" || thread.status === "Flagged"
      ? "Waiting for a manager to send this for front-line validation."
      : `This Thread is "${thread.status}".`
    : !frontLine ? "Switch your role to Front-line lead to respond." : "";
  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(
    button("Confirm pattern", "primary", !(reviewable && frontLine), () => act(thread, () => confirmPattern(thread, role), "Pattern confirmed")),
    button("Add context", "", !(isOpen(thread) && role), () => openForm(thread, "context")),
    button("Doesn't match what I see", "", !(reviewable && frontLine), () => openForm(thread, "mismatch")),
  );
  box.append(actions);
  if (why2) box.append(text("p", "card-why-disabled", why2));

  if (form?.threadId === thread.id && form.kind === "context") {
    box.append(inlineForm({
      label: "What context should reviewers know? (It will be saved as Experiential, with your role.)",
      multiline: true, submit: "Save context",
      onSubmit: (value) => act(thread, () => addContext(thread, role, value), "Context added"),
    }));
  }
  if (form?.threadId === thread.id && form.kind === "mismatch") {
    box.append(inlineForm({
      label: "In one line: what doesn't match what you see on shift?", submit: "Submit",
      onSubmit: (value) => act(thread, () => doesNotMatch(thread, role, value), "Marked as not confirmed"),
    }));
  }

  if (thread.context_notes.length) {
    const notes = document.createElement("div");
    notes.className = "context-notes";
    notes.append(text("div", "card-label", "Context from front-line roles"));
    for (const n of thread.context_notes) {
      const note = text("div", "context-note", n.text);
      note.append(text("span", "context-meta", `${n.role} · ${shortWhen(n.time)} · Experiential`));
      notes.append(note);
    }
    box.append(notes);
  }
  return box;
}

// ---------- History ----------
function renderHistory(thread) {
  const box = document.createElement("details");
  box.className = "signals-history";
  box.append(text("summary", "", `History (${thread.history.length})`));
  for (const h of [...thread.history].reverse()) {
    const row = text("div", "history-row", h.note);
    row.prepend(text("span", "history-when", `${shortWhen(h.time)} · ${h.by} · ${h.status}`));
    box.append(row);
  }
  const log = current(thread).log;
  if (log.length) {
    box.append(text("div", "card-label", `Code checks on the latest run (${log.length})`));
    for (const l of log) box.append(text("div", "history-row history-log", `${l.step}: ${l.detail}`));
  }
  return box;
}

// ---------- Acting on a Thread ----------
function openForm(thread, kind) {
  form = form?.threadId === thread.id && form.kind === kind ? null : { threadId: thread.id, kind };
  renderSignals();
}

// Run a human action (from threads.js), save, and redraw. Refusals show as a message.
async function act(thread, action, done) {
  try {
    action();
  } catch (err) {
    toast(err.message);
    return;
  }
  form = null;
  await storage.saveSignalThread(thread);
  threads = await storage.listSignalThreads();
  toast(done);
  updateBadge();
  renderSignals();
}

// A text box that appears in place (no pop-up windows), with Submit and Cancel.
function inlineForm({ label, multiline = false, submit, onSubmit }) {
  const box = document.createElement("div");
  box.className = "inline-form";
  box.append(text("label", "", label));
  const input = document.createElement(multiline ? "textarea" : "input");
  input.className = "rules-input";
  input.maxLength = 1000;
  const send = button(submit, "primary", true, () => onSubmit(input.value));
  input.oninput = () => (send.disabled = !input.value.trim());
  const cancel = button("Cancel", "", false, () => {
    form = null;
    renderSignals();
  });
  const row = document.createElement("div");
  row.className = "card-actions";
  row.append(send, cancel);
  box.append(input, row);
  setTimeout(() => input.focus());
  return box;
}

// ---------- Badge on the Signals mode button ----------
// app.js calls this each time it redraws the mode switch.
export function updateBadge() {
  const waiting = threads.filter((t) => t.status === "Flagged").length;
  for (const badge of document.querySelectorAll('.mode-option[data-mode="signals"] .mode-badge')) {
    badge.hidden = waiting === 0;
    badge.textContent = String(waiting);
    badge.title = `${plural(waiting, "flagged Thread")} waiting for review`;
  }
}

// ---------- Small helpers ----------
function text(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = content;
  return node;
}

function button(label, kind, disabled, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `signals-button${kind ? ` is-${kind}` : ""}`;
  b.textContent = label;
  b.disabled = disabled;
  b.onclick = onClick;
  return b;
}

function statusPill(status) {
  return text("span", `status-pill status-${status.toLowerCase().replace(/[^a-z]+/g, "-")}`, status);
}

function placeholderTag() {
  const tag = text("span", "placeholder-tag", "Placeholder evidence");
  tag.title = "This recommendation relies on placeholder evidence items that the founder will replace with curated summaries.";
  return tag;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function shortWhen(iso) {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function readSetting(name, fallback) {
  try {
    return localStorage.getItem(name) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveSetting(name, value) {
  try {
    localStorage.setItem(name, value);
  } catch {
    // Not important enough to bother you about.
  }
}

