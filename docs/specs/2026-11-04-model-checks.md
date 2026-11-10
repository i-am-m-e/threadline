# Two checks for Command R's weaknesses (from the 2026-09-28 test results)

Status: **built 2026-11-04; needs a scorecard run on the founder's Mac**

1. **Every time window has a cited record.** After the second rooming file, the recorded update
   run still cited only Sept 20 records. Now each window (its flow records and the incidents and
   complaints within ±2 hours) must have at least one record among the pattern's supporting
   evidence. The retry names the window and gives example record ids. If a window is still
   uncited after the retry, the run is accepted and the window is noted (log, brief summary,
   scorecard line "Time windows with a cited record"). Confidence isn't inflated: it already
   counts only cited records per window.
2. **The recommendation's rationale is two sentences or fewer** (Prompt 3, rule 4). Two of the
   three recorded runs used three. The retry says so; if it's still too long, code keeps the
   first two sentences and logs it (scorecard line "Recommendation rationale shortened").

Both use the step's existing single retry, so a run gets no more model calls than before when
the model already follows the rule. With the recorded answers, both trigger on the update run,
and the rationale check on the energy run: expect a little more time per run on the scorecard.

Still waiting for the founder: a check that "Learn more" options are about gathering
information (track, review, huddle, ask…), which needs a judgement on what counts.
