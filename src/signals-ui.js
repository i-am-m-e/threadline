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
  current, ROLES, isOpen, canMove, rejectionCounts,
  confirmPattern, addContext, doesNotMatch,
  sendForValidation, notARealPattern, requestMoreInformation, recordDecision, closeWithOutcome,
} from "./threads.js";
import { SIGNALS_CONFIG } from "./config.js";
import { routeAlerts, alertVolume, buildDigest, sendLocalNotification } from "./notify.js";
import { renderThreadMap, withApproaches, TRUST_COLORS, SHAPES } from "./threadMap.js";
import { SOURCE_TYPE_NAMES } from "./records.js";

const $ = (id) => document.getElementById(id);
let threads = [];          // all Signals Threads, newest first
let selectedId = null;     // the Thread shown on the right
let role = readSetting("signalsRole", "");
let busy = false;          // a check is running
let form = null;           // an inline form that's open: { threadId, kind }
let showingDigest = false; // the digest panel is open
let alertState = {};       // flags and digest items (signals/state.json)
let mapDirection = readSetting("signalsMapDirection", "TB"); // "TB" top-to-bottom or "LR" left-to-right
let cy = null;             // the map currently drawn (Cytoscape)
let tappedNode = null;     // the map node whose sources are shown in the side panel
let recordCache = null;    // processed records, by source_id (for the side panel)
let rules, schemas, evidenceLibrary, toast, discussInThread;

// ---------- Setup ----------
export async function initSignals({ domainRules, showToast, discuss }) {
  rules = domainRules;
  toast = showToast;
  discussInThread = discuss;
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
  alertState = await storage.loadSignalsState();
  $("signals-digest").onclick = async () => {
    showingDigest = !showingDigest;
    renderSignals();
    if (showingDigest) {
      alertState.lastDigestAt = new Date().toISOString(); // next digest shows what's new after this
      await storage.saveSignalsState(alertState);
    }
  };

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
    recordCache = null; // new records may have arrived
    const changed = [...summary.created, ...summary.updated];
    const changes = [
      ...summary.created.map((id) => ({ thread: threads.find((t) => t.id === id), kind: "new" })),
      ...summary.updated.map((id) => ({ thread: threads.find((t) => t.id === id), kind: "updated" })),
    ].filter((c) => c.thread);
    const toNotify = routeAlerts(changes, alertState, SIGNALS_CONFIG.dailyFlagCap);
    for (const c of changes) await storage.saveSignalThread(c.thread); // records flag/digest on the Thread
    await storage.saveSignalsState(alertState);
    for (const t of toNotify) await sendLocalNotification(t, current(t).steps.pattern.confidence);
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
  const volume = alertVolume(alertState);
  $("signals-volume").textContent = `This week: ${plural(volume.flags, "flag")} · ${plural(volume.digest, "digest item")}`;
  $("signals-volume").title = "Alert volume: flags raised and digest items in the last 7 days";
  $("signals-digest").classList.toggle("is-active", showingDigest);
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
      tappedNode = null;
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
  if (showingDigest) detail.append(renderDigest());
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
  const map = renderMapSection(thread);
  detail.append(head, renderCard(thread), map.section, renderBrief(thread));
  detail.append(renderHistory(thread));
  drawMap(thread, map.canvas, map.panel);
}

// ---------- Digest (the default way Threads are shared) ----------
function renderDigest() {
  const box = document.createElement("section");
  box.className = "digest";
  box.append(text("div", "card-kicker", "Digest"));
  const groups = buildDigest(threads, alertState);
  if (groups.length === 0) {
    box.append(text("p", "brief-small", "Nothing new since the last digest."));
    return box;
  }
  for (const { domain, items } of groups) {
    box.append(text("h4", "", domain));
    for (const { thread, kinds, over_cap } of items) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "digest-row";
      row.append(
        text("span", "", `${thread.pattern_type} · ${thread.location}`),
        text("span", "brief-small", ` ${kinds.join(" and ")} · ${current(thread).steps.pattern.confidence} confidence · ${thread.status}${over_cap ? " · over today's flag limit" : ""}`),
      );
      row.onclick = () => {
        selectedId = thread.id;
        showingDigest = false;
        renderSignals();
      };
      box.append(row);
    }
  }
  return box;
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

