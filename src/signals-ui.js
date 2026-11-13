// signals-ui.js — the Signals mode screen (system signals / operational patterns).
//
// Layout: a toolbar (role, Check now, Digest, alert volume), the Thread list on the left,
// and the selected Thread on the right: a header (what it is, and what this role can do),
// then tabs: Summary · Evidence · Map · Options · Detail
// (docs/specs/2026-11-12-signals-redesign.md). Numbers, charts and dates come from
// signalsData.js and signalsFormat.js, worked out by code from the records.
//
// Guardrails in the interface:
//  • Every button records the ROLE that pressed it (never a name).
//  • Buttons are only active in the statuses and roles the spec allows; otherwise they're
//    greyed out with a line saying why. The status rules themselves live in threads.js.
//  • Model text is always shown as plain text (textContent), never as HTML.

import * as storage from "./storage.js";
import { checkForSignals, startMonitorTimer } from "./monitor.js";
import {
  current, ROLES, rejectionCounts,
  confirmPattern, addContext, doesNotMatch,
  sendForValidation, notARealPattern, requestMoreInformation, recordDecision, startOutcomeReview, closeWithOutcome,
} from "./threads.js";
import { SIGNALS_CONFIG } from "./config.js";
import { routeAlerts, alertVolume, buildDigest, sendLocalNotification } from "./notify.js";
import { confidenceText, byPriority } from "./recurrence.js";
import { whenText, plainTimes } from "./signalsFormat.js";
import { evidenceLines, verificationSummary, removedLines, policyWording, gapLabels } from "./evidenceView.js";
import { contextLine, titleLine, whenTag, updatedNote, statusPill, confidenceMeter, occasionMarks, trustTag, reference, measure, actionButton } from "./signals-parts.js";
import { timelineData, driversData, recordDetails } from "./signalsMap.js";
import { numberTiles, chartData, keyQuotes, recordsThatDontFit, headerActions, historySummary } from "./signalsData.js";

const $ = (id) => document.getElementById(id);
let threads = [];          // all Signals Threads, newest first
let selectedId = null;     // the Thread shown on the right
let role = readSetting("signalsRole", "");
let busy = false;          // a check is running
let form = null;           // an inline form that's open: { threadId, kind }
let showingDigest = false; // the digest panel is open
let alertState = {};       // flags and digest items (signals/state.json)
let mapView = readSetting("signalsMapView", "timeline"); // the Map tab: "timeline" or "drivers" (remembered)
let mapSelected = null;    // the box on the map whose records are shown beside it ("view:key")
const toggledOccasions = new Set(); // timeline occasions opened or closed by hand (the first starts open)
let records = [];          // processed records: the tiles, chart, quotes and side panel are worked out from these
let tab = readSetting("signalsTab", "summary"); // the open tab on the Thread page
const openOptions = new Set(); // options whose full reasoning is open
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
  records = await loadRecords();
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
  // Folder buttons. Any failure shows as a message instead of failing silently.
  const safely = (action) => async () => {
    try {
      await action();
    } catch (err) {
      showProgress(`Couldn't do that: ${err?.message ?? err}`, true);
    }
  };
  $("signals-show-incoming").onclick = safely(async () => window.__TAURI__.opener.revealItemInDir(await storage.incomingFolderPath()));
  $("signals-benchmarks").onclick = safely(async () => {
    const files = [
      ...(await storage.copyPackagedToIncoming("data/benchmarks/healthcare")),
      ...(await storage.copyPackagedToIncoming("data/benchmarks/energy")),
    ];
    toast(`Copied ${files.length} benchmark files to the incoming folder`);
    checkNow();
  });
  $("signals-test-file").onclick = safely(async () => {
    const files = await storage.copyPackagedToIncoming("data/test_incoming");
    toast(files.length ? `Copied ${files.join(", ")} to the incoming folder. Press Check now.` : "No test file found in the app's data.");
  });
  // Optional automatic checks (config.js; 0 = manual "Check now" only).
  startMonitorTimer(SIGNALS_CONFIG.monitorIntervalMinutes, () => checkNow({ quiet: true }));
  updateBadge();
}

