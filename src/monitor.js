// monitor.js — the background system-signals monitor.
//
// "Check now" (or the optional timer) looks in the incoming folder for new record files.
// For each new file it:
//   1. reads the records and files them away (so each file is processed once);
//   2. checks the domain triggers in code (Layer 1: no AI unless a trigger fires);
//   3. for each triggered window, looks for an OPEN Thread with the same pattern type,
//      domain and location. If there is one, the new evidence is added to it and the
//      analysis re-run (the update goes in its history). Otherwise a new Thread is made.
//   4. new incident/complaint records near an open Thread's windows also update it.
//
// Where files live is up to `io` (the app passes one that uses its data folder; tests pass
// their own), so this logic can be tested without the app.

import { parseRecordFile, findTriggeredWindows, isQualitative, isFlow, time } from "./records.js";
import { runPipeline } from "./pipeline.js";
import { createThread, updateThread, isOpen } from "./threads.js";

const TWO_HOURS = 2 * 60 * 60 * 1000;

/**
 * @param {object} args
 * @param {object} args.io  { listIncoming, readIncoming, archiveIncoming, loadProcessedRecords, loadThreads, saveThread }
 * @param {object} args.rules, args.schemas, args.config
 * @param {Array}  args.evidenceLibrary
 * @param {Function} [args.ask]  Stand-in for the model (tests)
 * @param {(message: string) => void} [args.onProgress]
 * @returns {Promise<{ files, created, updated, errors }>}  Thread ids created/updated.
 */
export async function checkForSignals({ io, rules, schemas, config, evidenceLibrary, ask, onProgress = () => {} }) {
  const summary = { files: [], created: [], updated: [], errors: [] };
  const names = await io.listIncoming();
  if (names.length === 0) return summary;

  // 1. Read new files; records already seen (same source_id) are ignored.
  const known = await io.loadProcessedRecords();
  const knownIds = new Set(known.map((r) => r.source_id));
  const newRecords = [];
  const filesByRecord = new Map();
  for (const name of names) {
    try {
      const fresh = parseRecordFile(name, await io.readIncoming(name)).filter((r) => !knownIds.has(r.source_id));
      for (const r of fresh) filesByRecord.set(r.source_id, name);
      newRecords.push(...fresh);
      await io.archiveIncoming(name);
      summary.files.push(name);
    } catch (err) {
      summary.errors.push(`${name}: ${err.message}`);
    }
  }
  const all = [...known, ...newRecords];
  const byId = new Map(all.map((r) => [r.source_id, r]));
  const threads = await io.loadThreads();
  const filesOf = (records) => [...new Set(records.map((r) => filesByRecord.get(r.source_id)).filter(Boolean))];

  const run = async (windows) => {
    onProgress(`Analysing "${windows[0].pattern_type}" at ${windows[0].location}…`);
    const result = await runPipeline({ windows, records: all, rules, evidenceLibrary, schemas, config, ask,
      onStep: (step) => onProgress(`Analysing "${windows[0].pattern_type}": ${STEP_NAMES[step] ?? step}…`) });
    const confident = ["Medium", "High"].includes(result.steps.pattern.confidence);
    return { result, qualifiesForFlag: confident && result.meta.safety_conditions.length > 0 };
  };

  // 2–3. Triggered windows from the new flow records, grouped by pattern type + location.
  const groups = new Map();
  for (const w of findTriggeredWindows(newRecords.filter(isFlow), rules)) {
    const key = `${w.domain}|${w.pattern_type}|${w.location}`;
    groups.set(key, [...(groups.get(key) ?? []), w]);
  }
  for (const newWindows of groups.values()) {
    const { domain, pattern_type, location } = newWindows[0];
    const match = threads.find((t) => isOpen(t) && t.domain === domain && t.pattern_type === pattern_type && t.location === location);
    const files = filesOf(newWindows.flatMap((w) => w.flowRecords));
    try {
      if (match) {
        const windows = [...rebuildWindows(match, byId), ...newWindows];
        const { result, qualifiesForFlag } = await run(windows);
        await io.saveThread(updateThread(match, result, { windows, files: [...files, ...filesOf(qualitativeFor(windows, newRecords))], qualifiesForFlag }));
        summary.updated.push(match.id);
      } else {
        const { result, qualifiesForFlag } = await run(newWindows);
        const thread = createThread(result, {
          windows: newWindows, files: [...files, ...filesOf(qualitativeFor(newWindows, newRecords))],
          existingIds: threads.map((t) => t.id), qualifiesForFlag,
        });
        threads.push(thread);
        await io.saveThread(thread);
        summary.created.push(thread.id);
      }
    } catch (err) {
      summary.errors.push(`${pattern_type} at ${location}: ${err.message}`);
    }
  }

  // 4. New incident/complaint records that land near an open Thread that wasn't just handled.
  const handled = new Set([...summary.created, ...summary.updated]);
  for (const thread of threads.filter((t) => isOpen(t) && !handled.has(t.id))) {
    const windows = rebuildWindows(thread, byId);
    const nearby = qualitativeFor(windows, newRecords);
    if (nearby.length === 0) continue;
    try {
      const { result, qualifiesForFlag } = await run(windows);
      await io.saveThread(updateThread(thread, result, { windows, files: filesOf(nearby), qualifiesForFlag }));
      summary.updated.push(thread.id);
    } catch (err) {
      summary.errors.push(`${thread.id}: ${err.message}`);
    }
  }
  return summary;
}

const STEP_NAMES = {
  pattern: "drafting the pattern",
  analysis: "analysing the system",
  evidence: "choosing evidence",
  options: "drafting options",
  reviewCard: "writing the review card",
};

// A Thread's saved windows, with their flow records looked up again.
function rebuildWindows(thread, byId) {
  return thread.windows.map((w) => ({
    domain: thread.domain, pattern_type: thread.pattern_type, location: thread.location,
    start: w.start, end: w.end,
    flowRecords: w.source_ids.map((id) => byId.get(id)).filter(Boolean),
  }));
}

// New incident/complaint records at the windows' location within ±2 hours of any of them.
function qualitativeFor(windows, newRecords) {
  return newRecords.filter((r) => isQualitative(r) && windows.some((w) =>
    r.location === w.location && time(r) >= time({ timestamp: w.start }) - TWO_HOURS && time(r) <= time({ timestamp: w.end }) + TWO_HOURS));
}

/**
 * Run `check` every `minutes` minutes (0 = never: manual "Check now" only).
 * @returns {() => void} Call to stop.
 */
export function startMonitorTimer(minutes, check) {
  if (!minutes || minutes <= 0) return () => {};
  const id = setInterval(check, minutes * 60 * 1000);
  return () => clearInterval(id);
}
