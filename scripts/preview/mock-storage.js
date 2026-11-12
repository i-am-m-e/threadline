// Stands in for src/storage.js in the browser preview (scripts/preview/index.html).
// Threads come from saved scorecard runs (docs/eval); records from the benchmark packs.
// Changes made in the preview live only in the page: nothing is saved to disk.
import { parseRecordFile } from "/src/records.js";

const RUNS = [
  "/docs/eval/2026-11-10/runs/healthcare-1.json",
  "/docs/eval/2026-11-09-2/runs/energy-1.json",
];
const RECORD_FILES = [
  "/data/benchmarks/healthcare/EHR_Flow_2026-09-20.csv",
  "/data/benchmarks/healthcare/Complaint_4471.json",
  "/data/benchmarks/healthcare/RLDatix_Report_99102.json",
  "/data/benchmarks/healthcare/Policy_CTAS_Escalation.json",
  "/data/eval/decoys/healthcare/HC_Eval_Extra_2026-09-20.json",
  "/data/test_incoming/EHR_Flow_2026-09-22.csv",
  "/data/benchmarks/energy/Plant_Permits_2026-09-20.csv",
  "/data/benchmarks/energy/EHS_NearMiss_2026-09-20.json",
  "/data/benchmarks/energy/Policy_LOTO_Verification.json",
  "/data/eval/decoys/energy/EN_Eval_Extra_2026-09-20.json",
];
const getText = async (url) => (await fetch(url)).text();

let threads = null;
export async function listSignalThreads() {
  if (!threads) {
    threads = [];
    for (const [i, url] of RUNS.entries()) {
      const run = JSON.parse(await getText(url));
      // Each scorecard run numbers its Threads from 1, so give each a different id here.
      for (const t of run.threads ?? []) threads.push({ ...t, id: t.id.replace(/-\d+$/, `-${i + 1}`) });
    }
  }
  return threads;
}
export async function saveSignalThread(thread) {
  threads = (await listSignalThreads()).map((t) => (t.id === thread.id ? thread : t));
}
let state = {};
export const loadSignalsState = async () => state;
export const saveSignalsState = async (next) => { state = next; };
// Each saved Thread already carries the evidence items it used (run.steps.evidence).
export const loadEvidenceLibrary = async () => [];

let records = null;
export const monitorIO = {
  listIncoming: async () => [],
  readIncoming: async () => "",
  archiveIncoming: async () => {},
  async loadProcessedRecords() {
    if (!records) {
      records = [];
      for (const url of RECORD_FILES) records.push(...parseRecordFile(url.split("/").pop(), await getText(url)));
    }
    return records;
  },
  loadThreads: () => listSignalThreads(),
  saveThread: (thread) => saveSignalThread(thread),
};
export const readProcessedFile = async (name) => getText(RECORD_FILES.find((f) => f.endsWith(`/${name}`)));
export const incomingFolderPath = async () => "(preview: no incoming folder)";
export const copyPackagedToIncoming = async () => [];