// The processed records. If they can't be read, the page still opens and says what is missing.
async function loadRecords() {
  try {
    return await storage.monitorIO.loadProcessedRecords();
  } catch {
    return [];
  }
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
    records = await loadRecords(); // new records may have arrived
    const changed = [...summary.created, ...summary.updated];
    const changes = [
      ...summary.created.map((id) => ({ thread: threads.find((t) => t.id === id), kind: "new" })),
      ...summary.updated.map((id) => ({ thread: threads.find((t) => t.id === id), kind: "updated" })),
    ].filter((c) => c.thread);
    const toNotify = routeAlerts(changes, alertState, SIGNALS_CONFIG.dailyFlagCap);
    for (const c of changes) await storage.saveSignalThread(c.thread); // records flag/digest on the Thread
    await storage.saveSignalsState(alertState);
    for (const t of toNotify) await sendLocalNotification(t, SIGNALS_CONFIG.recurrenceEvery);
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
  // Threads seen on more occasions (10+, 50+, 70+) come first; otherwise newest first.
  for (const t of byPriority(threads, SIGNALS_CONFIG.recurrenceEvery)) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "signals-row" + (t.id === selectedId ? " is-selected" : "");
    const facts = document.createElement("span");
    facts.className = "signals-row-facts";
    facts.append(statusPill(t.status), confidenceMeter(current(t).steps.pattern.confidence), occasionMarks(t.windows.length));
    row.append(contextLine(t.domain, t.location), titleLine(t.pattern_type, "span"), facts, updatedNote(t.updated_at));
    row.onclick = () => {
      selectedId = t.id;
      form = null;
      mapSelected = null;
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
    detail.append(text("p", "signals-empty", "Select a Thread to see its summary, evidence, map and options."));
    return;
  }
  detail.append(renderHeader(thread), renderTabs());
  const openForm_ = renderOpenForm(thread);
  if (openForm_) detail.append(openForm_);
  const parts = {
    summary: () => [role === "Front-line lead" ? renderCard(thread) : null, noticedSection(thread), contextNotes(thread), tilesSection(thread), chartAndQuotes(thread), optionsSection(thread)],
    evidence: () => [chartAndQuotes(thread), policySection(thread), dontFitSection(thread)],
    map: () => [renderMapSection(thread)],
    options: () => [optionsSection(thread)],
    detail: () => [detailSection(thread)],
  };
  detail.append(...(parts[tab] ?? parts.summary)().filter(Boolean));
}

// ---------- Thread header: what it is on the left, what this role can do on the right ----------
function renderHeader(thread) {
  const run = current(thread);
  const head = document.createElement("header");
  head.className = "signals-detail-head";
  const about = document.createElement("div");
  about.className = "tp-about";
  const facts = document.createElement("div");
  facts.className = "signals-facts";
  const status = statusPill(thread.status);
  status.title = ["Inferred", "Flagged"].includes(thread.status) ? "Threadline drafted this; a manager decides what happens next." : "Set by a person, with their role. Threadline never moves a Thread past Flagged.";
  facts.append(
    status,
    withHelp(confidenceMeter(run.steps.pattern.confidence), "How sure Threadline is that the pattern is real. Medium: two kinds of records agree on one occasion. High needs agreement on more than one."),
    withHelp(occasionMarks(thread.windows.length), "How many times the pattern has happened. Raises priority; never changes confidence."),
  );
  if (thread.outcome_review_due && ["Decision recorded", "Outcome review due"].includes(thread.status)) facts.append(text("span", "signals-due", `Outcome review due ${whenText(thread.outcome_review_due)}`));
  const foot = document.createElement("div");
  foot.className = "signals-facts";
  foot.append(updatedNote(thread.updated_at), reference(thread.id));
  about.append(contextLine(thread.domain, thread.location), titleLine(thread.pattern_type), whenTags(thread.windows), facts, foot);

  // The current role's actions (signalsData.js decides which; threads.js still checks each press).
  const side = document.createElement("div");
  side.className = "tp-actions";
  const { actions, note } = headerActions(thread, role);
  const opts = run.steps.options;
  const press = {
    send: () => act(thread, () => sendForValidation(thread, role), "Sent for front-line validation"),
    accept: () => act(thread, () => recordDecision(thread, role, opts.recommendation.leading_option_id), "Decision recorded (nothing is applied automatically)"),
    review: () => act(thread, () => startOutcomeReview(thread, role), "Outcome review started"),
    confirm: () => act(thread, () => confirmPattern(thread, role), "Pattern confirmed"),
    choose: () => openForm(thread, "choose"),
    outcome: () => openForm(thread, "outcome"),
    info: () => openForm(thread, "info"),
    notreal: () => openForm(thread, "notreal"),
    context: () => openForm(thread, "context"),
    mismatch: () => openForm(thread, "mismatch"),
  };
  if (actions.length) {
    const row = document.createElement("div");
    row.className = "card-actions";
    for (const a of actions) row.append(actionButton(a.label, { primary: a.primary, onClick: press[a.id] }));
    side.append(row);
  }
  if (note) side.append(text("p", "card-why-disabled", note));
  head.append(about, side);

  if (thread.decision) {
    head.append(text("div", "brief-decision", `Decision recorded: ${thread.decision.option_title}${thread.decision.was_recommended ? " (the recommendation)" : ""} · ${thread.decision.role} · ${whenText(thread.decision.date.slice(0, 10))}. Nothing is applied by Threadline; carrying it out is up to the team.`));
    if (["Decision recorded", "Outcome review due"].includes(thread.status)) head.append(text("p", "brief-small", `Revisit or stop if: ${thread.decision.revisit_or_stop_if || "not stated"}`));
  }
  if (thread.outcome) head.append(text("div", "brief-decision", `Outcome: ${thread.outcome.helped}. ${thread.outcome.what_happened} (${thread.outcome.role}, ${whenText(thread.outcome.date.slice(0, 10))})`));
  return head;
}

