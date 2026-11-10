# Threadline Signals scorecard: 2026-11-05

- Model: command-r
- Temperatures: pattern 0.2, analysis 0.2, options 0.5, reviewCard 0.2
- Runs per pack: 3
- Code version (git commit): 6196627
- Numbers by reference: off
- Answer key: draft

All data is synthetic. "Hard" checks decide whether a run passed; "soft" checks are reported only.

## Energy pack (benchmark + decoys)

| Measure | Result |
| --- | --- |
| Hard pass rate | 100% (3 of 3 runs) |
| Required citations found | 100% |
| Runs citing an unrelated decoy | 0 (target 0) |
| Counter-evidence or confounder cited as support | n/a |
| Counter-evidence acknowledged (soft) | 0% |
| Possible confounder mentioned (soft, informational) | n/a |
| Confidence agreement | 100% (3 successful runs) |
| Citation agreement | 100% |
| Leading option agreement | 67% |
| Retries per run | 2.0 |
| Code adjustments per run | 1.7 |
| Step errors | 0 |
| Seconds per run | average 938, slowest 1340 |
| Findings checked against their source | 39 of 39 verified (0 removed as unverified; 0 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 12 of 12 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 23 of 23 verified (0 removed as unverified; 0 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 25 of 27 verified (2 replaced, 0 removed) |
| Time windows with a cited record | 3 of 3 |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |

**Failed hard checks:** none

**Removed or replaced as unverified**
- Run 2: pattern_statement: "Records suggest that between 07:00 and 11:00 on 20 September 2026, the number of active permits per inspector exceeded 6, and the mean inspection wait time exceeded 60 minutes, leading to potential safety concerns." mentions 2026, which isn't in this Thread's records (EN-PERMIT-20260920-0700, EN-PERMIT-20260920-0800, EN-PERMIT-20260920-0900 and 6 more).
- Run 2: possible_vignette.situation: "Between 07:00 and 11:00 on 20 September 2026, there was a significant backlog of active permits at Synthetic Site B, with each inspector responsible for more than 6 permits." mentions 2026, which isn't in this Thread's records (EN-PERMIT-20260920-0700, EN-PERMIT-20260920-0800, EN-PERMIT-20260920-0900 and 6 more).

**Soft checks not met**
- Run 1: should_acknowledge_as_not_fitting: EN-INC-20260920-06 not acknowledged
- Run 2: should_acknowledge_as_not_fitting: EN-INC-20260920-06 not acknowledged
- Run 3: should_acknowledge_as_not_fitting: EN-INC-20260920-06 not acknowledged
