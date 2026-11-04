// report.js — turns an evaluation summary into scorecard.md (plain language, Markdown).

const pct = (x) => `${Math.round(x * 100)}%`;
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const STAGE_NAMES = {
  healthcare: "Healthcare pack (benchmark + decoys)",
  healthcare_update: "Healthcare update (second flow file, same Thread)",
  energy: "Energy pack (benchmark + decoys)",
};

/** Share of runs where a check passed, among runs that have that check. */
function checkRate(scored, list, id) {
  const found = scored.map((s) => s[list].filter((c) => c.id === id)).filter((cs) => cs.length > 0);
  if (found.length === 0) return null;
  return avg(found.map((cs) => (cs.every((c) => c.pass) ? 1 : 0)));
}

/**
 * @param {object} summary  From runEvaluation(): { date, model, temperatures, runs, gitCommit,
 *                          answerKeyStatus, stages: { [stage]: { scored, consistency } } }
 * @returns {string}
 */
export function renderScorecard(summary) {
  const lines = [
    `# Threadline Signals scorecard: ${summary.date}`,
    "",
    `- Model: ${summary.model}`,
    `- Temperatures: ${Object.entries(summary.temperatures).map(([k, v]) => `${k} ${v}`).join(", ")}`,
    `- Runs per pack: ${summary.runs}`,
    `- Code version (git commit): ${summary.gitCommit}`,
    `- Answer key: ${summary.answerKeyStatus}`,
    "",
    "All data is synthetic. \"Hard\" checks decide whether a run passed; \"soft\" checks are reported only.",
  ];

  for (const [stage, { scored, consistency }] of Object.entries(summary.stages)) {
    const ok = scored.filter((s) => !s.error);
    const rate = (list, id) => {
      const r = checkRate(scored, list, id);
      return r === null ? "n/a" : pct(r);
    };
    const decoyCitations = scored.filter((s) => s.hard.some((c) => c.id === "must_not_cite_anywhere" && !c.pass)).length;
    const seconds = scored.map((s) => s.seconds);
    lines.push(
      "",
      `## ${STAGE_NAMES[stage] ?? stage}`,
      "",
      "| Measure | Result |",
      "| --- | --- |",
      `| Hard pass rate | ${pct(avg(scored.map((s) => (s.passed ? 1 : 0))))} (${scored.filter((s) => s.passed).length} of ${scored.length} runs) |`,
      `| Required citations found | ${rate("hard", "pattern_must_cite_all")} |`,
      `| Runs citing an unrelated decoy | ${checkRate(scored, "hard", "must_not_cite_anywhere") === null ? "n/a" : `${decoyCitations} (target 0)`} |`,
      `| Counter-evidence or confounder cited as support | ${checkRate(scored, "hard", "must_not_cite_as_support") === null ? "n/a" : scored.filter((s) => s.hard.some((c) => c.id === "must_not_cite_as_support" && !c.pass)).length + " (target 0)"} |`,
      `| Counter-evidence acknowledged (soft) | ${rate("soft", "should_acknowledge_as_not_fitting")} |`,
      `| Possible confounder mentioned (soft, informational) | ${rate("soft", "may_mention_as_possible_confounder")} |`,
      `| Confidence agreement | ${pct(consistency.confidenceAgreement)} (${consistency.successfulRuns} successful run${consistency.successfulRuns === 1 ? "" : "s"}) |`,
      `| Citation agreement | ${pct(consistency.citationAgreement)} |`,
      `| Leading option agreement | ${pct(consistency.leadingOptionAgreement)} |`,
      `| Retries per run | ${avg(ok.map((s) => s.retries)).toFixed(1)} |`,
      `| Code adjustments per run | ${avg(ok.map((s) => s.adjustments)).toFixed(1)} |`,
      `| Step errors | ${scored.filter((s) => s.error).length} |`,
      `| Seconds per run | average ${Math.round(avg(seconds))}, slowest ${Math.round(Math.max(0, ...seconds))} |`,
      "| Findings checked against their source | not checked yet (step 2) |",
    );

    const failures = scored.flatMap((s, i) => s.hard.filter((c) => !c.pass).map((c) => `- Run ${i + 1}: ${c.id}: ${c.detail}`));
    lines.push("", failures.length ? "**Failed hard checks**" : "**Failed hard checks:** none", ...failures);

    const softMisses = scored.flatMap((s, i) => s.soft.filter((c) => !c.pass && c.id !== "may_mention_as_possible_confounder").map((c) => `- Run ${i + 1}: ${c.id}: ${c.detail}`));
    if (softMisses.length) lines.push("", "**Soft checks not met**", ...softMisses);
  }
  return lines.join("\n") + "\n";
}