// The form a header button opened, shown in place under the tabs (no pop-up windows).
function renderOpenForm(thread) {
  if (form?.threadId !== thread.id) return null;
  const forms = {
    context: () => inlineForm({
      label: "What context should reviewers know? (It will be saved as Experiential, with your role.)", multiline: true, submit: "Save context",
      onSubmit: (value) => act(thread, () => addContext(thread, role, value), "Context added"),
    }),
    mismatch: () => inlineForm({
      label: "In one line: what doesn't match what you see on shift?", submit: "Submit",
      onSubmit: (value) => act(thread, () => doesNotMatch(thread, role, value), "Marked as not confirmed"),
    }),
    info: () => inlineForm({ label: "What information would help?", submit: "Add request",
      onSubmit: (v) => act(thread, () => requestMoreInformation(thread, role, v), "Request added") }),
    notreal: () => inlineForm({ label: "Why isn't this a real pattern? (Saved to help tune the trigger.)", submit: "Mark not confirmed",
      onSubmit: (v) => act(thread, () => notARealPattern(thread, role, v), "Marked as not a real pattern") }),
    choose: () => chooseOptionForm(thread),
    outcome: () => outcomeForm(thread),
  };
  const box = forms[form.kind]?.();
  if (box) box.classList.add("tp-form");
  return box ?? null;
}

// ---------- Tabs: Summary · Evidence · Map · Options · Detail (flat: they navigate) ----------
const TABS = [
  ["summary", "Summary", "The decision view: what was noticed, the key numbers and quotes"],
  ["evidence", "Evidence", "The chart, the policy and the records that don't fit"],
  ["map", "Map", "What happened when, and what drives it"],
  ["options", "Options", "Possible approaches and the decision"],
  ["detail", "Detail", "System analysis, what was checked and the history"],
];
function renderTabs() {
  const nav = document.createElement("nav");
  nav.className = "tp-tabs";
  nav.setAttribute("role", "tablist");
  nav.setAttribute("aria-label", "Thread sections");
  for (const [id, label, about] of TABS) {
    const b = text("button", "tp-tab", label);
    b.type = "button";
    b.title = about;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(tab === id));
    b.onclick = () => {
      tab = id;
      saveSetting("signalsTab", id);
      renderSignals();
    };
    nav.append(b);
  }
  return nav;
}

// ---------- The pieces of the tabs ----------
// A small "i" with a one-line explanation, shown on hover and on keyboard focus.
function helpDot(words) {
  const dot = text("span", "help", "i");
  dot.tabIndex = 0;
  dot.setAttribute("role", "img");
  dot.setAttribute("aria-label", words);
  dot.dataset.tip = words;
  return dot;
}
function withHelp(node, words) {
  const wrap = document.createElement("span");
  wrap.className = "tp-with-help";
  wrap.append(node, helpDot(words));
  return wrap;
}
function section(className, heading, help, ...children) {
  const box = document.createElement("section");
  box.className = `tp-section ${className}`;
  if (heading) {
    const h = text("h3", "tp-heading", heading);
    if (help) h.append(helpDot(help));
    box.append(h);
  }
  box.append(...children.filter(Boolean));
  return box;
}

// "What Threadline noticed": the checked pattern statement, labelled as a draft.
function noticedSection(thread) {
  const run = current(thread);
  return section("tp-noticed", "What Threadline noticed", "A draft summary for you to judge. It only uses facts from the cited records.",
    text("p", "tp-statement", plainTimes(run.steps.pattern.pattern_statement)),
    text("p", "brief-small", `A draft for you to judge. ${verificationSummary(run.meta?.verification)}`));
}

// Four number tiles, each worked out by code from the records (signalsData.js).
function tilesSection(thread) {
  const grid = document.createElement("section");
  grid.className = "tp-tiles";
  for (const t of numberTiles(thread, records, rules)) {
    const tile = document.createElement("div");
    tile.className = "tp-tile";
    const label = text("div", "meta-context", t.label);
    label.append(helpDot(t.help));
    tile.append(label, measure(t.value, t.unit, t.under));
    grid.append(tile);
  }
  return grid;
}

const BAR_HEIGHT = 124; // pixels for the tallest bar

