# Threadline v3.2 specification (sections 5–12)

Source of truth for the v3.2 "system signals monitor" direction. Saved from the founder's brief
on 2026-09-28. Guardrails (section 2 of the brief) are repeated at the end for reference.

In short: **Threadline notices, drafts and routes. People decide.**

> **History.** v3.2 replaces the v3.0 "Master Platform & Prompting Specification", a design
> document that was never built. v3.0 generated "dynamic heuristics" (rooming and permit caps)
> offered for one-click application, classified behaviour with a Just Culture taxonomy
> (system trap / at-risk / reckless), and illustrated results with figures that read like real
> outcomes. v3.2 deliberately reverses all three: recommend, never apply; describe systems, never
> classify individuals; no invented results. The v3.0 document is intentionally not stored in
> this repo so those elements can't be reused by accident.
>
> **Implementation notes.** Signals is built as a mode inside the existing Threadline app,
> reusing its model layer, trust labels, domain rules and citation design. The Thread map lives in
> `src/threadMap.js` rather than `src/lines.js` (which already draws the citation lines in chat).
> Triggers in `domain_rules.json` use a machine-checkable form: `{ metric, op, value }` conditions
> that must `all` hold.

---

## 5. Trust labels and visual encoding

| Label | Meaning | Colour |
| --- | --- | --- |
| Authoritative | Approved policy, guideline, SOP | Teal `#2A9D8F` |
| Observed | Telemetry, timestamps, incident or complaint records | Copper `#B87333` |
| Historical | Prior decisions, projects, outcomes | Slate `#4A5568` |
| Experiential | Context confirmed by a front-line role | Amber `#D69E2E` |
| Inferred | Relationship proposed by Threadline, unconfirmed | Coral `#E76F51` (dashed) |
| Suggested | Option or recommendation requiring human decision | Purple `#805AD5` (dashed) |

Map encoding: shape = node type, colour = trust label, dashed = unconfirmed, line thickness =
number of supporting records.

---

## 6. Prompts

### Shared rules (prepend to every prompt)

```
THREADLINE SHARED RULES
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
Suggested = option or recommendation requiring human decision
```

### Prompt 1: Pattern and Vignette Drafter

```
SYSTEM PROMPT: PATTERN AND VIGNETTE DRAFTER

You are Threadline's pattern drafter. You read quantitative flow records
and qualitative incident or complaint records, and draft a POSSIBLE
vignette describing what may be happening in the system.

INSTRUCTIONS
1. Find periods where downstream processing slowed while upstream flow
   continued, using the thresholds in DOMAIN_THRESHOLDS.
2. Match qualitative records within +/- 2 hours of those periods.
3. Draft a plain-language vignette of what the records suggest.
   Describe conditions and flow, not what anyone did wrong.
4. List any evidence that does not fit the pattern.
5. Set confidence:
   High = at least two independent source types agree across more than
          one time window.
   Medium = two source types agree in one window.
   Low = one source type, or a single short window.

OUTPUT SCHEMA
{
  "vignette_id": "VIG-[DATE]-[N]",
  "domain": "Healthcare" | "Energy",
  "pattern_type": "",
  "location": "",
  "time_window": "[start] to [end]",
  "pattern_statement": "One sentence beginning with 'Records suggest'",
  "supporting_evidence": [
    { "source_id": "", "trust_label": "Observed", "finding": "" }
  ],
  "possible_vignette": {
    "situation": "",
    "what_appears_to_happen": "",
    "observed_effects": ""
  },
  "evidence_that_does_not_fit": [""],
  "confidence": "Low" | "Medium" | "High",
  "confidence_reason": ""
}

DOMAIN_THRESHOLDS:
{{DOMAIN_THRESHOLDS}}

FLOW RECORDS:
{{QUANTITATIVE_RECORDS}}

INCIDENT AND COMPLAINT RECORDS:
{{QUALITATIVE_RECORDS}}
```

### Prompt 2: System Analysis

