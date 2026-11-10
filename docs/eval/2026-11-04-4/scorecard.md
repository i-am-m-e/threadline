# Threadline Signals scorecard: 2026-11-04

- Model: command-r
- Temperatures: pattern 0.2, analysis 0.2, options 0.5, reviewCard 0.2
- Runs per pack: 3
- Code version (git commit): 0613ca4
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
| Counter-evidence acknowledged (soft) | 67% |
| Possible confounder mentioned (soft, informational) | 67% |
| Confidence agreement | 100% (3 successful runs) |
| Citation agreement | 89% |
| Leading option agreement | 33% |
| Retries per run | 2.3 |
| Code adjustments per run | 4.0 |
| Step errors | 0 |
| Seconds per run | average 725, slowest 820 |
| Findings checked against their source | 20 of 20 verified (0 removed as unverified; 2 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 14 of 14 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 22 of 26 verified (4 removed as unverified; 4 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 31 of 31 verified (0 replaced, 0 removed) |
| Time windows with a cited record | 3 of 3 |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |

**Failed hard checks**
- Run 2: pattern_must_cite_all: Not cited: HC-INC-99102

**Removed or replaced as unverified**
- Run 1: graph.nodes: "Flow Record 1500" mentions 1500, which isn't in the records it cites (HC-FLOW-20260920-1500).
- Run 1: graph.nodes: "Flow Record 1600" mentions 1600, which isn't in the records it cites (HC-FLOW-20260920-1600).
- Run 1: graph.nodes: "Flow Record 1700" mentions 1700, which isn't in the records it cites (HC-FLOW-20260920-1700).
- Run 1: graph.nodes: "Flow Record 1800" mentions 1800, which isn't in the records it cites (HC-FLOW-20260920-1800).

**Soft checks not met**
- Run 1: should_acknowledge_as_not_fitting: HC-CMP-4475 not acknowledged

## Healthcare update (second flow file, same Thread)

| Measure | Result |
| --- | --- |
| Hard pass rate | 67% (2 of 3 runs) |
| Required citations found | n/a |
| Runs citing an unrelated decoy | n/a |
| Counter-evidence or confounder cited as support | n/a |
| Counter-evidence acknowledged (soft) | n/a |
| Possible confounder mentioned (soft, informational) | n/a |
| Confidence agreement | 100% (2 successful runs) |
| Citation agreement | 80% |
| Leading option agreement | 50% |
| Retries per run | 2.0 |
| Code adjustments per run | 1.5 |
| Step errors | 1 |
| Seconds per run | average 937, slowest 1035 |
| Findings checked against their source | 20 of 20 verified (0 removed as unverified; 1 fixed or dropped on retry) |
| Policy quote verified | 2 of 2 runs |
| Analysis claims checked against their records | 9 of 9 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 24 of 24 verified (0 removed as unverified; 0 trust labels corrected) |
| Review card wording verified | 2 of 2 runs |
| Other wording checked for numbers | 19 of 19 verified (0 replaced, 0 removed) |
| Time windows with a cited record | 4 of 4 |
| Recommendation rationale shortened to two sentences | 0 of 2 runs |

**Failed hard checks**
- Run 1: no_step_errors: Rooming during slow physician pace at Synthetic UCC A: Threadline couldn't complete the "options" step: Include at least one option whose "type" is exactly "Learn more": for example, track this pattern for two weeks, or bring it to an existing huddle, before changing anything. Keep your other options. (the file stays in the incoming folder; Check now will try again)

**Soft checks not met**
- Run 2: pattern_text_mentions_second_window: Describes the first window only

## Energy pack (benchmark + decoys)

| Measure | Result |
| --- | --- |
| Hard pass rate | 100% (3 of 3 runs) |
| Required citations found | 100% |
| Runs citing an unrelated decoy | 0 (target 0) |
| Counter-evidence or confounder cited as support | n/a |
| Counter-evidence acknowledged (soft) | 33% |
| Possible confounder mentioned (soft, informational) | n/a |
| Confidence agreement | 100% (3 successful runs) |
| Citation agreement | 90% |
| Leading option agreement | 67% |
| Retries per run | 2.3 |
| Code adjustments per run | 1.7 |
| Step errors | 0 |
| Seconds per run | average 809, slowest 857 |
| Findings checked against their source | 24 of 24 verified (0 removed as unverified; 0 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 12 of 12 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 25 of 25 verified (0 removed as unverified; 0 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 25 of 26 verified (1 replaced, 0 removed) |
| Time windows with a cited record | 3 of 3 |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |

**Failed hard checks:** none

**Removed or replaced as unverified**
- Run 3: pattern_statement: "Records suggest that between 7:00 and 11:00 on September 20, 2026, there was a backlog of active permits per inspector, resulting in a delay in inspection wait times." mentions 2026, which isn't in this Thread's records (EN-PERMIT-20260920-0700, EN-PERMIT-20260920-0800, EN-PERMIT-20260920-0900 and 6 more).

**Soft checks not met**
- Run 2: should_acknowledge_as_not_fitting: EN-INC-20260920-06 not acknowledged
- Run 3: should_acknowledge_as_not_fitting: EN-INC-20260920-06 not acknowledged
