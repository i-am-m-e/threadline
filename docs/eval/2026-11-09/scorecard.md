# Threadline Signals scorecard: 2026-11-09

- Model: command-r
- Temperatures: pattern 0.2, analysis 0.2, options 0.5, reviewCard 0.2
- Runs per pack: 3
- Code version (git commit): 4c61cab
- Numbers by reference: off
- Answer key: approved

All data is synthetic. "Hard" checks decide whether a run passed; "soft" checks are reported only.

## Healthcare pack (benchmark + decoys)

| Measure | Result |
| --- | --- |
| Hard pass rate | 33% (1 of 3 runs) |
| Required citations found | 33% |
| Runs citing an unrelated decoy | 0 (target 0) |
| Counter-evidence or confounder cited as support | 0 (target 0) |
| Counter-evidence acknowledged (soft) | 100% |
| Possible confounder mentioned (soft, informational) | 100% |
| Confidence agreement | 100% (3 successful runs) |
| Citation agreement | 89% |
| Leading option agreement | 67% |
| Retries per run | 2.7 |
| Code adjustments per run | 2.0 |
| Step errors | 0 |
| Seconds per run | average 816, slowest 849 |
| Findings checked against their source | 19 of 21 verified (2 removed as unverified; 1 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 18 of 18 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 29 of 29 verified (0 removed as unverified; 0 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 30 of 30 verified (0 replaced, 0 removed) |
| Time windows with a cited record | 3 of 3 |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |
| Safety records listed as not fitting | 2 asked about on a retry (2 fixed; 0 left as the model wrote them) |

**Failed hard checks**
- Run 1: pattern_must_cite_all: Not cited: HC-INC-99102
- Run 2: pattern_must_cite_all: Not cited: HC-INC-99102

**Removed or replaced as unverified**
- Run 1: HC-INC-99102: the finding mentions 1, which isn't in that record. Use the record's own numbers.
- Run 2: HC-INC-99102: the finding mentions 1, which isn't in that record. Use the record's own numbers.

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
| Citation agreement | 93% |
| Leading option agreement | 33% |
| Retries per run | 2.7 |
| Code adjustments per run | 2.0 |
| Step errors | 0 |
| Seconds per run | average 951, slowest 1045 |
| Findings checked against their source | 38 of 38 verified (0 removed as unverified; 3 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 16 of 16 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 33 of 33 verified (0 removed as unverified; 0 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 27 of 29 verified (2 replaced, 0 removed) |
| Time windows with a cited record | 6 of 6 |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |
| Safety records listed as not fitting | none |

**Failed hard checks:** none

**Removed or replaced as unverified**
- Run 1: pattern_statement: "Records suggest that between 2026-09-20T15:00 and 2026-09-20T18:00, bed occupancy was above 90% and room-to-physician time was above 45 minutes, resulting in long waits after rooming." mentions 0, which isn't in this Thread's records (HC-FLOW-20260920-1500, HC-FLOW-20260920-1600, HC-FLOW-20260920-1700 and 9 more).
- Run 1: possible_vignette.situation: "Between 2026-09-20T15:00 and 2026-09-20T18:00, bed occupancy was above 90% and room-to-physician time was above 45 minutes. This pattern also occurred between 2026-09-22T14:00 and 2026-09-22T16:00." mentions 0, which isn't in this Thread's records (HC-FLOW-20260920-1500, HC-FLOW-20260920-1600, HC-FLOW-20260920-1700 and 9 more).

**Soft checks not met**
- Run 1: pattern_text_mentions_second_window: Describes the first window only
- Run 2: pattern_text_mentions_second_window: Describes the first window only
- Run 3: pattern_text_mentions_second_window: Describes the first window only
