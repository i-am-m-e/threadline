# Threadline Signals scorecard: 2026-11-04

- Model: command-r
- Temperatures: pattern 0.2, analysis 0.2, options 0.5, reviewCard 0.2
- Runs per pack: 1
- Code version (git commit): d839eb2
- Numbers by reference: off
- Answer key: draft

All data is synthetic. "Hard" checks decide whether a run passed; "soft" checks are reported only.

## Healthcare pack (benchmark + decoys)

| Measure | Result |
| --- | --- |
| Hard pass rate | 100% (1 of 1 runs) |
| Required citations found | 100% |
| Runs citing an unrelated decoy | 0 (target 0) |
| Counter-evidence or confounder cited as support | 0 (target 0) |
| Counter-evidence acknowledged (soft) | 0% |
| Possible confounder mentioned (soft, informational) | 0% |
| Confidence agreement | 100% (1 successful run) |
| Citation agreement | 100% |
| Leading option agreement | 100% |
| Retries per run | 2.0 |
| Code adjustments per run | 5.0 |
| Step errors | 0 |
| Seconds per run | average 764, slowest 764 |
| Findings checked against their source | 7 of 7 verified (0 removed as unverified; 1 fixed or dropped on retry) |
| Policy quote verified | 1 of 1 runs |
| Analysis claims checked against their records | 4 of 4 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 11 of 11 verified (0 removed as unverified; 4 trust labels corrected) |
| Review card wording verified | 1 of 1 runs |
| Other wording checked for numbers | 7 of 7 verified (0 replaced, 0 removed) |
| Time windows with a cited record | 1 of 1 |
| Recommendation rationale shortened to two sentences | 0 of 1 runs |

**Failed hard checks:** none

**Soft checks not met**
- Run 1: should_acknowledge_as_not_fitting: HC-CMP-4475 not acknowledged

## Healthcare update (second flow file, same Thread)

| Measure | Result |
| --- | --- |
| Hard pass rate | 100% (1 of 1 runs) |
| Required citations found | n/a |
| Runs citing an unrelated decoy | n/a |
| Counter-evidence or confounder cited as support | n/a |
| Counter-evidence acknowledged (soft) | n/a |
| Possible confounder mentioned (soft, informational) | n/a |
| Confidence agreement | 100% (1 successful run) |
| Citation agreement | 100% |
| Leading option agreement | 100% |
| Retries per run | 2.0 |
| Code adjustments per run | 1.0 |
| Step errors | 0 |
| Seconds per run | average 730, slowest 730 |
| Findings checked against their source | 9 of 9 verified (0 removed as unverified; 0 fixed or dropped on retry) |
| Policy quote verified | 1 of 1 runs |
| Analysis claims checked against their records | 6 of 6 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 8 of 8 verified (0 removed as unverified; 0 trust labels corrected) |
| Review card wording verified | 1 of 1 runs |
| Other wording checked for numbers | 8 of 8 verified (0 replaced, 0 removed) |
| Time windows with a cited record | 2 of 2 |
| Recommendation rationale shortened to two sentences | 0 of 1 runs |

**Failed hard checks:** none

**Soft checks not met**
- Run 1: pattern_text_mentions_second_window: Describes the first window only

## Energy pack (benchmark + decoys)

| Measure | Result |
| --- | --- |
| Hard pass rate | 0% (0 of 1 runs) |
| Required citations found | n/a |
| Runs citing an unrelated decoy | n/a |
| Counter-evidence or confounder cited as support | n/a |
| Counter-evidence acknowledged (soft) | n/a |
| Possible confounder mentioned (soft, informational) | n/a |
| Confidence agreement | 100% (0 successful runs) |
| Citation agreement | 100% |
| Leading option agreement | 100% |
| Retries per run | 0.0 |
| Code adjustments per run | 0.0 |
| Step errors | 1 |
| Seconds per run | average 576, slowest 576 |
| Findings checked against their source | n/a (no completed run) |
| Policy quote verified | n/a |

**Failed hard checks**
- Run 1: no_step_errors: Permit issuance during inspector backlog at Synthetic Site B: Threadline couldn't complete the "analysis" step: answer.graph.nodes[6].label: looks like a person's name ("Miss Report"). Use roles only. (the file stays in the incoming folder; Check now will try again)
