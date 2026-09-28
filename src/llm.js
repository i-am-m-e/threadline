// llm.js — every Signals prompt goes through runStep() here.
//
// For each step it:
//   1. asks the model (via model.js) with the step's JSON Schema as Ollama's `format`,
//      so the model can only answer with JSON of the right shape;
//   2. checks the answer against the schema again, in code (validateAgainstSchema);
//   3. runs the SOURCE GUARD: any source_id or evidence_id that wasn't in this step's
//      inputs is removed and logged; a claim left with no sources becomes "Inferred";
//   4. scans for GUARDRAIL problems: people's names, or labels for individual behaviour;
//   5. runs the step's own extra checks (e.g. "must begin with 'Threadline noticed'").
// If anything in 2, 4 or 5 fails, the model gets ONE retry, told exactly what was wrong.
// A second failure stops with a clear error the interface can show.
//
// Nothing here talks to the network directly: model.js does that (only to local Ollama).

import { getModelResponse } from "./model.js";

/** An error from a Signals step, with the problems found (for the interface to show). */
export class StepError extends Error {
  constructor(step, problems) {
    super(`Threadline couldn't complete the "${step}" step: ${problems.slice(0, 3).join("; ")}`);
    this.step = step;
    this.problems = problems;
  }
}

/**
 * Run one prompt and return its checked output.
 *
 * @param {object} step
 * @param {string} step.name         e.g. "pattern" (used in logs and errors)
 * @param {string} step.prompt       The full prompt (shared rules + step prompt), from src/prompts/.
 * @param {object} step.schema       The step's JSON Schema, from src/schemas/.
 * @param {string} step.model
 * @param {number} step.temperature
 * @param {Set<string>} [step.sourceIds]    source_ids that exist in this step's inputs
 * @param {Set<string>} [step.evidenceIds]  evidence_ids that exist in this step's inputs
 * @param {(output) => string[]} [step.checks]  Extra checks; return a list of problems (empty = fine).
 * @param {Function} [step.ask]      Stand-in for getModelResponse (used by tests).
 * @returns {Promise<{ output: object, log: Array }>}
 */
export async function runStep({ name, prompt, schema, model, temperature, sourceIds, evidenceIds, checks, ask = getModelResponse }) {
  const log = [];
  const messages = [
    { role: "system", content: prompt },
    { role: "user", content: "Output the JSON now." },
  ];

  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await ask(messages, { model, temperature, format: schema });
    const { output, problems } = checkAnswer(raw, { name, schema, sourceIds, evidenceIds, checks, log });
    if (problems.length === 0) return { output, log };

    log.push(entry(name, "problems", problems.join("; "), attempt));
    if (attempt === 2) throw new StepError(name, problems);

    // Second try: show the model its answer and exactly what was wrong with it.
    messages.push(
      { role: "assistant", content: raw },
      {
        role: "user",
        content:
          "Your answer had these problems:\n- " + problems.join("\n- ") +
          "\nWrite the whole JSON again with them fixed. Output only the JSON.",
      }
    );
  }
}

// Steps 2–5 for one answer. Returns the (guarded) output and any problems.
function checkAnswer(raw, { name, schema, sourceIds, evidenceIds, checks, log }) {
  let output;
  try {
    output = JSON.parse(raw);
  } catch {
    return { output: null, problems: ["The answer was not valid JSON."] };
  }
  const schemaProblems = validateAgainstSchema(output, schema);
  if (schemaProblems.length > 0) return { output, problems: schemaProblems };

  for (const removal of guardSources(output, { sourceIds, evidenceIds })) {
    log.push(entry(name, removal.kind, removal.detail));
  }
  const problems = [...findGuardrailProblems(output), ...(checks ? checks(output) : [])];
  return { output, problems };
}

const entry = (step, type, detail, attempt) => ({ step, type, detail, ...(attempt ? { attempt } : {}), time: new Date().toISOString() });

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------
// A small validator for exactly the JSON Schema rules our schemas use. It refuses
// any rule it doesn't know, so a schema can never have a check that's silently skipped.
const KNOWN_RULES = new Set([
  "$comment", "type", "enum", "required", "properties", "additionalProperties",
  "items", "minItems", "maxItems", "minimum", "maximum",
]);

