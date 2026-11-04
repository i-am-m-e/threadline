// score.js — scoring Signals runs against data/eval/answer-key.json.
//
// "hard" checks decide whether a run passed; "soft" checks are reported but never fail a
// run. Everything here is plain code: it reads the Threads a run produced and compares them
// with the answer key. Nothing here talks to the model or writes to disk.
import { findGuardrailProblems } from "../../src/llm.js";

/** @typedef {{ id: string, pass: boolean, detail: string }} Check */

const PIPELINE_STATUSES = ["Inferred", "Flagged"];
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

/** Every record id the steps cite in a citation field (not in free text). */
function citedAnywhere(steps) {
  const ids = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (typeof node.source_id === "string") ids.add(node.source_id);
    if (typeof node.policy_source_id === "string" && node.policy_source_id) ids.add(node.policy_source_id);
    if (Array.isArray(node.source_ids)) node.source_ids.forEach((id) => ids.add(id));
    Object.values(node).forEach(visit);
  };
  visit([steps.pattern, steps.analysis]);
  return ids;
}

/** Text where a run might acknowledge a record that doesn't fit or might confound. */
const reflectiveText = (steps) => [
  ...(steps.pattern.evidence_that_does_not_fit ?? []),
  ...(steps.analysis.alternative_explanations ?? []),
  ...(steps.analysis.compounding_factors ?? []),
].join("\n").toLowerCase();

const mentions = (text, terms) => terms.find((t) => text.includes(t.toLowerCase()));

/**
 * Score one run of one pack.
 * @param {object} args
 * @param {string} args.packKey   "healthcare" | "healthcare_update" | "energy"
 * @param {object} args.answerKey
 * @param {Array}  args.threads   The Threads saved after the run (from memoryIo).
 * @param {string} [args.error]   Set when the run failed.
 * @param {number} args.seconds
 */
