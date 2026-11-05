# Threadline Signals scorecard: 2026-11-04

- Model: command-r
- Temperatures: pattern 0.2, analysis 0.2, options 0.5, reviewCard 0.2
- Runs per pack: 1
- Code version (git commit): 0613ca4
- Numbers by reference: on
- Answer key: draft

All data is synthetic. "Hard" checks decide whether a run passed; "soft" checks are reported only.

## Healthcare pack (benchmark + decoys)

| Measure | Result |
| --- | --- |
| Hard pass rate | 0% (0 of 1 runs) |
| Required citations found | 0% |
| Runs citing an unrelated decoy | 0 (target 0) |
| Counter-evidence or confounder cited as support | 0 (target 0) |
| Counter-evidence acknowledged (soft) | 0% |
| Possible confounder mentioned (soft, informational) | 100% |
| Confidence agreement | 100% (1 successful run) |
| Citation agreement | 100% |
| Leading option agreement | 100% |
| Retries per run | 3.0 |
| Code adjustments per run | 1.0 |
| Step errors | 0 |
| Seconds per run | average 812, slowest 812 |
| Findings checked against their source | 6 of 6 verified (0 removed as unverified; 0 fixed or dropped on retry) |
| Policy quote verified | 1 of 1 runs |
| Analysis claims checked against their records | 4 of 4 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 9 of 9 verified (0 removed as unverified; 0 trust labels corrected) |
| Review card wording verified | 1 of 1 runs |
| Other wording checked for numbers | 10 of 10 verified (0 replaced, 0 removed) |
| Time windows with a cited record | 1 of 1 |
| Recommendation rationale shortened to two sentences | 0 of 1 runs |
| References filled in | 6 (0 not found) |

**Failed hard checks**
- Run 1: pattern_must_cite_all: Not cited: HC-INC-99102

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
| Retries per run | 3.0 |
| Code adjustments per run | 1.0 |
| Step errors | 0 |
| Seconds per run | average 1003, slowest 1003 |
| Findings checked against their source | 8 of 8 verified (0 removed as unverified; 0 fixed or dropped on retry) |
| Policy quote verified | 1 of 1 runs |
| Analysis claims checked against their records | 4 of 4 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 8 of 8 verified (0 removed as unverified; 0 trust labels corrected) |
| Review card wording verified | 1 of 1 runs |
| Other wording checked for numbers | 7 of 7 verified (0 replaced, 0 removed) |
| Time windows with a cited record | 2 of 2 |
| Recommendation rationale shortened to two sentences | 0 of 1 runs |
| References filled in | 16 (0 not found) |

**Failed hard checks:** none

**Soft checks not met**
- Run 1: pattern_text_mentions_second_window: Describes the first window only

## Energy pack (benchmark + decoys)

| Measure | Result |
| --- | --- |
| Hard pass rate | 100% (1 of 1 runs) |
| Required citations found | 100% |
| Runs citing an unrelated decoy | 0 (target 0) |
| Counter-evidence or confounder cited as support | n/a |
| Counter-evidence acknowledged (soft) | 0% |
| Possible confounder mentioned (soft, informational) | n/a |
| Confidence agreement | 100% (1 successful run) |
| Citation agreement | 100% |
| Leading option agreement | 100% |
| Retries per run | 4.0 |
| Code adjustments per run | 3.0 |
| Step errors | 0 |
| Seconds per run | average 1058, slowest 1058 |
| Findings checked against their source | 8 of 8 verified (0 removed as unverified; 0 fixed or dropped on retry) |
| Policy quote verified | 1 of 1 runs |
| Analysis claims checked against their records | 4 of 4 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 9 of 9 verified (0 removed as unverified; 0 trust labels corrected) |
| Review card wording verified | 1 of 1 runs |
| Other wording checked for numbers | 5 of 7 verified (2 replaced, 0 removed) |
| Time windows with a cited record | 1 of 1 |
| Recommendation rationale shortened to two sentences | 0 of 1 runs |
| References filled in | 0 (0 not found) |

**Failed hard checks:** none

**Removed or replaced as unverified**
- Run 1: pattern_statement: "Records suggest that between {EN-PERMIT-20260920-0700.timestamp} and {EN-PERMIT-20260920-1100.timestamp}, inspectors at Synthetic Site B were overwhelmed with active permits, leading to delayed inspections and potential safety risks.": {EN-PERMIT-20260920-0700.timestamp}: EN-PERMIT-20260920-0700 has no number field "timestamp". "Records suggest that between {EN-PERMIT-20260920-0700.timestamp} and {EN-PERMIT-20260920-1100.timestamp}, inspectors at Synthetic Site B were overwhelmed with active permits, leading to delayed inspections and potential safety risks.": {EN-PERMIT-20260920-1100.timestamp}: EN-PERMIT-20260920-1100 has no number field "timestamp".
- Run 1: possible_vignette.situation: "Between {EN-PERMIT-20260920-0700.timestamp} and {EN-PERMIT-20260920-1100.timestamp}, there was a significant backlog of active permits at Synthetic Site B, with each inspector responsible for more than {EN-PERMIT-20260920-0700.permits_per_inspector} permits.": {EN-PERMIT-20260920-0700.timestamp}: EN-PERMIT-20260920-0700 has no number field "timestamp". "Between {EN-PERMIT-20260920-0700.timestamp} and {EN-PERMIT-20260920-1100.timestamp}, there was a significant backlog of active permits at Synthetic Site B, with each inspector responsible for more than {EN-PERMIT-20260920-0700.permits_per_inspector} permits.": {EN-PERMIT-20260920-1100.timestamp}: EN-PERMIT-20260920-1100 has no number field "timestamp".

**Soft checks not met**
- Run 1: should_acknowledge_as_not_fitting: EN-INC-20260920-06 not acknowledged