// The chart (bars by hour, trigger line, darker where every trigger was crossed) and the key quotes.
function chartAndQuotes(thread) {
  const chart = chartData(thread, records, rules);
  const box = document.createElement("section");
  box.className = "tp-section tp-evidence";

  const left = document.createElement("div");
  left.className = "tp-chart";
  if (chart.occasions.length === 0) {
    left.append(text("h3", "tp-heading", "Flow data by hour"), text("p", "brief-small", "The flow records for this chart weren't found in the processed folder."));
  } else {
    const head = document.createElement("div");
    head.className = "tp-chart-head";
    const h = text("h3", "tp-heading", chart.title);
    h.append(helpDot("Each bar is one hour of flow data. Darker bars crossed every trigger."));
    head.append(h, text("span", "tp-chart-key", chart.trigger.text));
    const groups = document.createElement("div");
    groups.className = "tp-chart-groups";
    for (const o of chart.occasions) {
      const group = document.createElement("div");
      group.className = "tp-chart-group";
      group.setAttribute("role", "img");
      group.setAttribute("aria-label", `${o.day}: ${o.hours.map((x) => `${x.label} ${x.value}${x.crossed ? " (crossed)" : ""}`).join(", ")}`);
      const plot = document.createElement("div");
      plot.className = "tp-chart-plot";
      const line = document.createElement("div");
      line.className = "tp-chart-line";
      line.style.bottom = `${Math.round((chart.trigger.value / chart.max) * BAR_HEIGHT)}px`;
      plot.append(line);
      const axis = document.createElement("div");
      axis.className = "tp-chart-axis";
      for (const x of o.hours) {
        const col = document.createElement("div");
        col.className = "tp-chart-col";
        const bar = document.createElement("div");
        bar.className = `tp-chart-bar${x.crossed ? " is-crossed" : ""}`;
        bar.style.height = `${Math.max(2, Math.round((x.value / chart.max) * BAR_HEIGHT))}px`;
        bar.title = x.source_id;
        col.append(text("span", "tp-chart-value", String(x.value)), bar);
        plot.append(col);
        const tick = document.createElement("div");
        tick.className = "tp-chart-tick";
        tick.append(text("span", "tp-chart-hour", x.label), ...x.others.map((v) => text("span", "tp-chart-other", v)));
        axis.append(tick);
      }
      group.append(text("div", "tp-chart-day", o.day), plot, axis);
      groups.append(group);
    }
    left.append(head, groups, text("p", "brief-small", chart.note));
  }

  const right = document.createElement("div");
  right.className = "tp-quotes";
  const qh = text("h3", "tp-heading", "In the records' own words");
  qh.append(helpDot("Exact quotes. Code checked that each appears word for word in its record."));
  right.append(qh);
  const quotes = keyQuotes(thread, records, rules);
  if (quotes.length === 0) right.append(text("p", "brief-small", "No verified quotes from incident or complaint records."));
  for (const q of quotes) {
    const card = document.createElement("div");
    card.className = "tp-quote";
    const top = document.createElement("div");
    top.className = "tp-quote-top";
    top.append(text("span", "tp-quote-kind", q.kind), text("span", "tp-quote-when", q.when));
    if (q.safety) {
      const tag = text("span", "tag tag-inferred", "Safety-relevant");
      tag.title = "Matches a safety condition in the domain rules, checked by code.";
      top.append(tag);
    } else top.append(trustTag(q.trust_label));
    card.append(top, text("p", "tp-quote-words", `“${q.quote}”`), reference(`${q.source_id} · quote verified`));
    right.append(card);
  }
  box.append(left, right);
  return box;
}

// Policy and practice, side by side.
function policySection(thread) {
  const run = current(thread);
  const gap = run.steps.analysis.policy_practice_gap;
  const trust = gapLabels(gap, run.meta?.verification);
  const side = (label, words, ...rest) => {
    const card = document.createElement("div");
    card.className = "tp-card";
    const top = document.createElement("div");
    top.append(trustTag(label));
    card.append(top, text("p", "", words), ...rest.filter(Boolean));
    return card;
  };
  const wording = policyWording(gap);
  const verified = run.meta?.verification?.policy_quote === "verified";
  const row = document.createElement("div");
  row.className = "tp-pair";
  row.append(
    side(trust.expects, gap.what_policy_expects, wording ? text("p", "brief-proof", wording) : null,
      gap.policy_source_id ? reference(`${gap.policy_source_id}${wording && verified ? " · wording verified" : ""}`) : null),
    side(trust.suggests, gap.what_records_suggest),
  );
  return section("", "Policy and practice", "What the policy expects, beside what the records show happened.", row, trust.note ? text("p", "brief-small", trust.note) : null);
}

// Records the draft listed as not fitting: the record's own title, words and time, never a bare ID.
function dontFitSection(thread) {
  const rows = recordsThatDontFit(thread, records);
  const grid = document.createElement("div");
  grid.className = "tp-pair";
  for (const r of rows) {
    const card = document.createElement("div");
    card.className = "tp-card";
    const top = document.createElement("div");
    top.className = "tp-quote-top";
    const tag = text("span", "tag", r.tag);
    tag.title = "Threadline's draft listed this record as not fitting the pattern. Code can't tell which way a record points, so it doesn't say.";
    top.append(tag);
    if (r.source_id) top.append(reference(r.source_id));
    card.append(top);
    if (r.title) card.append(text("div", "tp-card-title", r.title));
    if (r.text) card.append(text("p", "", r.text));
    if (r.kind || r.when) card.append(text("p", "brief-small", [r.kind, r.when].filter(Boolean).join(" · ")));
    if (r.note) card.append(text("p", "brief-small", `Draft note: ${r.note}`));
    grid.append(card);
  }
  return section("", "Records that don't fit, or may not matter", "Records Threadline saw but did not count as support.",
    rows.length ? grid : text("p", "brief-small", "The draft listed no records as not fitting."));
}

