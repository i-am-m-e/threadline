// pipeline.js — the four Signals prompts, run in order, with a code check after each.
//
//   Prompt 1 (pattern) → Prompt 2 (analysis) → evidence selection (code) →
//   Prompt 3 (options) → Prompt 4 (review card)
//
// Each prompt goes through runStep() in llm.js (schema, source guard, name/behaviour
// scan, one retry). The checks here then enforce the spec's rules in code, rather than
// trusting the model, and log every change they make:
//   • pattern type, domain and location come from the trigger that fired
//   • pattern confidence can't exceed what the cited evidence supports
//   • graph edges must join real nodes; labels are at most 6 words
//   • options need a "Learn more" option; no evidence → "None" + "No library evidence"
//   • recommendation confidence ≤ pattern confidence, and Low when there's no evidence
//   • the card begins "Threadline noticed", stays within 80 words, and shows the real
//     record count and pattern confidence
//
// Nothing here changes a Thread's status or applies anything: it only drafts.

import { runStep } from "./llm.js";
import { buildPatternPrompt } from "./prompts/pattern.js";
import { buildAnalysisPrompt } from "./prompts/analysis.js";
import { buildOptionsPrompt } from "./prompts/options.js";
import { buildReviewCardPrompt } from "./prompts/reviewCard.js";
import { qualitativeNear, policiesFor, safetyConditionsIn, maxConfidence, lowerOf, CONFIDENCE_ORDER, SOURCE_TYPE_NAMES } from "./records.js";
import { words } from "./passages.js";

/**
 * @param {object} run
 * @param {Array}  run.windows   Triggered windows for this Thread (one, or more after updates), from findTriggeredWindows.
 * @param {Array}  run.records   All known records (flow, incidents, complaints, policies).
 * @param {object} run.rules     domain_rules.json
 * @param {Array}  run.evidenceLibrary  All items from data/evidence/
 * @param {object} run.schemas   { pattern, analysis, options, reviewCard } JSON Schemas
 * @param {object} run.config    SIGNALS_CONFIG (model, temperatures)
 * @param {Function} [run.ask]   Stand-in for the model (tests)
 * @param {(stepName: string) => void} [run.onStep]  Called as each step starts (for progress).
 * @returns {Promise<{steps, log, meta}>}
 */