// ---------- Thread map ----------
function renderMapSection(thread) {
  const section = document.createElement("section");
  section.className = "map-section";
  const head = document.createElement("div");
  head.className = "map-head";
  head.append(text("div", "card-kicker", "Thread map"));
  const toggle = document.createElement("div");
  toggle.className = "mode-switch map-toggle";
  for (const [dir, label] of [["TB", "Top to bottom"], ["LR", "Left to right"]]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mode-option";
    b.textContent = label;
    b.setAttribute("aria-selected", String(mapDirection === dir));
    b.onclick = () => {
      mapDirection = dir;
      saveSetting("signalsMapDirection", dir);
      renderSignals();
    };
    toggle.append(b);
  }
  head.append(toggle);

  const body = document.createElement("div");
  body.className = "map-body";
  const canvas = document.createElement("div");
  canvas.className = "map-canvas";
  const panel = document.createElement("aside");
  panel.className = "map-panel";
  body.append(canvas, panel);
  section.append(head, body, legend());
  return { section, canvas, panel };
}

// A small legend: colour = trust label, shape = node type, dashed = unconfirmed.
function legend() {
  const box = document.createElement("div");
  box.className = "map-legend";
  for (const [label, colour] of Object.entries(TRUST_COLORS)) {
    const item = text("span", "legend-item", label);
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch" + (label === "Inferred" || label === "Suggested" ? " is-dashed" : "");
    swatch.style.background = colour;
    item.prepend(swatch);
    box.append(item);
  }
  const shapes = { evidence: "▢ evidence", policy: "■ policy", condition: "◆ condition", role: "● role", effect: "⬢ effect", approach: "⬟ approach (option)" };
  box.append(text("span", "legend-shapes", Object.keys(SHAPES).map((k) => shapes[k]).join("  ·  ")));
  box.append(text("span", "legend-shapes", "Dashed = unconfirmed · thicker line = more supporting records"));
  return box;
}

async function drawMap(thread, canvas, panel) {
  cy?.destroy();
  cy = null;
  const run = current(thread);
  const graph = withApproaches(run.steps.analysis.graph, run.steps.options.options);
  try {
    cy = await renderThreadMap(canvas, graph, async (node) => {
      tappedNode = node.id;
      await fillPanel(panel, node, thread);
    }, mapDirection);
  } catch (err) {
    canvas.append(text("p", "signals-empty", `The map couldn't be drawn: ${err.message}`));
  }
  const again = tappedNode && graph.nodes.find((n) => n.id === tappedNode);
  if (again) fillPanel(panel, again, thread);
  else panel.append(text("p", "signals-empty", "Tap a node to see the records or evidence behind it."));
}

