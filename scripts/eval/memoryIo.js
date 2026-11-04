// memoryIo.js — an in-memory stand-in for the app's data folder, for checkForSignals().
//
// The app gives checkForSignals() an `io` object that reads and files record files in its
// data folder. This one keeps everything in memory instead, so tests and the scorecard can
// run the app's real "Check now" logic without touching the app's data.
import { parseRecordFile } from "../../src/records.js";

export function memoryIo() {
  const incoming = new Map();  // name → text, waiting to be checked
  const processed = new Map(); // name → text, already handled
  const threads = new Map();   // id → Thread (stored as copies, like saving to disk)
  const copy = (x) => structuredClone(x);

  const io = {
    async listIncoming() { return [...incoming.keys()]; },
    async readIncoming(name) { return incoming.get(name); },
    async archiveIncoming(name) {
      processed.set(name, incoming.get(name));
      incoming.delete(name);
    },
    async loadProcessedRecords() {
      const records = [];
      for (const [name, text] of processed) {
        try { records.push(...parseRecordFile(name, text)); } catch { /* unreadable files are skipped, as in the app */ }
      }
      return records;
    },
    async loadThreads() { return [...threads.values()].map(copy); },
    async saveThread(thread) { threads.set(thread.id, copy(thread)); },
  };

  return {
    io,
    /** Drop record files into incoming. @param {Array<{name: string, text: string}>} files */
    put(files) { for (const f of files) incoming.set(f.name, f.text); },
    /** Saved Threads. */
    threads: () => [...threads.values()].map(copy),
    /** Names of files still waiting in incoming. */
    incoming: () => [...incoming.keys()],
  };
}