```
SYSTEM PROMPT: SYSTEM ANALYSIS

You are Threadline's system analyst. You examine a possible vignette
against authoritative policy using safety science lenses. Your purpose
is to help reviewers understand the system, not to judge people.

LENSES
- STAMP/STPA: Compare work-as-imagined (policy) with work-as-done
  (records). Describe the gap neutrally.
- HRO: Look for surges, staffing, acuity, weather or other pressures
  before anything else. Resist simple explanations.
- FRAM: Note where small variations combine (for example, shift change
  plus surge plus a delayed discharge).
- Just Culture: Treat any workaround as a likely response to system
  conditions. Do NOT classify any behaviour as at-risk or reckless.
  That judgment belongs to people with full context, not to Threadline.

PRESSURE MAP
For each role affected, describe what pressure it appears to carry and
whether that pressure seems to be moving from one role to another.

GRAPH RULES
- 6 to 12 nodes. Labels of 6 words or fewer.
- node_type must be one of: evidence, policy, condition, role, effect.
- relationship must be one of: "contributes to", "conflicts with",
  "supported by", "shifts pressure to".
- weight = number of source records supporting that edge (1 to 5).
- inferred = true if the edge is not directly supported by a record.

OUTPUT SCHEMA
{
  "vignette_id": "",
  "policy_practice_gap": {
    "policy_source_id": "",
    "what_policy_expects": "",
    "what_records_suggest": "",
    "confidence": "Low" | "Medium" | "High"
  },
  "contributing_conditions": [
    { "condition": "", "source_ids": [""], "trust_label": "" }
  ],
  "compounding_factors": [""],
  "pressure_map": [
    { "role": "", "pressure_carried": "", "shifting_to": "", "source_ids": [""], "trust_label": "" }
  ],
  "alternative_explanations": [""],
  "open_questions": [""],
  "graph": {
    "nodes": [
      { "id": "", "label": "", "node_type": "", "trust_label": "", "source_ids": [""] }
    ],
    "edges": [
      { "source": "", "target": "", "relationship": "", "weight": 1, "inferred": false }
    ]
  }
}

AUTHORITATIVE POLICIES:
{{POLICIES}}

POSSIBLE VIGNETTE:
{{VIGNETTE_JSON}}
```

### Evidence selection (code, not a prompt)

Before Prompt 3, select evidence items from `data/evidence/` whose domain matches and whose
`applies_when` overlaps the Thread's `contributing_conditions` (simple keyword or embedding match
is fine). Pass only those items to Prompt 3. If none match, pass an empty list.

### Prompt 3: Options and Recommendation

```
SYSTEM PROMPT: OPTIONS AND RECOMMENDATION

You are Threadline's recommendation drafter. You prepare an
evidence-based recommendation for a manager, with options, based on a
system analysis and a set of evidence items.

RULES
1. Offer 2 or 3 options. At least one must be a "Learn more" option
   (for example, track the pattern for two weeks, or bring it to an
   existing huddle).
2. For each option, cite supporting evidence_ids from EVIDENCE ITEMS
   only. If none apply, use an empty list, set evidence_strength to
   "None" and write "No library evidence" in local_fit.
3. For each option, state where pressure might move if it is tried,
   and how local context might limit it.
4. Choose a leading option and explain why, in two sentences or fewer,
   referring to evidence strength and local fit.
5. State what new information would change your recommendation.
6. Never propose monitoring, scoring or disciplining individuals.
   Name roles to involve, never people.
7. Recommendation confidence cannot be higher than the Thread's
   pattern confidence. If EVIDENCE ITEMS is empty, confidence is Low.

OUTPUT SCHEMA
{
  "vignette_id": "",
  "options": [
    {
      "option_id": "O1",
      "title": "Short title, 6 words or fewer",
      "type": "Learn more" | "Process adjustment" | "Policy review",
      "description": "",
      "evidence_ids": [""],
      "evidence_strength": "High" | "Moderate" | "Low" | "None",
      "local_fit": "",
      "possible_pressure_transfer": "",
      "roles_to_involve": [""],
      "how_we_would_know": "",
      "revisit_or_stop_if": "",
      "revisit_after_days": 14,
      "trust_label": "Suggested"
    }
  ],
  "recommendation": {
    "leading_option_id": "",
    "rationale": "",
    "would_change_if": "",
    "confidence": "Low" | "Medium" | "High",
    "trust_label": "Suggested"
  },
  "suggested_reviewers": [ { "role": "", "why": "" } ]
}

PATTERN CONFIDENCE:
{{PATTERN_CONFIDENCE}}

SYSTEM ANALYSIS:
{{ANALYSIS_JSON}}

EVIDENCE ITEMS:
{{EVIDENCE_JSON}}
```

Code check after Prompt 3: if recommendation confidence exceeds pattern confidence, lower it to
match and log the change.

### Prompt 4: Front-line Review Card

```
SYSTEM PROMPT: REVIEW CARD

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
{{COMBINED_JSON}}
```

### Example front-line card (healthcare benchmark)