// Side panel: the source records (or, for an option, its evidence items) behind a node.
async function fillPanel(panel, node, thread) {
  panel.innerHTML = "";
  const head = text("div", "map-panel-title", node.label);
  head.append(trustChip(node.trust_label));
  panel.append(head, text("div", "brief-small", node.node_type === "approach" ? "Option (Suggested)" : `Node type: ${node.node_type}`));

  if (node.node_type === "approach") {
    const option = current(thread).steps.options.options.find((o) => o.option_id === node.option_id);
    if (option) panel.append(text("p", "", option.description));
    const evidence = current(thread).steps.evidence;
    const items = (node.evidence_ids ?? []).map((id) => evidence.find((e) => e.evidence_id === id)).filter(Boolean);
    if (items.length === 0) panel.append(text("p", "brief-small", "No library evidence."));
    for (const e of items) {
      const row = text("div", "map-record", `${e.evidence_id} · ${e.title}`);
      row.append(text("span", "brief-small", ` ${e.source_type}, strength ${e.strength}. ${e.citation}`));
      if (e.synthetic_placeholder) row.append(placeholderTag());
      panel.append(row);
    }
    return;
  }

  if (!node.source_ids?.length) {
    panel.append(text("p", "brief-small", "No source record: this is proposed by Threadline and unconfirmed."));
    return;
  }
  recordCache ??= new Map((await storage.monitorIO.loadProcessedRecords()).map((r) => [r.source_id, r]));
  for (const id of node.source_ids) {
    const r = recordCache.get(id);
    const row = text("div", "map-record", r ? `${id} · ${SOURCE_TYPE_NAMES[r.source_type] ?? r.source_type} · ${String(r.timestamp).replace("T", " ")}` : id);
    if (!r) row.append(text("span", "brief-small", " (record not found in the processed folder)"));
    else if (r.text) row.append(text("p", "", r.text));
    else row.append(text("p", "brief-small", Object.entries(r).filter(([k]) => !["source_id", "source_type", "domain", "location", "timestamp", "file", "synthetic"].includes(k)).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ")));
    panel.append(row);
  }
}

// ---------- Manager brief (assembled in code from the pipeline's outputs: no extra AI call) ----------
function renderBrief(thread) {
  const { pattern, analysis, evidence, options } = current(thread).steps;
  const box = document.createElement("section");
  box.className = "brief";
  box.append(text("div", "card-kicker", "Manager brief"));

  // What Threadline noticed
  box.append(text("h4", "", "What Threadline noticed"), text("p", "", pattern.pattern_statement));
  const vignette = document.createElement("dl");
  vignette.className = "brief-vignette";
  for (const [label, value] of [
    ["Situation", pattern.possible_vignette.situation],
    ["What appears to happen", pattern.possible_vignette.what_appears_to_happen],
    ["Observed effects", pattern.possible_vignette.observed_effects],
  ]) vignette.append(text("dt", "", label), text("dd", "", value));
  box.append(vignette);
  if (pattern.evidence_that_does_not_fit.filter(Boolean).length) {
    box.append(text("div", "card-label", "Evidence that does not fit"), list(pattern.evidence_that_does_not_fit.filter(Boolean)));
  }

  // Possible contributing factors
  box.append(text("h4", "", "Possible contributing factors"));
  const factors = document.createElement("ul");
  for (const c of analysis.contributing_conditions) {
    const li = text("li", "", `${c.condition} `);
    li.append(trustChip(c.trust_label), sourceIds(c.source_ids));
    factors.append(li);
  }
  box.append(factors);
  if (analysis.compounding_factors.length) box.append(text("div", "card-label", "Where small variations combine"), list(analysis.compounding_factors));
  const gap = analysis.policy_practice_gap;
  const gapBox = document.createElement("div");
  gapBox.className = "brief-gap";
  gapBox.append(
    labelled("Policy expects", gap.what_policy_expects, "Authoritative"),
    labelled("Records suggest", gap.what_records_suggest, "Observed"),
  );
  box.append(text("div", "card-label", "Policy and practice"), gapBox);
  if (analysis.pressure_map.length) {
    box.append(text("div", "card-label", "Pressure map"));
    const pm = document.createElement("ul");
    for (const p of analysis.pressure_map) {
      const li = text("li", "", `${p.role}: ${p.pressure_carried}${p.shifting_to ? ` (appears to shift to ${p.shifting_to})` : ""} `);
      li.append(trustChip(p.trust_label));
      pm.append(li);
    }
    box.append(pm);
  }
  box.append(text("div", "card-label", "Other explanations to rule out"), list(analysis.alternative_explanations));
  box.append(text("div", "card-label", "Questions a reviewer would need answered"), list(analysis.open_questions));

  // Recommendation (Suggested)
  const rec = options.recommendation;
  const leading = options.options.find((o) => o.option_id === rec.leading_option_id);
  const recBox = document.createElement("div");
  recBox.className = "brief-recommendation";
  const recHead = text("h4", "", "Recommendation ");
  recHead.append(trustChip("Suggested"));
  recBox.append(recHead, text("div", "brief-option-title", leading ? leading.title : rec.leading_option_id), text("p", "", rec.rationale));
  recBox.append(text("p", "brief-small", `Evidence strength: ${leading?.evidence_strength ?? "None"} · Recommendation confidence: ${rec.confidence}`));
  recBox.append(labelled("What would change it", rec.would_change_if));
  if (leading) recBox.append(optionDetails(leading, evidence));
  box.append(recBox);

  // Other options
  const others = options.options.filter((o) => o.option_id !== rec.leading_option_id);
  if (others.length) {
    box.append(text("h4", "", "Other options"));
    for (const o of others) {
      const item = document.createElement("div");
      item.className = "brief-option";
      item.append(text("div", "brief-option-title", `${o.title} · ${o.type}`), optionDetails(o, evidence));
      box.append(item);
    }
  }

  // Evidence list
  const cited = [...new Set(options.options.flatMap((o) => o.evidence_ids))].map((id) => evidence.find((e) => e.evidence_id === id)).filter(Boolean);
  box.append(text("h4", "", "Evidence"));
  if (cited.length === 0) {
    box.append(text("p", "brief-small", "No library evidence. Options rely on the records and local judgment."));
  } else {
    for (const e of cited) {
      const row = text("div", "brief-evidence", `${e.evidence_id} · ${e.title} `);
      row.append(text("span", "brief-small", `(${e.source_type}, strength ${e.strength}). ${e.citation}`));
      if (e.synthetic_placeholder) row.append(placeholderTag());
      box.append(row);
    }
  }

  // Confidence and validation, reviewers
  box.append(text("p", "brief-small", `Pattern confidence: ${pattern.confidence} (${pattern.confidence_reason}) · Front-line validation: ${validationStatus(thread)}`));
  if (options.suggested_reviewers.length) {
    box.append(text("div", "card-label", "Suggested reviewers (roles)"), list(options.suggested_reviewers.map((r) => `${r.role}: ${r.why}`)));
  }
  if (thread.information_requests.length) {
    box.append(text("div", "card-label", "Information requested"), list(thread.information_requests.map((r) => `${r.text} (${r.role}, ${shortWhen(r.time)})`)));
  }
  if (thread.decision) {
    box.append(text("div", "brief-decision", `Decision recorded: ${thread.decision.option_title}${thread.decision.was_recommended ? " (the recommendation)" : ""} · ${thread.decision.role} · ${thread.decision.date.slice(0, 10)}. Nothing is applied by Threadline; carrying it out is up to the team.`));
  }
  if (thread.outcome) {
    box.append(text("div", "brief-decision", `Outcome: ${thread.outcome.helped}. ${thread.outcome.what_happened} (${thread.outcome.role}, ${thread.outcome.date.slice(0, 10)})`));
  }

  box.append(managerActions(thread));
  return box;
}

// The manager's buttons, each active only where the spec allows.
function managerActions(thread) {
  const box = document.createElement("div");
  const manager = role === "Manager";
  const validated = thread.status === "Validated pattern";
  const actions = document.createElement("div");
  actions.className = "card-actions";
  const opts = current(thread).steps.options;
  actions.append(
    button("Send for front-line validation", "primary", !(manager && canMove(thread, "Under review")),
      () => act(thread, () => sendForValidation(thread, role), "Sent for front-line validation")),
    button("Accept recommendation", "primary", !(manager && validated),
      () => act(thread, () => recordDecision(thread, role, opts.recommendation.leading_option_id), "Decision recorded (nothing is applied automatically)")),
    button("Choose another option", "", !(manager && validated), () => openForm(thread, "choose")),
    button("Request more information", "", !(manager && isOpen(thread)), () => openForm(thread, "info")),
    button("Not a real pattern", "", !(manager && canMove(thread, "Not confirmed")), () => openForm(thread, "notreal")),
  );
  box.append(actions);

  const why = !manager
    ? "Switch your role to Manager to act on the brief."
    : !validated && ["Inferred", "Flagged", "Under review"].includes(thread.status)
      ? "Accept and Choose another option unlock once a front-line lead confirms the pattern."
      : "";
  if (why) box.append(text("p", "card-why-disabled", why));

  if (thread.status === "Outcome review due") {
    box.append(text("p", "brief-small", `Outcome review due ${thread.outcome_review_due}. Revisit or stop if: ${thread.decision?.revisit_or_stop_if || "not stated"}`));
    actions.append(button("Record outcome", "primary", !manager, () => openForm(thread, "outcome")));
  }
  if (discussInThread) {
    const discuss = button("Discuss in a thread", "", false, () => discussSignal(thread));
    discuss.title = "Open these records in a chat thread, with citations and Find gaps";
    actions.append(discuss);
  }

  if (form?.threadId === thread.id && form.kind === "info") {
    box.append(inlineForm({ label: "What information would help?", submit: "Add request",
      onSubmit: (v) => act(thread, () => requestMoreInformation(thread, role, v), "Request added") }));
  }
  if (form?.threadId === thread.id && form.kind === "notreal") {
    box.append(inlineForm({ label: "Why isn't this a real pattern? (Saved to help tune the trigger.)", submit: "Mark not confirmed",
      onSubmit: (v) => act(thread, () => notARealPattern(thread, role, v), "Marked as not a real pattern") }));
  }
  if (form?.threadId === thread.id && form.kind === "choose") box.append(chooseOptionForm(thread));
  if (form?.threadId === thread.id && form.kind === "outcome") box.append(outcomeForm(thread));
  return box;
}

function chooseOptionForm(thread) {
  const { options, recommendation } = current(thread).steps.options;
  const box = document.createElement("div");
  box.className = "inline-form";
  box.append(text("label", "", "Which option? (This records a decision only; nothing is applied.)"));
  let chosen = null;
  const choices = [...options.filter((o) => o.option_id !== recommendation.leading_option_id), { option_id: "none", title: "None of these for now" }];
  for (const o of choices) {
    const row = document.createElement("label");
    row.className = "inline-choice";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "signals-option";
    radio.onchange = () => {
      chosen = o.option_id;
      record.disabled = false;
    };
    row.append(radio, ` ${o.title}`);
    box.append(row);
  }
  const record = button("Record decision", "primary", true, () => act(thread, () => recordDecision(thread, role, chosen), "Decision recorded (nothing is applied automatically)"));
  const row = document.createElement("div");
  row.className = "card-actions";
  row.append(record, button("Cancel", "", false, () => { form = null; renderSignals(); }));
  box.append(row);
  return box;
}

function outcomeForm(thread) {
  const box = document.createElement("div");
  box.className = "inline-form";
  box.append(text("label", "", "What happened, and did it help?"));
  const input = document.createElement("textarea");
  input.className = "rules-input";
  const helped = document.createElement("select");
  helped.className = "model-select";
  for (const h of ["Yes", "Partly", "No", "Too early to tell"]) helped.add(new Option(h, h));
  const close = button("Close Thread", "primary", true, () => act(thread, () => closeWithOutcome(thread, role, { whatHappened: input.value, helped: helped.value }), "Thread closed"));
  input.oninput = () => (close.disabled = !input.value.trim());
  const row = document.createElement("div");
  row.className = "card-actions";
  row.append(helped, close, button("Cancel", "", false, () => { form = null; renderSignals(); }));
  box.append(input, row);
  return box;
}

// Details for one option: trade-off, pressure transfer, roles, how we'd know, when to revisit.
function optionDetails(o, evidence) {
  const d = document.createElement("div");
  d.className = "brief-option-details";
  d.append(
    labelled("Local fit / trade-off", o.local_fit),
    labelled("Possible pressure transfer", o.possible_pressure_transfer),
    labelled("Roles to involve", o.roles_to_involve.join(", ") || "—"),
    labelled("How we would know", o.how_we_would_know),
    labelled("Revisit or stop if", `${o.revisit_or_stop_if} (review after ${o.revisit_after_days} days)`),
  );
  const ev = o.evidence_ids.map((id) => evidence.find((e) => e.evidence_id === id)).filter(Boolean);
  d.append(text("p", "brief-small", `Evidence: ${ev.length ? ev.map((e) => e.evidence_id).join(", ") : "No library evidence"} (strength ${o.evidence_strength})`));
  if (ev.some((e) => e.synthetic_placeholder)) d.append(placeholderTag());
  return d;
}

function validationStatus(thread) {
  if (thread.status === "Validated pattern" || thread.decision) return "confirmed by a front-line lead";
  if (thread.status === "Under review") return "waiting for a front-line lead";
  if (thread.status === "Not confirmed") return "not confirmed";
  return "not yet sent";
}

// "Discuss in a thread": the records behind this Thread, opened in a chat thread.
async function discussSignal(thread) {
  try {
    const files = [];
    for (const name of thread.files) {
      const raw = await storage.readProcessedFile(name);
      files.push({ name, raw });
    }
    await discussInThread({ title: `Signal: ${thread.pattern_type} (${thread.location})`, domain: thread.domain, files });
  } catch (err) {
    toast(`Couldn't open the records: ${err.message}`);
  }
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

function list(items) {
  const ul = document.createElement("ul");
  for (const item of items) ul.append(text("li", "", item));
  return ul;
}

// A small coloured label for a trust label (dashed for Inferred and Suggested).
function trustChip(label) {
  return text("span", `trust-chip trust-${String(label).toLowerCase()}`, label);
}

function sourceIds(ids) {
  return text("span", "brief-sources", ids.length ? ` ${ids.join(", ")}` : " no source (unconfirmed)");
}

function labelled(label, value, trust) {
  const p = document.createElement("p");
  p.className = "brief-labelled";
  p.append(text("strong", "", `${label}: `), value ?? "");
  if (trust) p.append(" ", trustChip(trust));
  return p;
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

