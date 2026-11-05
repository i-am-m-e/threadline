# Fixes from a review of the whole pull request

Status: **built 2026-11-04**

A line-by-line review of everything on the pull request found ten issues. Each was checked
against the code before fixing; each fix has a test written first (it failed, then passed).

Bugs that changed behaviour:

1. **The review card was penalised for following its prompt.** The prompt asks it to say how
   many records and source types support the pattern, but "6 records" failed the number check.
   The counts of cited records, source types and time windows are now allowed on the card.
2. **Removals after the retry weren't re-checked.** A map can now end up with fewer than 6 nodes
   (accepted and noted in the log, not padded), and if a replaced line takes the card over 80
   words, that's noted too. The card's replacement line for "why it may matter" is shorter.
3. **The policy gap could cite something that isn't a policy** (e.g. an incident report) and be
   shown as Authoritative. Now that's a problem for the retry, then the id and quote are blanked.
4. **Numbers in a record's id, time and date counted as quantities.** "15 patients" passed
   against a record timestamped 15:00, and "CTAS 2" against a record dated 2026-08-02. Now those
   digits only count when the text uses them as an id ("HC-CMP-4471"), a time ("15:30",
   "3:30 PM", "3 PM") or a date ("2026-09-20", "Sept 20", "September 20th", "20 September").
   This also replaced the earlier 12-hour-clock rule. All recorded runs still pass; on records
   that don't mention beds, a map node "No monitored bed for CTAS 2" is now caught.
5. **Findings' trust labels weren't checked** like the analysis claims' and map nodes'. Now they
   are (corrected in code, logged, counted).

Smaller:

6. "Fixed on retry" counted record ids, so it could include findings the model simply dropped.
   It now counts findings and is called "fixed or dropped on retry", which is what it can tell.
7. A stall while reading an error message from Ollama showed a raw error instead of the plain
   time-out message.
8. Cleanups with no change in behaviour: one shared time-window label (it was written three
   times), the "other passages" count worked out from the lists the checks use, and one shared
   field-name helper and latest-run lookup.

Also: long lists of uncited time windows are shortened in the brief ("… and 9 more").