// Options: cards in a row on a light purple panel; the recommended one outlined in purple.
function optionsSection(thread) {
  const { evidence, options } = current(thread).steps;
  const rec = options.recommendation;
  const leading = options.options.find((o) => o.option_id === rec.leading_option_id);
  const ordered = [...(leading ? [leading] : []), ...options.options.filter((o) => o !== leading)];
  const row = document.createElement("div");
  row.className = "tp-options";
  for (const o of ordered) {
    const card = document.createElement("div");
    card.className = `tp-option${o === leading ? " is-suggested" : ""}`;
    const top = document.createElement("div");
    top.append(text("span", `tag ${o === leading ? "tag-suggested" : ""}`, o === leading ? "Threadline's suggestion" : o.type === "Learn more" ? "Learn more first" : o.type));
    const facts = document.createElement("div");
    facts.className = "tp-option-facts";
    facts.append(labelled("Trade-off", o.local_fit), labelled("Review", `after ${o.revisit_after_days} days`));
    const more = actionButton(openOptions.has(o.option_id) ? "Hide full reasoning" : "See full reasoning", {
      onClick: () => {
        if (!openOptions.delete(o.option_id)) openOptions.add(o.option_id);
        renderSignals();
      },
    });
    more.setAttribute("aria-expanded", String(openOptions.has(o.option_id)));
    card.append(top, text("div", "tp-option-title", o.title), text("p", "tp-option-about", o.description), facts, more);
    if (openOptions.has(o.option_id)) {
      if (o === leading) card.append(labelled("Why this one", rec.rationale), labelled("What would change it", rec.would_change_if), text("p", "brief-small", `Recommendation confidence: ${rec.confidence}`));
      card.append(optionDetails(o, evidence));
    }
    row.append(card);
  }
  const strength = text("span", "brief-small", `Evidence strength: ${leading?.evidence_strength ?? "None"}.${current(thread).meta.placeholder_evidence ? " The evidence library still holds placeholders." : ""}`);
  const cited = [...new Set(options.options.flatMap((o) => o.evidence_ids))].map((id) => evidence.find((e) => e.evidence_id === id)).filter(Boolean);
  const library = document.createElement("details");
  library.className = "tp-row";
  library.append(text("summary", "", `Library evidence (${cited.length})`));
  if (cited.length === 0) library.append(text("p", "brief-small", "No library evidence. Options rely on the records and local judgment."));
  for (const e of cited) {
    const item = text("div", "brief-evidence", `${e.evidence_id} · ${e.title} `);
    item.append(text("span", "brief-small", `(${e.source_type}, strength ${e.strength}). ${e.citation}`));
    if (e.synthetic_placeholder) item.append(placeholderTag());
    library.append(item);
  }
  const note = role === "Manager" ? headerActions(thread, role).note : "";
  return section("tp-approaches", "Possible approaches", "Drafts for a person to decide on. Nothing is applied automatically.",
    strength, row, note ? text("p", "brief-small", note) : null, library);
}

// Detail: the full findings, analysis, checks and history, each in a row that opens.
function detailSection(thread) {
  const run = current(thread);
  const { pattern, analysis, options } = run.steps;
  const verification = run.meta?.verification;
  const row = (title, summary, ...children) => {
    const d = document.createElement("details");
    d.className = "tp-row";
    const s = text("summary", "", title);
    if (summary) s.append(text("span", "tp-row-summary", summary));
    d.append(s, ...children.filter(Boolean));
    return d;
  };

  const lines = evidenceLines(pattern);
  const findings = document.createElement("ul");
  findings.className = "brief-evidence";
  for (const e of lines) {
    const li = text("li", "", `${e.finding} `);
    li.append(trustChip(e.trust_label), sourceIds([e.source_id]));
    if (e.proof) li.append(text("div", "brief-proof", e.proof));
    findings.append(li);
  }

  const vignette = document.createElement("dl");
  vignette.className = "brief-vignette";
  for (const [label, value] of [
    ["Situation", pattern.possible_vignette.situation],
    ["What appears to happen", pattern.possible_vignette.what_appears_to_happen],
    ["Observed effects", pattern.possible_vignette.observed_effects],
  ]) vignette.append(text("dt", "", label), text("dd", "", plainTimes(value)));
  const factors = document.createElement("ul");
  for (const c of analysis.contributing_conditions) {
    const li = text("li", "", `${c.condition} `);
    li.append(trustChip(c.trust_label), sourceIds(c.source_ids));
    factors.append(li);
  }
  const pressure = document.createElement("ul");
  for (const p of analysis.pressure_map) {
    const li = text("li", "", `${p.role}: ${p.pressure_carried}${p.shifting_to ? ` (appears to shift to ${p.shifting_to})` : ""} `);
    li.append(trustChip(p.trust_label));
    pressure.append(li);
  }
  const analysisParts = [
    text("div", "card-label", "The draft, in more detail"), vignette,
    text("div", "card-label", "Possible contributing factors"), factors,
    analysis.compounding_factors.length ? text("div", "card-label", "Where small variations combine") : null,
    analysis.compounding_factors.length ? list(analysis.compounding_factors) : null,
    analysis.pressure_map.length ? text("div", "card-label", "Pressure map") : null,
    analysis.pressure_map.length ? pressure : null,
    text("div", "card-label", "Other explanations to rule out"), list(analysis.alternative_explanations),
    text("div", "card-label", "Questions a reviewer would need answered"), list(analysis.open_questions),
    text("p", "brief-small", `Pattern confidence: ${pattern.confidence} (${pattern.confidence_reason}) · Front-line validation: ${validationStatus(thread)}`),
    options.suggested_reviewers.length ? text("div", "card-label", "Suggested reviewers (roles)") : null,
    options.suggested_reviewers.length ? list(options.suggested_reviewers.map((r) => `${r.role}: ${r.why}`)) : null,
  ];

  const removed = removedLines(verification);
  const checks = [
    text("p", "brief-small", verificationSummary(verification)),
    removed.length ? text("div", "card-label", "Removed or replaced as unverified") : null,
    removed.length ? list(removed) : null,
    run.log.length ? text("div", "card-label", `Code checks on the latest run (${run.log.length})`) : null,
    ...run.log.map((l) => text("div", "history-row history-log", `${l.step}: ${l.detail}`)),
  ];

  const history = [...thread.history].reverse().map((h) => {
    const item = text("div", "history-row", h.note);
    item.prepend(text("span", "history-when", `${shortWhen(h.time)} · ${h.by} · ${h.status}`));
    return item;
  });

  const rows = [
    row("All findings", `${lines.length} verified, each with its record`, findings),
    row("System analysis", "contributing factors, other explanations, reviewer questions", ...analysisParts),
    row("What was checked", removed.length ? `${removed.length} removed or replaced as unverified` : "nothing removed", ...checks),
    row("History", historySummary(thread), ...history),
  ];
  if (role !== "Front-line lead") rows.push(row("Front-line review card", "what a front-line lead is asked", renderCard(thread)));
  if (thread.information_requests.length) {
    rows.push(row("Information requested", String(thread.information_requests.length), list(thread.information_requests.map((r) => `${r.text} (${r.role}, ${shortWhen(r.time)})`))));
  }
  const box = section("", "The full detail, when you want it", "", ...rows);
  if (discussInThread) {
    const discuss = actionButton("Discuss in a thread", { onClick: () => discussSignal(thread) });
    discuss.title = "Open these records in a chat thread, with citations and Find gaps";
    box.append(discuss);
  }
  return box;
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
        text("span", "brief-small", ` ${kinds.join(" and ")} · ${confidenceText(thread, SIGNALS_CONFIG.recurrenceEvery)} · ${thread.status}${over_cap ? " · over today's flag limit" : ""}`),
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
  box.append(text("div", "card-badge", card.evidence_badge), text("div", "card-confidence", `Confidence: ${confidenceText(thread, SIGNALS_CONFIG.recurrenceEvery)}`));
  if (run.meta.placeholder_evidence) box.append(placeholderTag());
  box.append(text("p", "card-question", card.question));

  return box;
}