export async function runPipeline({ windows, records, rules, evidenceLibrary, schemas, config, ask, onStep = () => {} }) {
  const { domain, pattern_type, location } = windows[0];
  const pack = rules[domain];
  const trigger = pack.triggers.find((t) => t.pattern_type === pattern_type);
  const log = [];
  const note = (step, detail) => log.push({ step, type: "adjusted", detail, time: new Date().toISOString() });
  const common = { model: config.model, ask };
  // Run one prompt through llm.js and keep its log (retries, removed sources…).
  const step = async (args) => {
    const result = await runStep({ ...common, ...args });
    log.push(...result.log);
    return result.output;
  };

  // What goes in: the windows' flow records, incidents/complaints within ±2h, the domain's policies.
  const flowRecords = windows.flatMap((w) => w.flowRecords);
  const nearByWindow = windows.map((w) => qualitativeNear(w, records));
  const qualitativeRecords = unique(nearByWindow.flat());
  const policies = policiesFor(domain, location, records);
  const inputRecords = [...flowRecords, ...qualitativeRecords, ...policies];
  const byId = new Map(inputRecords.map((r) => [r.source_id, r]));
  const recordIds = new Set([...flowRecords, ...qualitativeRecords].map((r) => r.source_id));
  const allIds = new Set(inputRecords.map((r) => r.source_id));

  // ---- Prompt 1: pattern and vignette ----
  onStep("pattern");
  const thresholds = {
    pattern_type,
    trigger_conditions: trigger.all.map((c) => `${c.label} (${c.metric} ${c.op} ${c.value})`),
    safety_relevant_conditions: (pack.safety_relevant_conditions ?? []).map((c) => c.label),
  };
  const pattern = await step({
    name: "pattern", schema: schemas.pattern, temperature: config.temperatures.pattern,
    prompt: buildPatternPrompt({ thresholds, flowRecords: forModel(flowRecords), qualitativeRecords: forModel(qualitativeRecords) }),
    sourceIds: recordIds,
    checks: (o) => (/^Records suggest\b/.test(o.pattern_statement.trim()) ? [] : ['pattern_statement must begin with "Records suggest".']),
  });

  // Facts the code knows better than the model.
  for (const [field, value] of [["domain", domain], ["pattern_type", pattern_type], ["location", location]]) {
    if (pattern[field] !== value) note("pattern", `${field} "${pattern[field]}" → "${value}" (from the trigger that fired)`);
    pattern[field] = value;
  }
  pattern.time_window = windows.map((w) => `${w.start.replace("T", " ")} to ${w.end.slice(11)}`).join("; ");

  // Confidence can't exceed what the cited records support (by the spec's own definition).
  const cited = new Set(pattern.supporting_evidence.map((e) => e.source_id));
  const citedByWindow = windows.map((w, i) => [...w.flowRecords, ...nearByWindow[i]].filter((r) => cited.has(r.source_id)));
  const allowed = maxConfidence(citedByWindow);
  if (CONFIDENCE_ORDER.indexOf(pattern.confidence) > CONFIDENCE_ORDER.indexOf(allowed)) {
    note("pattern", `confidence ${pattern.confidence} → ${allowed}: the cited records cover ${windows.length} time window(s)`);
    pattern.confidence_reason += ` [Adjusted to ${allowed} by Threadline: the cited records cover ${windows.length} time window(s) and ${new Set(citedByWindow.flat().map((r) => r.source_type)).size} source type(s).]`;
    pattern.confidence = allowed;
  }

  // ---- Prompt 2: system analysis ----
  onStep("analysis");
  const analysis = await step({
    name: "analysis", schema: schemas.analysis, temperature: config.temperatures.analysis,
    prompt: buildAnalysisPrompt({ policies: forModel(policies), vignette: pattern }),
    sourceIds: allIds,
    checks: (o) => [
      ...(o.alternative_explanations.length ? [] : ["Give at least one alternative explanation."]),
      ...(o.open_questions.length ? [] : ["Give at least one open question for reviewers."]),
      ...(new Set(o.graph.nodes.map((n) => n.id)).size === o.graph.nodes.length ? [] : ["Graph node ids must be unique."]),
    ],
  });
  tidyGraph(analysis.graph, (detail) => note("analysis", detail));

  // ---- Evidence selection (code, not a prompt) ----
  onStep("evidence");
  const evidence = selectEvidence(evidenceLibrary, domain, analysis);
  if (evidence.length === 0) note("evidence", "No library evidence matched this Thread's contributing conditions.");

  // ---- Prompt 3: options and recommendation ----
  onStep("options");
  const options = await step({
    name: "options", schema: schemas.options, temperature: config.temperatures.options,
    prompt: buildOptionsPrompt({ patternConfidence: pattern.confidence, analysis, evidence: evidence.map(forEvidencePrompt) }),
    evidenceIds: new Set(evidence.map((e) => e.evidence_id)),
    sourceIds: allIds,
    checks: (o) => [
      ...(o.options.some((x) => x.type === "Learn more") ? [] : [
        'Include at least one option whose "type" is exactly "Learn more": for example, track this pattern for two weeks, ' +
        "or bring it to an existing huddle, before changing anything. Keep your other options.",
      ]),
      ...o.options.filter((x) => !x.possible_pressure_transfer.trim()).map((x) => `Option ${x.option_id} needs a possible_pressure_transfer.`),
      ...(o.options.some((x) => x.option_id === o.recommendation.leading_option_id) ? [] : ["leading_option_id must be one of the option_ids."]),
      ...individualMonitoringProblems(o),
    ],
  });
  enforceEvidenceRules(options, evidence, pattern.confidence, (detail) => note("options", detail));

  // The badge shown to people comes from the records the analysis cites, not the model's wording.
  const citedRecords = unique([...cited, ...analysis.contributing_conditions.flatMap((c) => c.source_ids)])
    .map((id) => byId.get(id)).filter((r) => r && r.source_type !== "policy");
  const badge = `Based on ${citedRecords.length} records: ${unique(citedRecords.map((r) => SOURCE_TYPE_NAMES[r.source_type] ?? r.source_type)).join(", ")}`;

  // ---- Prompt 4: front-line review card ----
  onStep("reviewCard");
  const card = await step({
    name: "reviewCard", schema: schemas.reviewCard, temperature: config.temperatures.reviewCard,
    prompt: buildReviewCardPrompt({ vignette: pattern, analysis, options }),
    checks: (o) => [
      ...(/^Threadline noticed\b/.test(o.noticed.trim()) ? [] : ['"noticed" must begin with "Threadline noticed".']),
      ...(cardWordCount({ ...o, evidence_badge: badge }) <= 80 ? [] : [`The card has ${cardWordCount({ ...o, evidence_badge: badge })} words; the limit is 80 across all text fields. Shorten it.`]),
    ],
  });

  if (card.evidence_badge !== badge) note("reviewCard", `evidence_badge "${card.evidence_badge}" → "${badge}"`);
  card.evidence_badge = badge;
  if (card.confidence !== pattern.confidence) note("reviewCard", `confidence ${card.confidence} → ${pattern.confidence} (the pattern's confidence)`);
  card.confidence = pattern.confidence;

  return {
    steps: { pattern, analysis, evidence, options, card },
    log,
    meta: {
      domain, pattern_type, location,
      windows: windows.map((w) => ({ start: w.start, end: w.end })),
      source_ids: [...allIds],
      safety_conditions: safetyConditionsIn([...flowRecords, ...qualitativeRecords], pack),
      placeholder_evidence: evidence.some((e) => e.synthetic_placeholder) &&
        options.options.some((o) => o.evidence_ids.some((id) => evidence.find((e) => e.evidence_id === id)?.synthetic_placeholder)),
    },
  };
}

