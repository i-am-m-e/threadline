# Threadline Signals scorecard: 2026-11-12

- Model: command-r
- Temperatures: pattern 0.2, analysis 0.2, options 0.5, reviewCard 0.2
- Runs per pack: 3
- Code version (git commit): 6e26b2a
- Numbers by reference: off
- Answer key: approved

All data is synthetic. "Hard" checks decide whether a run passed; "soft" checks are reported only.

## Energy pack (benchmark + decoys)

| Measure | Result |
| --- | --- |
| Hard pass rate | 100% (3 of 3 runs) |
| Required citations found | 100% |
| Runs citing an unrelated decoy | 0 (target 0) |
| Counter-evidence or confounder cited as support | 0 (target 0) |
| Counter-evidence acknowledged (soft) | 67% |
| Possible confounder mentioned (soft, informational) | n/a |
| Confidence agreement | 100% (3 successful runs) |
| Citation agreement | 100% |
| Leading option agreement | 100% |
| Retries per run | 2.0 |
| Code adjustments per run | 2.0 |
| Step errors | 0 |
| Seconds per run | average 897, slowest 1198 |
| Findings checked against their source | 28 of 29 verified (1 removed as unverified; 2 fixed or dropped on retry) |
| Policy quote verified | 3 of 3 runs |
| Analysis claims checked against their records | 12 of 12 verified (0 removed as unverified; 0 trust labels corrected) |
| Map nodes checked against their records | 27 of 27 verified (0 removed as unverified; 2 trust labels corrected) |
| Review card wording verified | 3 of 3 runs |
| Other wording checked for numbers | 30 of 30 verified (0 replaced, 0 removed) |
| Time windows with a cited record | 3 of 3 |
| Recommendation rationale shortened to two sentences | 0 of 3 runs |
| Safety records listed as not fitting | none |

**Failed hard checks:** none

**Removed or replaced as unverified**
- Run 1: EN-INC-20260920-06: the finding says "Work started before zero-energy verification", a safety-relevant condition ("Work started before zero-energy verification"), but EN-INC-20260920-06 doesn't describe it. Cite a record that does. If this record contradicts the pattern, list it under evidence_that_does_not_fit instead.

**Soft checks not met**
- Run 1: should_acknowledge_as_not_fitting: EN-INC-20260920-06 not acknowledged