// Context added by people (staff input, Experiential): shown to every role, in amber.
function contextNotes(thread) {
  if (!thread.context_notes.length) return null;
  const notes = document.createElement("section");
  notes.className = "tp-section context-notes";
  notes.append(text("h3", "tp-heading", "Context from staff"));
  for (const n of thread.context_notes) {
    const note = text("div", "context-note", n.text);
    const meta = text("span", "context-meta", `${n.role} · ${shortWhen(n.time)} `);
    meta.append(trustTag("Experiential"));
    note.append(meta);
    notes.append(note);
  }
  return notes;
}

// ---------- Map: Timeline | Drivers (spec section 4; the data is worked out in signalsMap.js) ----------
const MAP_VIEWS = [
  ["timeline", "Timeline", "What happened when", "Drawn by code from the records' own timestamps and values. Each lane is a kind of record."],
  ["drivers", "Drivers", "What drives it", "Read left to right: what is happening, what drives it, and what could change it. The wording is Threadline's draft; the counts are from the records."],
];

function renderMapSection(thread) {
  const [, , heading, help] = MAP_VIEWS.find(([id]) => id === mapView) ?? MAP_VIEWS[0];
  const box = document.createElement("section");
  box.className = "tp-section tm";
  const head = document.createElement("div");
  head.className = "tm-head";
  const h = text("h3", "tp-heading", heading);
  h.append(helpDot(help));
  const views = document.createElement("div");
  views.className = "mode-switch tm-switch";
  views.setAttribute("role", "tablist");
  views.setAttribute("aria-label", "Map view");
  for (const [id, label, about] of MAP_VIEWS) {
    const b = text("button", "mode-option", label);
    b.type = "button";
    b.title = about;
    b.dataset.focus = `view-${id}`;
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(mapView === id));
    b.onclick = () => {
      mapView = id;
      mapSelected = null;
      saveSetting("signalsMapView", id);
      rerenderKeepingFocus(b.dataset.focus);
    };
    views.append(b);
  }
  head.append(h, views);

  const body = document.createElement("div");
  body.className = "tm-body";
  const main = document.createElement("div");
  main.className = "tm-main";
  const panel = document.createElement("aside");
  panel.className = "tm-panel";
  panel.setAttribute("aria-live", "polite");
  body.append(main, panel);

  // Selecting a box fills the panel beside the map, without redrawing (so keyboard focus stays put).
  const select = (item, button) => {
    mapSelected = `${mapView}:${item.key ?? item.id}`;
    for (const other of main.querySelectorAll(".tm-item.is-selected")) {
      other.classList.remove("is-selected");
      other.setAttribute("aria-pressed", "false");
    }
    button.classList.add("is-selected");
    button.setAttribute("aria-pressed", "true");
    fillMapPanel(panel, item, thread);
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" }); // on a narrow window the panel sits under the map
  };
  const found = mapView === "drivers" ? drawDrivers(main, thread, select) : drawTimeline(main, thread, select);
  if (found) fillMapPanel(panel, found, thread);
  else panel.append(text("div", "meta-context", "Selected"), text("p", "brief-small", "Select any box to see the records behind it."));

  box.append(head, body, mapLegend());
  return box;
}

