# Checking the analysis's claims against their records

Status: **built 2026-11-04; needs a scorecard run on the founder's Mac**

Extends step 2 (`docs/specs/2026-11-04-step2-verify-findings.md`) to Prompt 2's
**contributing conditions** and **pressure map**. No new fields for the model: the recorded
analyses' claims are short ("High bed occupancy", "Time pressure") and cite records with a
trust label, so code checks what can be checked without asking the model for more.

1. **Numbers** in a claim (`condition`; `pressure_carried`, `shifting_to`) must be in at least
   one of the records it cites, or be a domain threshold. A claim citing no records is checked
   against all the step's input records. Same number rules as step 2. A problem joins the step's
   one retry; a claim still failing after it is removed and logged as "unverified, removed".
2. **Trust labels** must fit the cited records, corrected in code and logged (no retry, since
   the right label follows from what's cited):
   - Inferred is always kept (the model is saying it's unconfirmed);
   - citing no records → Inferred;
   - Authoritative needs a cited policy, otherwise → Observed;
   - Observed needs a cited flow, incident, complaint or near-miss record, otherwise → Authoritative;
   - Experiential and Historical come only from people (Add context, past decisions), so the
     model can't claim them → Observed or Authoritative from what's cited.

Tally: `meta.verification.analysis` (`claims_checked`, `claims_verified`, `claims_removed`,
`labels_corrected`). Scorecard line: "Analysis claims checked against their records".

Known gap: the wording of a claim isn't checked against the record (only its numbers and its
label). Asking the model for a quote per claim, as for findings, is the next step if the
scorecard shows that's needed. Still later: graph nodes, "evidence that does not fit", the
vignette story, options, the review card.
