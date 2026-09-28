# Threadline data (synthetic)

**Everything in this folder is synthetic.** No real patient, staff or workplace data, and no
people's names: roles only. Every record carries `"synthetic": true` (JSON) or a `synthetic`
column set to `true` (CSV).

| Folder | What it holds |
| --- | --- |
| `domain_rules.json` | Per-domain terms, triggers, safety-relevant conditions and pattern types (spec §8). Copied to the app's data folder on first run. |
| `benchmarks/healthcare/`, `benchmarks/energy/` | Benchmark packs for testing the Signals pipeline (spec §9). |
| `evidence/` | The evidence library (spec §7). The items here are **placeholders** to be replaced by the founder with curated summaries; the model may only cite items from this folder. |
| `test_incoming/` | A second healthcare flow file for the de-duplication test. Drop it into the app's `incoming` folder during testing. |

Every record has a unique `source_id`, a `source_type` (`emr_flow`, `incident_report`,
`complaint`, `permit_log`, `near_miss`, `policy`), a `domain`, a `location` and a `timestamp`.