// One box on the map. It selects (it doesn't act), so it is flat, with a visible focus ring.
function mapItem(item, className, select, ...children) {
  const b = document.createElement("button");
  b.type = "button";
  const selected = mapSelected === `${mapView}:${item.key ?? item.id}`;
  b.className = `tm-item ${className}${selected ? " is-selected" : ""}`;
  b.setAttribute("aria-pressed", String(selected));
  b.append(...children.filter(Boolean));
  b.onclick = () => select(item, b);
  return b;
}
const barMark = () => {
  const bar = document.createElement("span");
  bar.className = "tm-bar";
  bar.setAttribute("aria-hidden", "true");
  return bar;
};
const stack = (...children) => {
  const s = document.createElement("span");
  s.className = "tm-words";
  s.append(...children.filter(Boolean));
  return s;
};

// Timeline: lanes by kind of record; the pattern window shaded; the first occasion open, the rest as strips.
function drawTimeline(main, thread, select) {
  const { occasions } = timelineData(thread, records, rules);
  let found = null;
  occasions.forEach((o, index) => {
    const key = `${thread.id}:${index}`;
    const open = toggledOccasions.has(key) ? index !== 0 : index === 0;
    const wrap = document.createElement("div");
    wrap.className = "tm-occasion";
    const strip = document.createElement("button");
    strip.type = "button";
    strip.className = "tm-strip";
    strip.dataset.focus = `occasion-${index}`;
    strip.setAttribute("aria-expanded", String(open));
    strip.append(whenTag(thread.windows[index]), text("span", "tm-strip-words", `${occasions.length > 1 ? `Occasion ${index + 1} of ${occasions.length}. ` : ""}${o.summary}`), text("span", "tm-strip-more", open ? "Hide" : "Show"));
    strip.onclick = () => {
      toggledOccasions.has(key) ? toggledOccasions.delete(key) : toggledOccasions.add(key);
      rerenderKeepingFocus(strip.dataset.focus);
    };
    wrap.append(strip);
    if (!open) {
      main.append(wrap);
      return;
    }

    const scroll = document.createElement("div");
    scroll.className = "tm-scroll";
    const track = document.createElement("div");
    track.className = "tm-track";
    track.style.setProperty("--hours", o.hours);
    const shade = document.createElement("div");
    shade.className = "tm-window";
    shade.style.setProperty("--from", o.window.from);
    shade.style.setProperty("--to", o.window.to);
    shade.append(text("span", "tm-window-label", o.window.label));
    track.append(shade);

    for (const lane of o.lanes) {
      const row = document.createElement("div");
      row.className = `tm-lane tm-lane-${lane.id}`;
      row.style.setProperty("--rows", lane.rows);
      const area = document.createElement("div");
      area.className = "tm-lane-area";
      if (lane.items.length === 0) area.append(text("span", "tm-none", `None in these hours`));
      for (const item of lane.items) {
        const b = lane.id === "flow"
          ? mapItem(item, `tm-flow${item.crossed ? " is-crossed" : ""}`, select,
            stack(text("b", "tm-big", item.value), text("span", "", ` ${item.label}`)), ...item.others.map((v) => text("span", "tm-sub", v)))
          : mapItem(item, `tm-event tm-${item.relation}`, select, barMark(),
            stack(text("span", "tm-title", item.title), item.text ? text("span", "tm-sub", item.text) : null,
              reference([item.time, item.note, item.safety ? "safety-relevant" : ""].filter(Boolean).join(" · "))));
        b.style.setProperty("--at", item.at);
        b.style.setProperty("--row", item.row);
        b.title = [item.time, item.title, item.text].filter(Boolean).join("\n");
        b.setAttribute("aria-label", `${lane.label}: ${[item.time, item.title, ...(item.others ?? []), item.crossed ? "crossed the triggers" : "", item.note].filter(Boolean).join(", ")}`);
        area.append(b);
        if (b.classList.contains("is-selected")) found = item;
      }
      row.append(text("div", "tm-lane-label", lane.label), area);
      track.append(row);
    }

    const axis = document.createElement("div");
    axis.className = "tm-lane tm-axis";
    const ticks = document.createElement("div");
    ticks.className = "tm-lane-area";
    ticks.setAttribute("aria-hidden", "true");
    o.ticks.forEach((label, i) => {
      const tick = text("span", "tm-tick", label);
      tick.style.setProperty("--at", i);
      ticks.append(tick);
    });
    axis.append(text("div", "tm-lane-label", ""), ticks);
    track.append(axis);
    scroll.append(track);
    wrap.append(scroll);
    main.append(wrap);
  });
  if (occasions.length === 0) main.append(text("p", "brief-small", "This Thread has no time windows to draw."));
  return found;
}