```
Possible pattern: rooming continues while physician pace slows

Threadline noticed that on Sept 20 (14:00 to 18:00), rooms stayed near
full (96%) while rooming-to-physician time averaged 82 minutes. A
complaint describes an 85-minute wait after rooming, and triage reported
no monitored bed for an EMS CTAS 2 arrival.

Why it may matter: acute arrivals may have nowhere to go.

Possible options:
  - Track the pattern for two weeks
  - Huddle trigger when waits pass 45 minutes
  - Review rooming guidance with triage

Based on 3 records: EMR flow export, incident report, complaint
Confidence: Low (single afternoon)

Does this match what you see on shift?
[ Confirm pattern ]  [ Add context ]  [ Doesn't match what I see ]
```

---

## 7. Evidence library (`data/evidence/`)

One JSON file per item:

```json
{
  "evidence_id": "EV-HC-001",
  "domain": "Healthcare",
  "title": "",
  "source_type": "Guideline | Systematic review | Primary study | Expert consensus | Internal outcome",
  "strength": "High | Moderate | Low",
  "summary": "Two to four sentences",
  "applies_when": ["conditions under which this evidence is relevant"],
  "citation": "Full reference",
  "added_by": "founder",
  "synthetic_placeholder": true
}
```

Create three or four placeholder items per domain, with `synthetic_placeholder: true`,
"PLACEHOLDER" at the start of each title, and "PLACEHOLDER: to be replaced by founder" as the
citation. Do not write real citations or study findings from memory. The founder will replace
these with real, curated summaries. The UI should show a visible "Placeholder evidence" tag on any
recommendation that relies on placeholder items.

---

## 8. Domain rules (`domain_rules.json`)

For each domain (Healthcare, Energy), include:

- **acronyms** — Healthcare: CTAS, ED, EHR, UCC. Energy: LOTO, SAGD, SOP.
- **stpa_control_actions** — Healthcare: Patient re-evaluation, Room allocation, Triage
  escalation. Energy: Zero energy verification, Control room sign-off, Permit issuance.
- **triggers** — Healthcare: bed occupancy above 0.90 AND room-to-physician time above 45
  minutes. Energy: active permits per inspector above 6 AND mean inspection wait above 60 minutes.
- **safety_relevant_conditions** — Healthcare: no monitored bed for CTAS 1 or 2, waits after
  rooming over 60 minutes. Energy: work started before zero-energy verification, inspector
  covering more than 6 permits.
- **pattern_types** — Healthcare: "Rooming during slow physician pace". Energy: "Permit issuance
  during inspector backlog".

---

## 9. Benchmark data (`data/benchmarks/` and one incoming file)

Every record needs a unique `source_id`, a `source_type` (`emr_flow`, `incident_report`,
`complaint`, `permit_log`, `near_miss`, `policy`), a `location` and a `timestamp`. Mark every file
as synthetic.

**Healthcare (`data/benchmarks/healthcare/`)**

- `EHR_Flow_2026-09-20.csv`: hourly rows 14:00 to 18:00; bed occupancy peaking at 96%; mean
  room-to-physician 82 minutes; waiting room count 18. Location "Synthetic UCC A".
- `RLDatix_Report_99102.json` (incident_report, 15:30): triage reported no available monitored
  bed when an EMS CTAS 2 chest pain patient arrived.
- `Complaint_4471.json` (complaint, 16:10): patient expressed strong frustration after waiting 85
  minutes post-rooming.
- `Policy_CTAS_Escalation.json` (policy): synthetic excerpt stating CTAS 1 and 2 arrivals require
  immediate access to a monitored bed.

**Energy (`data/benchmarks/energy/`)**

- `Plant_Permits_2026-09-20.csv`: 07:00 to 11:00; 18 active hot-work permits; 2 inspectors on
  duty; mean inspection wait 110 minutes. Location "Synthetic Site B".
- `EHS_NearMiss_2026-09-20.json` (near_miss): contractor crew began flange prep on Line B before
  zero-energy sign-off after a 2-hour wait for inspector verification; inspector was covering 8
  active permits.
- `Policy_LOTO_Verification.json` (policy): synthetic excerpt stating no work may begin before
  physical zero-energy verification.

**Second healthcare file for the dedupe test**

- `EHR_Flow_2026-09-22.csv`: same location, 13:00 to 17:00; occupancy peaking at 94%; mean
  room-to-physician 71 minutes. Saved outside `data/incoming/` (e.g. `data/test_incoming/`) so it
  can be dropped in during testing.

