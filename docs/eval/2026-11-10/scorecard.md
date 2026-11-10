# Threadline Signals scorecard: 2026-11-10

- Model: command-r
- Temperatures: pattern 0.2, analysis 0.2, options 0.5, reviewCard 0.2
- Runs per pack: 3
- Code version (git commit): 43b0bfa
- Numbers by reference: off
- Answer key: approved

All data is synthetic. "Hard" checks decide whether a run passed; "soft" checks are reported only.

## Healthcare pack (benchmark + decoys)

| Measure | Result |
| --- | --- |
| Hard pass rate | 100% (3 of 3 runs) |
| Required citations found | 100% |
| Runs citing an unrelated decoy | 0 (target 0) |
| Counter-evidence or confounder cited as support | 0 (target 0) |
| Counter-evidence acknowledged (soft) | 100% |
| Possible confounder mentioned (soft, informational) | 67% |
| Confidence agreement | 100% (3 successful runs) |
| Citation agreement | 100% |
| Leading option agreement | 67% |
| Retries per run | 2.7 |
| Code adjustments per run | 5.0 |
| Step errors | 0 |
| Seconds per run | average 827, slowest 973 |
| Findings checked against their source | 24 of 24 verified (0 removed as unverified; 0 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 16 of 16 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 26 of 30 verified (4 removed as unverified; 6 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 29 of 29 verified (0 replaced, 0 removed) |
| Time windows with a cited record | 3 of 3 |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |
| Safety records listed as not fitting | 3 asked about on a retry (3 fixed; 0 left as the model wrote them) |

**Failed hard checks:** none

**Removed or replaced as unverified**
- Run 1: graph.nodes: "Flow data 2026-09-20 1500" mentions 1500, which isn't in the records it cites (HC-FLOW-20260920-1500).
- Run 1: graph.nodes: "Flow data 2026-09-20 1600" mentions 1600, which isn't in the records it cites (HC-FLOW-20260920-1600).
- Run 1: graph.nodes: "Flow data 2026-09-20 1700" mentions 1700, which isn't in the records it cites (HC-FLOW-20260920-1700).
- Run 1: graph.nodes: "Flow data 2026-09-20 1800" mentions 1800, which isn't in the records it cites (HC-FLOW-20260920-1800).

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
| Leading option agreement | 67% |
| Retries per run | 2.7 |
| Code adjustments per run | 3.0 |
| Step errors | 0 |
| Seconds per run | average 807, slowest 863 |
| Findings checked against their source | 39 of 39 verified (0 removed as unverified; 0 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 13 of 13 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 19 of 20 verified (1 removed as unverified; 3 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 30 of 30 verified (0 replaced, 0 removed) |
| Time windows with a cited record | 6 of 6 |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |
| Safety records listed as not fitting | none |

**Failed hard checks:** none

**Removed or replaced as unverified**
- Run 1: graph.nodes: "CTAS 1 or 2 patient" mentions 1, which isn't in the records it cites (HC-INC-99102).

**Soft checks not met**
- Run 2: pattern_text_mentions_second_window: Describes the first window only
- Run 3: pattern_text_mentions_second_window: Describes the first window only
