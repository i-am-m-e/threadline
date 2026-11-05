# Checking the Thread map and the review card against the records

Status: **built 2026-11-04; needs a scorecard run on the founder's Mac**

Why: a browser click-through (recorded answers replayed on records they weren't written for)
showed the review card and the map keeping details that weren't in the Thread's records, e.g. a
map node "Patient waited 85 minutes after rooming".

1. **Map nodes** (Prompt 2's `graph.nodes`): numbers in a label must be in the node's cited
   records (all the step's inputs if it cites none) or be thresholds; one retry, then the node is
   removed and its lines go with it. Trust labels are corrected in code like the other analysis
   claims. The recorded 2026-09-28 run labelled two role nodes "Experiential" with no sources;
   they now become "Inferred".
2. **12-hour clock:** the record's own hour may be written on a 12-hour clock ("15:00" → "3:00 PM"),
   because the model labels flow nodes that way. Only that record's hour.
3. **Review card** (Prompt 4): numbers in `card_title`, `noticed` and `why_it_may_matter` must be in
   the records the run cites after the checks above (all inputs if none) or be thresholds; one
   retry, then the field is replaced with a plain line from code ("Threadline noticed a possible
   pattern: <pattern type> at <location>.") and logged as "unverified, replaced". The card can't
   be removed: a front-line lead needs one.
4. **The policy box** in the manager brief labels "Policy expects" Authoritative only when a policy
   is cited, and "Records suggest" Observed only when at least one finding was verified;
   otherwise Inferred, with a note when no policy was cited.

Tallies: `meta.verification.map` and `meta.verification.card`; scorecard lines "Map nodes checked
against their records" and "Review card wording verified"; the brief's one-line summary.

Known gap: wording is not checked, only numbers and labels. A node like "No monitored bed for
CTAS 2" passes on records that never mention beds, because "2" appears in their dates.
