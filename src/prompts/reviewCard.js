// reviewCard.js — Prompt 4: Front-line Review Card.
// Turns the vignette, analysis and options into a short card asking a front-line
// lead whether the pattern matches what they see. Output must match
// src/schemas/reviewCard.schema.json.

import { assemble } from "./sharedRules.js";

const TEMPLATE = `SYSTEM PROMPT: REVIEW CARD

You are Threadline's communication writer. Convert the vignette,
analysis and options into a short card that asks a front-line lead
whether this pattern matches what they see.

RULES
- 80 words maximum across all text fields.
- "noticed" must begin with "Threadline noticed".
- Plain language. Tentative wording. No jargon, no filler.
- State how many records and which source types support the pattern.
- List options as short titles only.
- Always show confidence.

OUTPUT SCHEMA
{
  "card_title": "Possible pattern: [6 to 8 words]",
  "noticed": "",
  "why_it_may_matter": "",
  "possible_options": [""],
  "evidence_badge": "Based on [N] records: [source types]",
  "confidence": "Low" | "Medium" | "High",
  "question": "Does this match what you see on shift?"
}

VIGNETTE, ANALYSIS AND OPTIONS:
{{COMBINED_JSON}}`;

/**
 * @param {object} inputs
 * @param {object} inputs.vignette  Prompt 1's output.
 * @param {object} inputs.analysis  Prompt 2's output.
 * @param {object} inputs.options   Prompt 3's output.
 */
export function buildReviewCardPrompt({ vignette, analysis, options }) {
  return assemble(TEMPLATE, { COMBINED_JSON: { vignette, analysis, options } });
}