// Drivers: four columns built from the analysis the Thread already holds. Dashed = no record behind it yet.
function drawDrivers(main, thread, select) {
  const { columns } = driversData(thread, records, rules);
  let found = null;
  const scroll = document.createElement("div");
  scroll.className = "tm-scroll";
  const grid = document.createElement("div");
  grid.className = "tm-drivers";
  for (const column of columns) {
    const col = document.createElement("div");
    col.className = `tm-column tm-column-${column.id}`;
    col.append(text("div", "meta-context", column.label));
    if (column.items.length === 0) col.append(text("p", "brief-small", "None in the draft."));
    for (const item of column.items) {
      const kind = item.trust_label.toLowerCase();
      const b = mapItem(item, `tm-driver tm-${kind}${item.dashed ? " is-dashed" : ""}${item.recommended ? " is-recommended" : ""}${column.id === "outcome" ? " is-outcome" : ""}`, select,
        barMark(), stack(text("span", "tm-title", plainTimes(item.title)), reference(item.sub)));
      b.setAttribute("aria-label", `${column.label}: ${item.title}. ${item.sub}. ${item.trust_label}`);
      col.append(b);
      if (b.classList.contains("is-selected")) found = item;
    }
    grid.append(col);
  }
  scroll.append(grid);
  main.append(scroll);
  return found;
}

function mapLegend() {
  const box = document.createElement("div");
  box.className = "tm-legend";
  const entries = mapView === "drivers"
    ? [["tm-observed", "From the records"], ["tm-authoritative", "From policy"], ["tm-suggested is-dashed", "Suggested, needs a decision"], ["tm-inferred is-dashed", "Proposed, no record behind it yet"]]
    : [["tm-cited", "Cited in the draft"], ["tm-policy", "Policy"], ["tm-not-cited", "Seen nearby, not counted as support"], ["tm-flow is-crossed", "Hour that crossed every trigger"]];
  for (const [className, label] of entries) {
    const item = text("span", "tm-legend-item", label);
    const swatch = document.createElement("span");
    swatch.className = `tm-swatch ${className}`;
    swatch.setAttribute("aria-hidden", "true");
    item.prepend(swatch);
    box.append(item);
  }
  return box;
}

// Beside the map: the records (or, for an option, the evidence items) behind the selected box.
function fillMapPanel(panel, item, thread) {
  panel.innerHTML = "";
  const facts = document.createElement("div");
  facts.className = "signals-facts";
  const trust = item.trust_label ?? (item.relation === "policy" ? "Authoritative" : ["flow", "cited"].includes(item.relation) ? "Observed" : null);
  facts.append(trust ? trustTag(trust) : text("span", "tag", item.note));
  if (item.source_ids?.length) facts.append(text("span", "brief-small", plural(new Set(item.source_ids).size, "record")));
  panel.append(text("div", "meta-context", "Selected"), text("div", "tm-panel-title", plainTimes(item.title)), facts);

  if (item.option_id) {
    const run = current(thread);
    const option = run.steps.options.options.find((o) => o.option_id === item.option_id);
    if (option) panel.append(text("p", "", option.description));
    const items = (item.evidence_ids ?? []).map((id) => run.steps.evidence?.find((e) => e.evidence_id === id)).filter(Boolean);
    if (items.length === 0) panel.append(text("p", "brief-small", "No library evidence."));
    for (const e of items) {
      const card = text("div", "tm-record", "");
      card.append(text("div", "tp-card-title", e.title), text("p", "brief-small", `${e.source_type}, strength ${e.strength}. ${e.citation}`), reference(e.evidence_id));
      if (e.synthetic_placeholder) card.append(placeholderTag());
      panel.append(card);
    }
    panel.append(text("p", "brief-small", "A suggestion from Threadline. It needs a decision by a person; nothing is applied automatically."));
    return;
  }
  if (!item.source_ids?.length) {
    panel.append(text("p", "brief-small", "No record is cited for this: it is proposed by Threadline and unconfirmed."));
    return;
  }
  for (const r of recordDetails(item.source_ids, thread, records, rules)) {
    const card = text("div", "tm-record", "");
    if (r.title) card.append(text("div", "tp-card-title", r.title));
    if (r.text) card.append(text("p", "", r.text));
    if (r.values.length) {
      const values = document.createElement("p");
      r.values.forEach((v, i) => values.append(i ? " · " : "", `${v.label}: `, text("b", "", v.text)));
      card.append(values);
    }
    card.append(reference([r.source_id, r.kind.toLowerCase(), r.when].filter(Boolean).join(" · ")));
    panel.append(card);
  }
}

// Redraw, then put keyboard focus back on the control that was pressed.
function rerenderKeepingFocus(focusKey) {
  renderSignals();
  $("signals-detail").querySelector(`[data-focus="${focusKey}"]`)?.focus();
}

// ---------- Forms opened from the header ----------
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
// When it happened: one tag per time window (the first three; the rest as a count, listed on hover).
const WHEN_TAGS = 3;
function whenTags(windows) {
  const row = document.createElement("div");
  row.className = "signals-facts";
  for (const w of windows.slice(0, WHEN_TAGS)) row.append(whenTag(w));
  if (windows.length > WHEN_TAGS) {
    const more = text("span", "meta-updated", `and ${windows.length - WHEN_TAGS} more`);
    more.title = windows.slice(WHEN_TAGS).map((w) => whenText(w)).join("; ");
    row.append(more);
  }
  return row;
}

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

function list(items) {
  const ul = document.createElement("ul");
  for (const item of items) ul.append(text("li", "", item));
  return ul;
}

// Source of a claim: the shared tag (signals-parts.js).
const trustChip = trustTag;

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

