# Threadline Signals scorecard: 2026-11-04

- Model: command-r
- Temperatures: pattern 0.2, analysis 0.2, options 0.5, reviewCard 0.2
- Runs per pack: 3
- Code version (git commit): 6b3006b
- Numbers by reference: on
- Answer key: draft

All data is synthetic. "Hard" checks decide whether a run passed; "soft" checks are reported only.

## Healthcare pack (benchmark + decoys)

| Measure | Result |
| --- | --- |
| Hard pass rate | 33% (1 of 3 runs) |
| Required citations found | 33% |
| Runs citing an unrelated decoy | 0 (target 0) |
| Counter-evidence or confounder cited as support | 0 (target 0) |
| Counter-evidence acknowledged (soft) | 33% |
| Possible confounder mentioned (soft, informational) | 0% |
| Confidence agreement | 100% (3 successful runs) |
| Citation agreement | 89% |
| Leading option agreement | 67% |
| Retries per run | 3.0 |
| Code adjustments per run | 3.3 |
| Step errors | 0 |
| Seconds per run | average 863, slowest 898 |
| Findings checked against their source | 22 of 22 verified (0 removed as unverified; 1 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 14 of 14 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 28 of 28 verified (0 removed as unverified; 6 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 22 of 23 verified (1 replaced, 0 removed) |
| Time windows with a cited record | 3 of 3 |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |
| References filled in | 31 (0 not found) |

**Failed hard checks**
- Run 2: pattern_must_cite_all: Not cited: HC-INC-99102
- Run 3: pattern_must_cite_all: Not cited: HC-INC-99102

**Removed or replaced as unverified**
- Run 3: possible_vignette.observed_effects: "A patient expressed strong frustration after waiting {HC-CMP-4471.text}.": {HC-CMP-4471.text}: HC-CMP-4471 has no number field "text". Write its time or date as {HC-CMP-4471.time} or {HC-CMP-4471.date}.

**Soft checks not met**
- Run 1: should_acknowledge_as_not_fitting: HC-CMP-4475 not acknowledged
- Run 3: should_acknowledge_as_not_fitting: HC-CMP-4475 not acknowledged

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
| Citation agreement | 68% |
| Leading option agreement | 67% |
| Retries per run | 2.7 |
| Code adjustments per run | 2.0 |
| Step errors | 0 |
| Seconds per run | average 998, slowest 1255 |
| Findings checked against their source | 24 of 25 verified (1 removed as unverified; 2 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 14 of 14 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 31 of 31 verified (0 removed as unverified; 0 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 24 of 24 verified (0 replaced, 0 removed) |
| Time windows with a cited record | 5 of 6 (uncited: 2026-09-22 14:00 to 16:00 in run 1) |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |
| References filled in | 34 (0 not found) |

**Failed hard checks:** none

**Removed or replaced as unverified**
- Run 2: HC-INC-99102: the finding mentions 1, which isn't in that record. Write figures from flow rows, and times and dates, as references like {ID.field}, {ID.time} or {ID.date}.

**Soft checks not met**
- Run 1: pattern_text_mentions_second_window: Describes the first window only
- Run 2: pattern_text_mentions_second_window: Describes the first window only
- Run 3: pattern_text_mentions_second_window: Describes the first window only

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
| Citation agreement | 90% |
| Leading option agreement | 67% |
| Retries per run | 3.0 |
| Code adjustments per run | 1.3 |
| Step errors | 0 |
| Seconds per run | average 1026, slowest 1088 |
| Findings checked against their source | 25 of 25 verified (0 removed as unverified; 0 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 11 of 11 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 30 of 30 verified (0 removed as unverified; 0 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 21 of 22 verified (0 replaced, 1 removed) |
| Time windows with a cited record | 3 of 3 |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |
| References filled in | 19 (0 not found) |

**Failed hard checks:** none

**Removed or replaced as unverified**
- Run 2: compounding_factors: "Increasing wait times for permit inspections, with an average of over {EN-PERMIT-20260920-0700.record_values[0].value} minutes." mentions 0, which isn't in this Thread's records (EN-PERMIT-20260920-0700, EN-PERMIT-20260920-0800, EN-PERMIT-20260920-0900 and 7 more). Write figures from flow rows, and times and dates, as references like {ID.field}, {ID.time} or {ID.date}.

**Soft checks not met**
- Run 1: should_acknowledge_as_not_fitting: EN-INC-20260920-06 not acknowledged
- Run 2: should_acknowledge_as_not_fitting: EN-INC-20260920-06 not acknowledged
- Run 3: should_acknowledge_as_not_fitting: EN-INC-20260920-06 not acknowledged
