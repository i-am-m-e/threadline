// evidenceView.js — the words the manager brief shows about checked evidence (goal D:
// visible reasoning). Each finding with its proof (the exact quote, or the field values
// from the flow row), a one-line summary of the checks, what was removed and why, and the
// policy's own wording. Plain code: signals-ui.js draws it.

import { fieldName } from "./records.js";

const quoted = (s) => `“${s}”`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * @param {object} pattern  Prompt 1's output (after checks).
 * @returns {Array<{source_id: string, finding: string, trust_label: string, proof: string|null}>}
 *          proof is null for runs recorded before findings carried quotes or values.
 */
export function evidenceLines(pattern) {
  return pattern.supporting_evidence.map((e) => {
    let proof = null;
    if (e.quote?.trim()) proof = quoted(e.quote.trim());
    else if (e.record_values?.length) proof = e.record_values.map((v) => `${fieldName(v.field)}: ${v.value}`).join(" · ");
    return { source_id: e.source_id, finding: e.finding, trust_label: e.trust_label, proof };
  });
}

/** One line on what was checked, from meta.verification (undefined for older runs). */
export function verificationSummary(v) {
  if (!v) return "Recorded before findings were checked against their records.";
  const a = v.analysis;
  const m = v.map;
  const w = v.wording;
  const wChanged = w ? w.replaced.length + w.removed.length : 0;
  const counts = [
    `${v.findings_verified} of ${plural(v.findings_checked, "finding")}`,
    ...(a ? [`${a.claims_verified} of ${plural(a.claims_checked, "analysis claim")}`] : []),
    ...(m ? [`${m.nodes_verified} of ${plural(m.nodes_checked, "map node")}`] : []),
    ...(w ? [`${w.checked - wChanged} of ${w.checked} other passage${w.checked === 1 ? "" : "s"}`] : []),
  ];
  const joined = counts.length > 1 ? `${counts.slice(0, -1).join(", ")} and ${counts.at(-1)}` : counts[0];
  const parts = [`Checked against their records: ${joined} verified`];
  const removed = v.findings_removed.length + (a?.claims_removed.length ?? 0) + (m?.nodes_removed.length ?? 0) + (w?.removed.length ?? 0);
  if (removed) parts.push(`${removed} removed as unverified`);
  if (w?.replaced.length) parts.push(`${w.replaced.length} passage${w.replaced.length === 1 ? "'s" : "s'"} wording replaced`);
  if (v.fixed_on_retry) parts.push(`${v.fixed_on_retry} fixed or dropped on retry`);
  const relabelled = (v.findings_labels_corrected ?? 0) + (a?.labels_corrected ?? 0) + (m?.labels_corrected ?? 0);
  if (relabelled) parts.push(`${plural(relabelled, "trust label")} corrected`);
  parts.push({ verified: "policy wording verified", removed: "policy wording couldn't be verified and was removed" }[v.policy_quote] ?? "no policy cited");
  if (v.card === "verified") parts.push("review card wording verified");
  if (v.card === "replaced") parts.push("review card wording replaced (it mentioned figures not in the records)");
  if (v.windows?.uncited.length) {
    const n = v.windows.uncited.length;
    const listed = n > 3 ? `${v.windows.uncited.slice(0, 3).join("; ")} and ${n - 3} more` : v.windows.uncited.join("; ");
    parts.push(`${n} of ${v.windows.total} time windows ${n === 1 ? "has" : "have"} no cited record (${listed})`);
  }
  if (v.rationale === "shortened") parts.push("recommendation shortened to two sentences");
  if (v.learn_more === "relabelled") parts.push('a "Learn more" option that changed something was relabelled');
  for (const s of v.safety_not_fit?.left ?? []) {
    parts.push(`${s.source_id} describes a safety-relevant condition (${s.label}) but was listed as not fitting, even after a retry`);
  }
  return parts.join("; ") + ".";
}

const TEXT_NAMES = {
  pattern_statement: "Pattern statement",
  "possible_vignette.situation": "Situation",
  "possible_vignette.what_appears_to_happen": "What appears to happen",
  "possible_vignette.observed_effects": "Observed effects",
  evidence_that_does_not_fit: "Evidence that does not fit",
  compounding_factors: "Where small variations combine",
  "policy_practice_gap.what_policy_expects": "Policy expects",
  "policy_practice_gap.what_records_suggest": "Records suggest",
};

/** What was removed as unverified, and why, one line each. */
export function removedLines(v) {
  if (!v) return [];
  const listNames = { contributing_conditions: "Contributing condition", pressure_map: "Pressure map" };
  return [
    ...v.findings_removed.map((r) => `Finding ${quoted(r.finding)} (${r.source_id}): ${r.problem.replace(`${r.source_id}: `, "")}`),
    ...(v.analysis?.claims_removed ?? []).map((r) => `${listNames[r.list] ?? r.list} ${quoted(r.text)}: ${r.problem.replace(`${r.list}: `, "").replace(`"${r.text}" `, "")}`),
    ...(v.map?.nodes_removed ?? []).map((r) => `Map node ${quoted(r.text)}: ${r.problem.replace("graph.nodes: ", "").replace(`"${r.text}" `, "")}`),
    ...(v.wording?.removed ?? []).map((r) => `${TEXT_NAMES[r.list] ?? r.list} ${quoted(r.text)}: ${r.problem.replace(`${r.list}: `, "").replace(`"${r.text}" `, "")}`),
    ...(v.wording?.replaced ?? []).map((r) => `${TEXT_NAMES[r.field] ?? r.field} (wording replaced) ${quoted(r.text)}: ${r.problem.replace(`${r.field}: `, "").replace(`"${r.text}" `, "")}`),
  ];
}

/** "Policy wording (HC-POL-CTAS-ESC): “…”", or null when there's no verified quote. */
export function policyWording(gap) {
  if (!gap.policy_source_id || !gap.policy_quote?.trim()) return null;
  return `Policy wording (${gap.policy_source_id}): ${quoted(gap.policy_quote.trim())}`;
}

/**
 * Trust labels for the policy-practice box, only where the records back them: "what the policy
 * expects" is Authoritative only when a policy is cited (otherwise Inferred, with a note), and
 * "what the records suggest" is Observed only when at least one finding was verified.
 * Runs from before the checks keep the labels they had.
 */
export function gapLabels(gap, v) {
  const expects = gap.policy_source_id ? "Authoritative" : "Inferred";
  const suggests = v && v.findings_verified === 0 ? "Inferred" : "Observed";
  const note = gap.policy_source_id ? null : "No policy was cited for this, so what the policy expects is unconfirmed.";
  return { expects, suggests, note };
}