/** @returns {string[]} Problems, e.g. 'confidence: "Very high" is not one of Low, Medium, High'. Empty = valid. */
export function validateAgainstSchema(value, schema, path = "answer") {
  for (const rule of Object.keys(schema)) {
    if (!KNOWN_RULES.has(rule)) throw new Error(`Schema rule "${rule}" isn't supported (at ${path})`);
  }
  const problems = [];
  const kind = Array.isArray(value) ? "array" : value === null ? "null" : Number.isInteger(value) ? "integer" : typeof value;
  const typeOk =
    !schema.type || schema.type === kind || (schema.type === "number" && kind === "integer");
  if (!typeOk) return [`${path}: expected ${schema.type}, got ${kind}`];

  if (schema.enum && !schema.enum.includes(value)) {
    problems.push(`${path}: ${JSON.stringify(value)} is not one of ${schema.enum.join(", ")}`);
  }
  if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${path}: must be at least ${schema.minimum}`);
  if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${path}: must be at most ${schema.maximum}`);

  if (kind === "object") {
    for (const key of schema.required ?? []) {
      if (!(key in value)) problems.push(`${path}: missing "${key}"`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) problems.push(...validateAgainstSchema(child, schema.properties[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) problems.push(`${path}: unexpected field "${key}"`);
    }
  }
  if (kind === "array") {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${path}: needs at least ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${path}: allows at most ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => problems.push(...validateAgainstSchema(item, schema.items, `${path}[${i}]`)));
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Source guard
// ---------------------------------------------------------------------------
/**
 * Remove any source_id / evidence_id that wasn't in the step's inputs (changes `output`).
 *  - a list of evidence items whose own source_id is invented: that item is removed
 *  - "source_ids" lists: invented IDs removed; if none are left, the claim's trust_label becomes "Inferred"
 *  - "policy_source_id": an invented one is blanked
 *  - "evidence_ids": invented IDs removed
 * @returns {Array<{kind, detail}>} What was changed, for the log.
 */
export function guardSources(output, { sourceIds, evidenceIds }) {
  const changes = [];
  const visit = (node, path) => {
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const item = node[i];
        if (sourceIds && item && typeof item === "object" && typeof item.source_id === "string" && !sourceIds.has(item.source_id)) {
          changes.push({ kind: "removed_source", detail: `${path}[${i}]: removed item citing unknown source_id "${item.source_id}"` });
          node.splice(i, 1);
          continue;
        }
        visit(item, `${path}[${i}]`);
      }
      return;
    }
    if (!node || typeof node !== "object") return;

    if (sourceIds && Array.isArray(node.source_ids)) {
      const kept = node.source_ids.filter((id) => sourceIds.has(id));
      for (const id of node.source_ids.filter((x) => !sourceIds.has(x))) {
        changes.push({ kind: "removed_source", detail: `${path}.source_ids: removed unknown "${id}"` });
      }
      if (kept.length === 0 && node.source_ids.length > 0 && "trust_label" in node && node.trust_label !== "Inferred") {
        changes.push({ kind: "inferred", detail: `${path}: no sources left, trust_label "${node.trust_label}" → "Inferred"` });
        node.trust_label = "Inferred";
      }
      node.source_ids = kept;
    }
    if (sourceIds && typeof node.policy_source_id === "string" && node.policy_source_id && !sourceIds.has(node.policy_source_id)) {
      changes.push({ kind: "removed_source", detail: `${path}.policy_source_id: removed unknown "${node.policy_source_id}"` });
      node.policy_source_id = "";
    }
    if (evidenceIds && Array.isArray(node.evidence_ids)) {
      for (const id of node.evidence_ids.filter((x) => !evidenceIds.has(x))) {
        changes.push({ kind: "removed_evidence", detail: `${path}.evidence_ids: removed unknown "${id}"` });
      }
      node.evidence_ids = node.evidence_ids.filter((id) => evidenceIds.has(id));
    }
    for (const [key, child] of Object.entries(node)) {
      if (child && typeof child === "object") visit(child, `${path}.${key}`);
    }
  };
  visit(output, "answer");
  return changes;
}

// ---------------------------------------------------------------------------
// Guardrail scan: no people's names, no labels for individual behaviour
// ---------------------------------------------------------------------------
// Names: a title or role abbreviation followed by a name ("Dr. Patel", "RN J. Miller"),
// or an initial and surname ("J. Miller"). Role words after a title ("Nurse Practitioner",
// "Charge Nurse") are fine.
const TITLES = "Dr|Doctor|Nurse|RN|RPN|LPN|NP|PA|Mr|Mrs|Ms|Miss|Mx|Prof|Professor|Operator|Inspector|Supervisor";
const ROLE_WORDS = new Set([
  "Practitioner", "Practitioners", "Lead", "Leads", "Manager", "Managers", "Supervisor", "Station", "Team", "Staff",
  "Coverage", "Shift", "Assistant", "Specialist", "Educator", "Coordinator", "Director", "On", "Call", "In", "Charge",
]);
const NAME_AFTER_TITLE = new RegExp(`\\b(?:${TITLES})\\.?\\s+(?:[A-Z]\\.\\s*)?([A-Z][a-z]{1,})`, "g");
const INITIAL_SURNAME = /\b[A-Z]\.\s?[A-Z][a-z]{2,}\b/g;
// Behaviour labels about individuals (the v3.2 spec forbids classifying behaviour).
const BEHAVIOUR_LABELS = /\b(at[- ]risk behaviou?rs?|reckless(ness)?|careless(ness)?|negligen(t|ce)|disciplin(e|ed|ary)|non-?compliant (staff|nurses?|workers?|employees?|operators?|crews?|physicians?|contractors?))\b/i;

/** @returns {string[]} Problems found in any text of the output. */
export function findGuardrailProblems(output) {
  const problems = [];
  const visit = (node, path) => {
    if (typeof node === "string") {
      for (const m of node.matchAll(NAME_AFTER_TITLE)) {
        if (!ROLE_WORDS.has(m[1])) problems.push(`${path}: looks like a person's name ("${m[0]}"). Use roles only.`);
      }
      for (const m of node.matchAll(INITIAL_SURNAME)) problems.push(`${path}: looks like a person's name ("${m[0]}"). Use roles only.`);
      const label = node.match(BEHAVIOUR_LABELS);
      if (label) problems.push(`${path}: labels individual behaviour ("${label[0]}"). Describe system conditions instead.`);
    } else if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}[${i}]`));
    } else if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) visit(child, `${path}.${key}`);
    }
  };
  visit(output, "answer");
  return problems;
}
