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
//   • every supporting finding is checked against the record it cites (a quote from its
//     text, or its field values, and the numbers in the finding's wording), and the
//     policy-practice gap's quote against the policy (src/verify.js). What still can't be
//     verified after the retry is removed and logged; a tally goes in meta.verification.
//
// Nothing here changes a Thread's status or applies anything: it only drafts.

import { runStep } from "./llm.js";
import { buildPatternPrompt } from "./prompts/pattern.js";
import { buildAnalysisPrompt } from "./prompts/analysis.js";
import { buildOptionsPrompt } from "./prompts/options.js";
import { buildReviewCardPrompt } from "./prompts/reviewCard.js";
import { qualitativeNear, policiesFor, safetyConditionsIn, maxConfidence, lowerOf, CONFIDENCE_ORDER, SOURCE_TYPE_NAMES, isPolicy } from "./records.js";
import { words } from "./passages.js";
import { windowLabel } from "./recurrence.js";
import { evidenceProblems, policyQuoteProblem, thresholdsOf, claimNumberProblems, fittingTrustLabel } from "./verify.js";

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

  // Checking findings against their records (src/verify.js). The tally ends up in meta.
  const thresholds = thresholdsOf(pack);
  const verification = {
    findings_checked: 0, findings_verified: 0, findings_removed: [], fixed_on_retry: 0, findings_labels_corrected: 0, policy_quote: "none cited",
    analysis: { claims_checked: 0, claims_verified: 0, claims_removed: [], labels_corrected: 0 },
    map: { nodes_checked: 0, nodes_verified: 0, nodes_removed: [], labels_corrected: 0 },
    card: "not checked",
    wording: { checked: 0, replaced: [], removed: [] },
    windows: { total: windows.length, cited: 0, uncited: [] },
    rationale: "ok",
  };

  // Update runs under-used new evidence (2026-09-28 results): every time window must have at
  // least one cited record. After the retry, an uncited window is accepted and noted (confidence
  // already counts only cited records, so it isn't inflated).
  const windowRecords = windows.map((w, i) => [...w.flowRecords, ...nearByWindow[i]]);
  const verifyWindows = (o) => {
    const cited = new Set(o.supporting_evidence.map((e) => e.source_id));
    return windows.flatMap((w, i) => {
      if (windowRecords[i].some((r) => cited.has(r.source_id))) return [];
      const label = windowLabel(w);
      const examples = w.flowRecords.slice(0, 2).map((r) => r.source_id).join(", ");
      return [{
        problem: `The time window ${label} has no cited record. Cite at least one record from each time window (for example ${examples}), with its quote or values.`,
        remove: () => `${label}: still no cited record after the retry (accepted; confidence counts only cited records)`,
      }];
    });
  };

  // Prompt 3 rule 4: the recommendation's rationale is two sentences or fewer. After the retry,
  // code keeps the first two.
  const sentencesOf = (text) => text.trim().split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
  const verifyRationale = (o) => {
    const sentences = sentencesOf(o.recommendation.rationale);
    if (sentences.length <= 2) return [];
    return [{
      problem: `recommendation.rationale has ${sentences.length} sentences; rule 4 allows two or fewer. Shorten it.`,
      remove: () => {
        o.recommendation.rationale = sentences.slice(0, 2).join(" ");
        verification.rationale = "shortened";
        return `rationale: still ${sentences.length} sentences after the retry; shortened to the first 2`;
      },
    }];
  };
  // The rest of the text that describes the records (pattern statement, vignette, "evidence that
  // does not fit", compounding factors, the policy gap's wording): numbers must be in the records
  // given to that step. After the retry, a field is replaced by a plain line, a list item removed.
  // (Options, other explanations and open questions are proposals and questions, not claims.)
  const wording = verification.wording;
  const PLAIN = "The drafted wording mentioned figures that aren't in the records, so the wording was removed.";
  const fieldIssues = (field, holder, key, records, fallback) => {
    const problems = claimNumberProblems(holder[key] ?? "", records, thresholds, { where: "this Thread's records" });
    if (problems.length === 0) return [];
    const problem = `${field}: ${problems.join(" ")}`;
    return [{
      problem,
      remove: () => {
        wording.replaced.push({ field, text: holder[key], problem });
        holder[key] = typeof fallback === "function" ? fallback() : fallback;
        return `${field}: unverified, replaced with a plain line`;
      },
    }];
  };
  const itemIssues = (list, holder, records) => holder[list].flatMap((text) => {
    const problems = claimNumberProblems(text, records, thresholds, { where: "this Thread's records" });
    if (problems.length === 0) return [];
    const problem = `${list}: ${problems.join(" ")}`;
    return [{
      problem,
      remove: () => {
        holder[list].splice(holder[list].indexOf(text), 1);
        wording.removed.push({ list, text, problem });
        return `${list}: "${text}": unverified, removed`;
      },
    }];
  });
  const patternInputs = [...flowRecords, ...qualitativeRecords];
  const VIGNETTE_PARTS = ["situation", "what_appears_to_happen", "observed_effects"];
  const GAP_LINES = ["what_policy_expects", "what_records_suggest"];

  // The analysis claims checked against their records: contributing conditions and the pressure map.
  const CLAIM_LISTS = [["contributing_conditions", (c) => [c.condition]], ["pressure_map", (p) => [p.pressure_carried, p.shifting_to]]];
  const citedBy = (claim) => claim.source_ids.map((id) => byId.get(id)).filter(Boolean);
  const failingPerAnswer = []; // how many findings failed on each answer checked
  const verifyFindings = (o) => {
    failingPerAnswer.push(0);
    return o.supporting_evidence.flatMap((e) => {
      const record = byId.get(e.source_id);
      const problems = record ? evidenceProblems(e, record, thresholds) : [];
      if (problems.length === 0) return [];
      failingPerAnswer[failingPerAnswer.length - 1] += 1;
      const problem = problems.join(" ");
      return [{
        problem,
        remove: () => {
          o.supporting_evidence.splice(o.supporting_evidence.indexOf(e), 1);
          verification.findings_removed.push({ source_id: e.source_id, finding: e.finding, problem });
          return `${e.source_id}: unverified, removed`;
        },
      }];
    });
  };

  // ---- Prompt 1: pattern and vignette ----
  onStep("pattern");
  const promptThresholds = {
    pattern_type,
    trigger_conditions: trigger.all.map((c) => `${c.label} (${c.metric} ${c.op} ${c.value})`),
    safety_relevant_conditions: (pack.safety_relevant_conditions ?? []).map((c) => c.label),
  };
  const pattern = await step({
    name: "pattern", schema: schemas.pattern, temperature: config.temperatures.pattern,
    prompt: buildPatternPrompt({ thresholds: promptThresholds, flowRecords: forModel(flowRecords), qualitativeRecords: forModel(qualitativeRecords) }),
    sourceIds: recordIds,
    checks: (o) => (/^Records suggest\b/.test(o.pattern_statement.trim()) ? [] : ['pattern_statement must begin with "Records suggest".']),
    verify: (o) => [
      ...verifyFindings(o),
      ...verifyWindows(o),
      ...fieldIssues("pattern_statement", o, "pattern_statement", patternInputs, `Records suggest a possible pattern: ${pattern_type} at ${location}.`),
      ...VIGNETTE_PARTS.flatMap((key) =>
        fieldIssues(`possible_vignette.${key}`, o.possible_vignette, key, patternInputs, PLAIN)),
      ...itemIssues("evidence_that_does_not_fit", o, patternInputs),
    ],
  });
  verification.findings_verified = pattern.supporting_evidence.length;
  {
    const cited = new Set(pattern.supporting_evidence.map((e) => e.source_id)); // after removals
    const uncited = windows.filter((w, i) => !windowRecords[i].some((r) => cited.has(r.source_id)));
    verification.windows = { total: windows.length, cited: windows.length - uncited.length, uncited: uncited.map(windowLabel) };
  }
  verification.findings_checked = verification.findings_verified + verification.findings_removed.length;
  // Findings that failed on the answer before the last and didn't need removing from the last
  // one: the model fixed them or dropped them (it can't tell which).
  verification.fixed_on_retry = failingPerAnswer.length >= 2
    ? Math.max(0, failingPerAnswer.at(-2) - verification.findings_removed.length) : 0;
  // Each finding's trust label must fit the record it cites (corrected in code, logged).
  for (const e of pattern.supporting_evidence) {
    const fit = fittingTrustLabel(e.trust_label, [byId.get(e.source_id)].filter(Boolean));
    if (fit === e.trust_label) continue;
    note("pattern", `supporting_evidence ${e.source_id}: trust_label "${e.trust_label}" → "${fit}" (from the record it cites)`);
    e.trust_label = fit;
    verification.findings_labels_corrected += 1;
  }

  // Facts the code knows better than the model.
  for (const [field, value] of [["domain", domain], ["pattern_type", pattern_type], ["location", location]]) {
    if (pattern[field] !== value) note("pattern", `${field} "${pattern[field]}" → "${value}" (from the trigger that fired)`);
    pattern[field] = value;
  }
  pattern.time_window = windows.map(windowLabel).join("; ");

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
    verify: (o) => {
      // Numbers in each claim must be in the records it cites (any input record if it cites none).
      const claimIssues = CLAIM_LISTS.flatMap(([list, textsOf]) => o[list].flatMap((claim) => {
        const records = claim.source_ids.length ? citedBy(claim) : inputRecords;
        const problems = textsOf(claim).filter(Boolean).flatMap((t) => claimNumberProblems(t, records, thresholds));
        if (problems.length === 0) return [];
        const problem = `${list}: ${problems.join(" ")}`;
        return [{
          problem,
          remove: () => {
            o[list].splice(o[list].indexOf(claim), 1);
            verification.analysis.claims_removed.push({ list, text: textsOf(claim)[0], problem });
            return `${list}: "${textsOf(claim)[0]}": unverified, removed`;
          },
        }];
      }));
      // The Thread map's nodes: numbers in a label must be in the node's records too.
      const nodeIssues = o.graph.nodes.flatMap((node) => {
        const records = node.source_ids.length ? citedBy(node) : inputRecords;
        const problems = claimNumberProblems(node.label, records, thresholds);
        if (problems.length === 0) return [];
        const problem = `graph.nodes: ${problems.join(" ")}`;
        return [{
          problem,
          remove: () => {
            o.graph.nodes.splice(o.graph.nodes.indexOf(node), 1); // its lines go in tidyGraph below
            verification.map.nodes_removed.push({ id: node.id, text: node.label, problem });
            return `graph.nodes: "${node.label}": unverified, removed`;
          },
        }];
      });
      const gap = o.policy_practice_gap;
      const policy = gap.policy_source_id && byId.get(gap.policy_source_id);
      // The gap's own wording: "policy expects" against the cited policy, "records suggest"
      // against the step's records. A replaced "policy expects" uses the policy's own words.
      const policyQuoted = () => (gap.policy_quote?.trim() ? `\u201c${gap.policy_quote.trim()}\u201d (quoted from the policy)` : PLAIN);
      const textIssues = [
        ...itemIssues("compounding_factors", o, inputRecords),
        ...GAP_LINES.flatMap((key) => fieldIssues(`policy_practice_gap.${key}`, gap, key,
          key === "what_policy_expects" && policy ? [policy] : inputRecords,
          key === "what_policy_expects" ? policyQuoted : PLAIN)),
      ];
      const kind = policy && !isPolicy(policy) ? (SOURCE_TYPE_NAMES[policy.source_type] ?? policy.source_type) : null;
      const policyIds = inputRecords.filter(isPolicy).map((r) => r.source_id);
      const problem = kind
        ? `policy_practice_gap.policy_source_id: ${policy.source_id} is ${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}, not a policy. ` +
          (policyIds.length ? `Cite one of: ${policyIds.join(", ")}.` : 'No policy was given: leave policy_source_id and policy_quote empty.')
        : policy && policyQuoteProblem(gap, policy);
      const quoteIssues = problem ? [{
        problem,
        remove: () => {
          const id = gap.policy_source_id;
          gap.policy_source_id = "";
          gap.policy_quote = "";
          verification.policy_quote = "removed";
          return `policy_practice_gap: ${id}: unverified, removed (policy id and quote blanked)`;
        },
      }] : [];
      // The quote's removal comes before the text's, so a replaced "policy expects" can never
      // borrow an unverified quote.
      return [...claimIssues, ...nodeIssues, ...quoteIssues, ...textIssues];
    },
    checks: (o) => [
      ...(o.alternative_explanations.length ? [] : ["Give at least one alternative explanation."]),
      ...(o.open_questions.length ? [] : ["Give at least one open question for reviewers."]),
      ...(new Set(o.graph.nodes.map((n) => n.id)).size === o.graph.nodes.length ? [] : ["Graph node ids must be unique."]),
    ],
  });
  tidyGraph(analysis.graph, (detail) => note("analysis", detail));
  if (analysis.graph.nodes.length < 6) note("analysis", `the map has ${analysis.graph.nodes.length} nodes after removals (usually 6 to 12); nothing was added to make up the number`);
  // Each claim's trust label must fit what it cites (corrected in code, no retry needed).
  for (const [list, textsOf] of CLAIM_LISTS) {
    for (const claim of analysis[list]) {
      const fit = fittingTrustLabel(claim.trust_label, citedBy(claim));
      if (fit === claim.trust_label) continue;
      note("analysis", `${list}: "${textsOf(claim)[0]}": trust_label "${claim.trust_label}" → "${fit}" (from the records it cites)`);
      claim.trust_label = fit;
      verification.analysis.labels_corrected += 1;
    }
  }
  for (const node of analysis.graph.nodes) {
    const fit = fittingTrustLabel(node.trust_label, citedBy(node));
    if (fit === node.trust_label) continue;
    note("analysis", `graph.nodes: "${node.label}": trust_label "${node.trust_label}" → "${fit}" (from the records it cites)`);
    node.trust_label = fit;
    verification.map.labels_corrected += 1;
  }
  // Single fields checked: the pattern statement, the vignette's parts, and the gap's two lines.
  wording.checked = 1 + VIGNETTE_PARTS.length + GAP_LINES.length +
    pattern.evidence_that_does_not_fit.length + analysis.compounding_factors.length + wording.removed.length;
  verification.map.nodes_verified = analysis.graph.nodes.length;
  verification.map.nodes_checked = verification.map.nodes_verified + verification.map.nodes_removed.length;
  verification.analysis.claims_verified = CLAIM_LISTS.reduce((n, [list]) => n + analysis[list].length, 0);
  verification.analysis.claims_checked = verification.analysis.claims_verified + verification.analysis.claims_removed.length;
  if (verification.policy_quote !== "removed" && analysis.policy_practice_gap.policy_source_id) verification.policy_quote = "verified";

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
    verify: verifyRationale,
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
  const sourceTypes = unique(citedRecords.map((r) => SOURCE_TYPE_NAMES[r.source_type] ?? r.source_type)).join(", ");
  const badge = `Based on ${citedRecords.length} records${sourceTypes ? `: ${sourceTypes}` : ""}`;

  // ---- Prompt 4: front-line review card ----
  // Numbers in the card's wording must be in the records this run cites (after the checks
  // above), or be domain thresholds. If they still aren't after the retry, that wording is
  // replaced with a plain line written by code (from the trigger), and logged.
  const runCited = unique([
    ...pattern.supporting_evidence.map((e) => e.source_id),
    ...CLAIM_LISTS.flatMap(([list]) => analysis[list].flatMap((c) => c.source_ids)),
    ...analysis.graph.nodes.flatMap((n) => n.source_ids),
    analysis.policy_practice_gap.policy_source_id,
  ]).map((id) => byId.get(id)).filter(Boolean);
  const cardRecords = runCited.length ? runCited : inputRecords;
  const CARD_FALLBACK = {
    card_title: `Possible pattern: ${pattern_type}`,
    noticed: `Threadline noticed a possible pattern: ${pattern_type} at ${location}.`,
    why_it_may_matter: "Wording removed: it mentioned figures not in the records.",
  };
  // The card is asked to say how many records and source types support the pattern, and it may
  // say how many time windows: those counts are allowed alongside the thresholds.
  const cardCounts = [...thresholds, citedRecords.length, unique(citedRecords.map((r) => r.source_type)).length, windows.length];
  verification.card = "verified";
  const verifyCard = (o) => Object.keys(CARD_FALLBACK).flatMap((field) => {
    const problems = claimNumberProblems(o[field], cardRecords, cardCounts);
    if (problems.length === 0) return [];
    return [{
      problem: `card.${field}: ${problems.join(" ")}`,
      remove: () => {
        o[field] = CARD_FALLBACK[field];
        verification.card = "replaced";
        return `card.${field}: unverified, replaced with a plain line`;
      },
    }];
  });
  onStep("reviewCard");
  const card = await step({
    name: "reviewCard", schema: schemas.reviewCard, temperature: config.temperatures.reviewCard,
    prompt: buildReviewCardPrompt({ vignette: pattern, analysis, options }),
    verify: verifyCard,
    checks: (o) => [
      ...(/^Threadline noticed\b/.test(o.noticed.trim()) ? [] : ['"noticed" must begin with "Threadline noticed".']),
      ...(cardWordCount({ ...o, evidence_badge: badge }) <= 80 ? [] : [`The card has ${cardWordCount({ ...o, evidence_badge: badge })} words; the limit is 80 across all text fields. Shorten it.`]),
    ],
  });

  if (card.evidence_badge !== badge) note("reviewCard", `evidence_badge "${card.evidence_badge}" → "${badge}"`);
  card.evidence_badge = badge;
  if (card.confidence !== pattern.confidence) note("reviewCard", `confidence ${card.confidence} → ${pattern.confidence} (the pattern's confidence)`);
  card.confidence = pattern.confidence;
  // A replaced line can make the card longer: say so rather than hide it.
  if (verification.card === "replaced" && cardWordCount(card) > 80) {
    note("reviewCard", `the card is ${cardWordCount(card)} words after the replacement (limit 80)`);
  }

  return {
    steps: { pattern, analysis, evidence, options, card },
    log,
    meta: {
      domain, pattern_type, location,
      windows: windows.map((w) => ({ start: w.start, end: w.end })),
      source_ids: [...allIds],
      verification,
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