---

## 10. Thread lifecycle

Inferred → Flagged → Under review → Validated pattern **or** Not confirmed → Decision recorded →
Outcome review due → Closed

- The pipeline may set **Inferred** and **Flagged** only. Every later status requires a human
  button press.
- **Decision recorded** stores the option chosen (or "none"), the deciding role and the date.
- **Outcome review due** date = decision date + the chosen option's `revisit_after_days`.
- At outcome review, the manager records what happened and whether it helped, then closes the
  Thread.
- Store every "Doesn't match" and "Not a real pattern" reason, and count them per `pattern_type`
  so trigger thresholds can be tuned later.

---

## 11. Notifications

- **Digest (default):** one in-app summary of new and updated Threads, grouped by domain,
  generated on demand.
- **Flag:** an in-app badge plus a local macOS notification only when pattern confidence is Medium
  or higher and the Thread involves a `safety_relevant_condition`.
- **Daily flag cap:** configurable, default 3. Anything beyond the cap goes to the digest.
- Show an **"alert volume"** count (flags and digest items this week) in the UI.

---

## 12. Thread map renderer

```js
// src/lines.js - Thread map (review-first)
import cytoscape from 'cytoscape';
import dagre from 'cytoscape-dagre';
cytoscape.use(dagre);

const TRUST_COLORS = {
  Authoritative: '#2A9D8F', Observed: '#B87333', Historical: '#4A5568',
  Experiential: '#D69E2E', Inferred: '#E76F51', Suggested: '#805AD5'
};
const SHAPES = {
  evidence: 'round-rectangle', policy: 'rectangle', condition: 'diamond',
  role: 'ellipse', effect: 'hexagon', approach: 'tag'
};

export function renderThreadMap(containerId, graph, onNodeTap, direction = 'TB') {
  const cy = cytoscape({
    container: document.getElementById(containerId),
    elements: [
      ...graph.nodes.map(n => ({ data: {
        ...n,
        color: TRUST_COLORS[n.trust_label] || '#999',
        shape: SHAPES[n.node_type] || 'ellipse'
      } })),
      ...graph.edges.map((e, i) => ({ data: { id: `e${i}`, weight: 1, ...e } }))
    ],
    style: [
      { selector: 'node', style: {
          'background-color': 'data(color)', 'shape': 'data(shape)',
          'label': 'data(label)', 'text-wrap': 'wrap', 'text-max-width': 110,
          'font-size': 11, 'text-valign': 'bottom', 'text-margin-y': 6 } },
      { selector: 'node[trust_label = "Inferred"], node[trust_label = "Suggested"]', style: {
          'border-width': 2, 'border-style': 'dashed', 'border-color': '#333',
          'background-opacity': 0.6 } },
      { selector: 'edge', style: {
          'width': 'mapData(weight, 1, 5, 1, 5)', 'line-color': '#999',
          'target-arrow-shape': 'triangle', 'target-arrow-color': '#999',
          'curve-style': 'bezier', 'label': 'data(relationship)', 'font-size': 9 } },
      { selector: 'edge[?inferred]', style: { 'line-style': 'dashed' } },
      { selector: 'edge[relationship = "conflicts with"]', style: {
          'line-color': '#E76F51', 'target-arrow-color': '#E76F51' } }
    ],
    layout: { name: 'dagre', rankDir: direction, nodeSep: 40, rankSep: 80 }
  });

  // Tapping a node surfaces its source records or evidence (provenance on demand)
  cy.on('tap', 'node', evt => onNodeTap && onNodeTap(evt.target.data()));
  return cy;
}
```

Add the chosen options from Prompt 3 to the map as **approach** nodes (trust label Suggested),
linked from the main effect or role nodes with the relationship "may reduce". "may reduce" is
allowed for these code-added edges only.

---

## Guardrails (from section 2 of the brief)

- Synthetic data only. Never add real patient, staff or workplace data.
- No network calls other than to the local Ollama server. No telemetry, analytics or external APIs.
- Systems, not people. Monitor flows, queues, capacity, incidents and complaints. Never track,
  score or report on an individual's activity or performance.
- No names of people anywhere in data, prompts or UI. Roles only.
- No individual behaviour classification.
- Recommend, never apply. Recommendations are always labelled Suggested. No code path may change a
  Thread's status past Flagged without an explicit human button press.
- Evidence only from the evidence library (`data/evidence/`).
- Wording: in the UI say "system signals" or "operational patterns", never "monitoring staff".
