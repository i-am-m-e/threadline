# Threadline Signals scorecard: 2026-11-05

- Model: command-r
- Temperatures: pattern 0.2, analysis 0.2, options 0.5, reviewCard 0.2
- Runs per pack: 3
- Code version (git commit): a107914
- Numbers by reference: off
- Answer key: draft

All data is synthetic. "Hard" checks decide whether a run passed; "soft" checks are reported only.

## Healthcare pack (benchmark + decoys)

| Measure | Result |
| --- | --- |
| Hard pass rate | 100% (3 of 3 runs) |
| Required citations found | 100% |
| Runs citing an unrelated decoy | 0 (target 0) |
| Counter-evidence or confounder cited as support | 0 (target 0) |
| Counter-evidence acknowledged (soft) | 100% |
| Possible confounder mentioned (soft, informational) | 100% |
| Confidence agreement | 100% (3 successful runs) |
| Citation agreement | 100% |
| Leading option agreement | 67% |
| Retries per run | 2.7 |
| Code adjustments per run | 2.7 |
| Step errors | 0 |
| Seconds per run | average 778, slowest 856 |
| Findings checked against their source | 24 of 24 verified (0 removed as unverified; 3 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 15 of 15 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 23 of 23 verified (0 removed as unverified; 5 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 31 of 31 verified (0 replaced, 0 removed) |
| Time windows with a cited record | 3 of 3 |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |

**Failed hard checks:** none

## Healthcare update (second flow file, same Thread)

| Measure | Result |
| --- | --- |
| Hard pass rate | 100% (3 of 3 runs) |
| Required citations found | n/a |
| Runs citing an unrelated decoy | n/a |
| Counter-evidence or confounder cited as support | n/a |
| Counter-evidence acknowledged (soft) | n/a |
| Possible confounder mentioned (soft, informational) | n/a |
| Confidence agreement | 100% (3 successful runs) |
| Citation agreement | 78% |
| Leading option agreement | 67% |
| Retries per run | 3.0 |
| Code adjustments per run | 2.0 |
| Step errors | 0 |
| Seconds per run | average 917, slowest 1167 |
| Findings checked against their source | 36 of 36 verified (0 removed as unverified; 3 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 16 of 16 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 30 of 30 verified (0 removed as unverified; 2 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 30 of 30 verified (0 replaced, 0 removed) |
| Time windows with a cited record | 5 of 6 (uncited: 2026-09-22 14:00 to 16:00 in run 1) |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |

**Failed hard checks:** none

**Soft checks not met**
- Run 1: pattern_text_mentions_second_window: Describes the first window only
- Run 3: pattern_text_mentions_second_window: Describes the first window only
