# Threadline Signals scorecard: 2026-11-05

- Model: command-r
- Temperatures: pattern 0.2, analysis 0.2, options 0.5, reviewCard 0.2
- Runs per pack: 3
- Code version (git commit): f98c201
- Numbers by reference: off
- Answer key: draft

All data is synthetic. "Hard" checks decide whether a run passed; "soft" checks are reported only.

## Healthcare pack (benchmark + decoys)

| Measure | Result |
| --- | --- |
| Hard pass rate | 67% (2 of 3 runs) |
| Required citations found | 67% |
| Runs citing an unrelated decoy | 0 (target 0) |
| Counter-evidence or confounder cited as support | 0 (target 0) |
| Counter-evidence acknowledged (soft) | 100% |
| Possible confounder mentioned (soft, informational) | 100% |
| Confidence agreement | 100% (3 successful runs) |
| Citation agreement | 89% |
| Leading option agreement | 67% |
| Retries per run | 3.0 |
| Code adjustments per run | 3.0 |
| Step errors | 0 |
| Seconds per run | average 981, slowest 1082 |
| Findings checked against their source | 26 of 26 verified (0 removed as unverified; 2 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 14 of 14 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 23 of 27 verified (4 removed as unverified; 0 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 34 of 34 verified (0 replaced, 0 removed) |
| Time windows with a cited record | 3 of 3 |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |

**Failed hard checks**
- Run 1: pattern_must_cite_all: Not cited: HC-INC-99102

**Removed or replaced as unverified**
- Run 2: graph.nodes: "Flow Record 20260920-1500" mentions 20260920, 1500, which aren't in the records it cites (HC-FLOW-20260920-1500).
- Run 2: graph.nodes: "Flow Record 20260920-1600" mentions 20260920, 1600, which aren't in the records it cites (HC-FLOW-20260920-1600).
- Run 2: graph.nodes: "Flow Record 20260920-1700" mentions 20260920, 1700, which aren't in the records it cites (HC-FLOW-20260920-1700).
- Run 2: graph.nodes: "Flow Record 20260920-1800" mentions 20260920, 1800, which aren't in the records it cites (HC-FLOW-20260920-1800).

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
| Retries per run | 2.3 |
| Code adjustments per run | 2.7 |
| Step errors | 0 |
| Seconds per run | average 1148, slowest 1278 |
| Findings checked against their source | 39 of 39 verified (0 removed as unverified; 3 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 16 of 16 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 35 of 35 verified (0 removed as unverified; 2 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 29 of 31 verified (2 replaced, 0 removed) |
| Time windows with a cited record | 6 of 6 |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |

**Failed hard checks:** none

**Removed or replaced as unverified**
- Run 1: pattern_statement: "Records suggest that between 3 and 6 pm on September 20, bed occupancy was above 90% and room-to-physician time was over 45 minutes, while the waiting room count remained high." mentions 3, which isn't in this Thread's records (HC-FLOW-20260920-1500, HC-FLOW-20260920-1600, HC-FLOW-20260920-1700 and 9 more).
- Run 1: possible_vignette.situation: "Between 3 and 6 pm on September 20, bed occupancy was above 90% and room-to-physician time was over 45 minutes, while the waiting room count remained high. This pattern also occurred between 2 and 4 pm on September 22." mentions 3, which isn't in this Thread's records (HC-FLOW-20260920-1500, HC-FLOW-20260920-1600, HC-FLOW-20260920-1700 and 9 more).

**Soft checks not met**
- Run 1: pattern_text_mentions_second_window: Describes the first window only
- Run 3: pattern_text_mentions_second_window: Describes the first window only
