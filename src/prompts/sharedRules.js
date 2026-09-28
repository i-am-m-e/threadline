// sharedRules.js — the rules every Threadline Signals prompt starts with.
// (Text from docs/threadline-spec-v3.2.md, section 6. Change it there first.)

export const SHARED_RULES = `THREADLINE SHARED RULES
1. You describe patterns in approved records. You do not make decisions,
   and nothing you produce is applied automatically.
2. Use tentative language: "records suggest", "appears", "possible".
   Never state a cause as established fact.
3. Every claim must cite one or more source_ids from the input. If you
   cannot cite it, set trust_label to "Inferred" and say it is unconfirmed.
4. Describe systems, conditions and roles. Never assess, classify or blame
   an individual. Never include a person's name.
5. Always include at least one alternative explanation and the questions
   a reviewer would need answered.
6. Output only valid JSON matching the schema. No text before or after.

TRUST LABELS
Authoritative = approved policy, guideline, SOP
Observed = telemetry, timestamps, incident or complaint records
Historical = prior decisions, projects, outcomes
Experiential = context confirmed by a front-line role
Inferred = relationship proposed by Threadline, unconfirmed
Suggested = option or recommendation requiring human decision`;

/**
 * Put the shared rules in front of a prompt and fill in its {{PLACEHOLDERS}}.
 * Values that aren't text (lists, objects) are written out as indented JSON.
 * Throws if a placeholder is left unfilled, so a prompt never goes out half-built.
 */
export function assemble(template, values) {
  const filled = template.replace(/\{\{([A-Z_]+)\}\}/g, (whole, name) => {
    if (values[name] === undefined) throw new Error(`Prompt is missing a value for {{${name}}}`);
    const value = values[name];
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  });
  return `${SHARED_RULES}\n\n${filled}`;
}