// ---------- Helpers for the steps ----------

// Records as the model sees them (without the app's bookkeeping fields).
const forModel = (records) => records.map(({ file, synthetic, ...rest }) => rest);
const forEvidencePrompt = ({ evidence_id, title, source_type, strength, summary, applies_when }) =>
  ({ evidence_id, title, source_type, strength, summary, applies_when });
const unique = (list) => [...new Set(list)];

/** Remove edges that point at missing nodes; shorten labels longer than 6 words. */
function tidyGraph(graph, note) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const before = graph.edges.length;
  graph.edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  if (graph.edges.length < before) note(`removed ${before - graph.edges.length} graph edge(s) pointing at missing nodes`);
  for (const n of graph.nodes) {
    const w = n.label.trim().split(/\s+/);
    if (w.length > 6) {
      note(`node "${n.id}" label shortened to 6 words`);
      n.label = w.slice(0, 6).join(" ");
    }
  }
}

/**
 * Pick evidence items for this Thread: same domain, and an applies_when phrase that
 * shares at least 2 meaningful words with what the analysis found (its contributing
 * conditions, compounding factors and policy gap). Best matches first, at most 4.
 */
export function selectEvidence(library, domain, analysis) {
  const found = new Set(words([
    ...analysis.contributing_conditions.map((c) => c.condition),
    ...analysis.compounding_factors,
    analysis.policy_practice_gap.what_records_suggest,
    analysis.policy_practice_gap.what_policy_expects,
  ].join(" ")));
  return library
    .filter((e) => e.domain === domain)
    .map((e) => ({ e, score: Math.max(0, ...e.applies_when.map((phrase) => words(phrase).filter((w) => found.has(w)).length)) }))
    .filter((x) => x.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.e);
}

// Rule 6 of Prompt 3: never propose monitoring, scoring or disciplining individuals.
function individualMonitoringProblems(o) {
  const text = JSON.stringify(o);
  const m = text.match(/\b(monitor|track|score|rank|audit|disciplin)\w*\s+(individual|each|every|specific)\s+(staff|nurses?|physicians?|workers?|operators?|inspectors?|contractors?|employees?|members?)\b/i);
  return m ? [`Don't propose monitoring, scoring or disciplining individuals ("${m[0]}"). Focus on system conditions and roles.`] : [];
}

/** Evidence and confidence rules for Prompt 3's output (changes `options`). */
function enforceEvidenceRules(options, evidence, patternConfidence, note) {
  for (const o of options.options) {
    if (o.evidence_ids.length === 0) {
      if (o.evidence_strength !== "None") note(`${o.option_id}: evidence_strength ${o.evidence_strength} → None (no library evidence cited)`);
      o.evidence_strength = "None";
      if (!/No library evidence/i.test(o.local_fit)) {
        note(`${o.option_id}: local_fit now states "No library evidence"`);
        o.local_fit = `No library evidence. ${o.local_fit}`.trim();
      }
    }
    o.trust_label = "Suggested";
  }
  const rec = options.recommendation;
  rec.trust_label = "Suggested";
  if (evidence.length === 0 && rec.confidence !== "Low") {
    note(`recommendation confidence ${rec.confidence} → Low (no library evidence)`);
    rec.confidence = "Low";
  }
  const capped = lowerOf(rec.confidence, patternConfidence);
  if (capped !== rec.confidence) {
    note(`recommendation confidence ${rec.confidence} → ${capped} (cannot exceed pattern confidence)`);
    rec.confidence = capped;
  }
}

/** Words across all of the card's text fields. */
export function cardWordCount(card) {
  const text = [card.card_title, card.noticed, card.why_it_may_matter, ...card.possible_options, card.evidence_badge, card.confidence, card.question].join(" ");
  return text.split(/\s+/).filter(Boolean).length;
}