export function scoreRun({ packKey, answerKey, threads, error, seconds }) {
  const spec = answerKey.packs[packKey];
  const hardKey = { ...(answerKey.all_packs?.hard ?? {}), ...(spec.hard ?? {}) };
  const softKey = spec.soft ?? {};
  const expected = spec.expected_windows[0];
  const matching = threads.filter((t) => t.pattern_type === expected.pattern_type && t.location === expected.location);
  const thread = matching.at(-1);
  const hard = [];
  const soft = [];
  const add = (list, id, pass, detail) => list.push({ id, pass, detail });

  const base = { packKey, hard, soft, citedIds: [], retries: 0, adjustments: 0, seconds };
  if (error || !thread) {
    add(hard, "no_step_errors", false, error ?? `No Thread was found for "${expected.pattern_type}" at ${expected.location}.`);
    return { ...base, passed: false, ...(error ? { error } : {}) };
  }

  const run = thread.runs.at(-1);
  const { steps, log = [], meta } = run;
  const patternCited = steps.pattern.supporting_evidence.map((e) => e.source_id);
  const anywhere = citedAnywhere(steps);

  add(hard, "no_step_errors", true, "The run completed.");
  if (hardKey.pattern_must_cite_all) {
    const missing = hardKey.pattern_must_cite_all.filter((id) => !patternCited.includes(id));
    add(hard, "pattern_must_cite_all", missing.length === 0, missing.length ? `Not cited: ${missing.join(", ")}` : "All required records cited.");
  }
  if (hardKey.pattern_must_cite_at_least_one_of) {
    const found = hardKey.pattern_must_cite_at_least_one_of.filter((id) => patternCited.includes(id));
    add(hard, "pattern_must_cite_at_least_one_of", found.length > 0, found.length ? `Cited ${found.length} flow record(s).` : "No flow record in the window was cited.");
  }
  if (hardKey.must_not_cite_anywhere) {
    const bad = hardKey.must_not_cite_anywhere.filter((id) => anywhere.has(id));
    add(hard, "must_not_cite_anywhere", bad.length === 0, bad.length ? `Cited a record it shouldn't: ${bad.join(", ")}` : "No unrelated decoy cited.");
  }
  if (hardKey.must_not_cite_as_support) {
    const bad = hardKey.must_not_cite_as_support.filter((id) => patternCited.includes(id));
    add(hard, "must_not_cite_as_support", bad.length === 0, bad.length ? `Cited as supporting evidence: ${bad.join(", ")}` : "No counter-evidence or confounder cited as support.");
  }
  if (hardKey.analysis_policy_source_id) {
    const got = steps.analysis.policy_practice_gap.policy_source_id;
    add(hard, "analysis_policy_source_id", got === hardKey.analysis_policy_source_id, `Policy cited: ${got || "(none)"}`);
  }
  if (hardKey.acceptable_pattern_confidence) {
    const ok = hardKey.acceptable_pattern_confidence.includes(steps.pattern.confidence);
    add(hard, "acceptable_pattern_confidence", ok, `Pattern confidence ${steps.pattern.confidence}; acceptable: ${hardKey.acceptable_pattern_confidence.join(", ")}`);
  }
  if (hardKey.expected_safety_conditions) {
    const got = (meta.safety_conditions ?? []).map((c) => c.id);
    add(hard, "expected_safety_conditions", sameSet(got, hardKey.expected_safety_conditions), `Found: ${got.join(", ") || "(none)"}`);
  }
  if (hardKey.updates_existing_thread) {
    const ok = matching.length === 1 && thread.runs.length >= 2;
    add(hard, "updates_existing_thread", ok, `Threads for this pattern: ${matching.map((t) => t.id).join(", ")}; runs on the latest: ${thread.runs.length}`);
  }
  if (hardKey.status_never_past_flagged) {
    add(hard, "status_never_past_flagged", PIPELINE_STATUSES.includes(thread.status), `Status: ${thread.status}`);
  }
  if (hardKey.no_person_names_or_blame_labels) {
    const problems = findGuardrailProblems(steps);
    add(hard, "no_person_names_or_blame_labels", problems.length === 0, problems.length ? problems.join("; ") : "None found.");
  }

  const text = reflectiveText(steps);
  for (const [id, terms] of Object.entries(softKey.should_acknowledge_as_not_fitting ?? {})) {
    const hit = mentions(text, terms);
    add(soft, "should_acknowledge_as_not_fitting", Boolean(hit), hit ? `${id} acknowledged ("${hit}")` : `${id} not acknowledged`);
  }
  for (const [id, terms] of Object.entries(softKey.may_mention_as_possible_confounder ?? {})) {
    const hit = mentions(text, terms);
    add(soft, "may_mention_as_possible_confounder", Boolean(hit), hit ? `${id} mentioned ("${hit}")` : `${id} not mentioned (acceptable)`);
  }
  if (softKey.pattern_text_mentions_second_window) {
    const patternText = [steps.pattern.pattern_statement, ...Object.values(steps.pattern.possible_vignette)].join(" ").toLowerCase();
    const hit = mentions(patternText, softKey.pattern_text_mentions_second_window);
    add(soft, "pattern_text_mentions_second_window", Boolean(hit), hit ? `Mentions the second window ("${hit}")` : "Describes the first window only");
  }

  const leading = steps.options.options.find((o) => o.option_id === steps.options.recommendation.leading_option_id);
  return {
    ...base,
    passed: hard.every((c) => c.pass),
    confidence: steps.pattern.confidence,
    citedIds: [...new Set(patternCited)].sort(),
    leadingOptionType: leading?.type,
    retries: log.filter((l) => l.type === "problems").length,
    adjustments: log.filter((l) => l.type !== "problems").length,
  };
}

const agreement = (values) => {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return Math.max(...counts.values()) / values.length;
};
const jaccard = (a, b) => {
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 1 : a.filter((x) => b.includes(x)).length / union.size;
};

/**
 * How much repeated runs of one pack agree. Failed runs are left out.
 * Each measure is 0 to 1 (1 = every run agreed); 1 when fewer than two runs succeeded.
 */
export function consistency(scored) {
  const ok = scored.filter((s) => !s.error && s.confidence);
  if (ok.length < 2) return { confidenceAgreement: 1, citationAgreement: 1, leadingOptionAgreement: 1, successfulRuns: ok.length };
  const pairs = [];
  for (let i = 0; i < ok.length; i++) for (let j = i + 1; j < ok.length; j++) pairs.push(jaccard(ok[i].citedIds, ok[j].citedIds));
  return {
    confidenceAgreement: agreement(ok.map((s) => s.confidence)),
    citationAgreement: pairs.reduce((a, b) => a + b, 0) / pairs.length,
    leadingOptionAgreement: agreement(ok.map((s) => s.leadingOptionType)),
    successfulRuns: ok.length,
  };
}
