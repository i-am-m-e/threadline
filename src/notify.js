// notify.js — how Signals tells people about Threads (spec section 11).
//
//  • FLAG: an in-app badge plus one local macOS notification, only when the pipeline set a
//    Thread's status to "Flagged" (Medium+ confidence with a safety-relevant condition, or
//    seen on enough occasions: recurrence.js), and only for its first flag.
//  • DAILY CAP: at most `dailyFlagCap` flags per day (config.js). Anything beyond the cap
//    goes to the digest instead.
//  • DIGEST (the default): everything else, shown on demand in the app, grouped by domain.
//  • ALERT VOLUME: flags and digest items in the last 7 days, shown in the toolbar.
//
// The notification text names the pattern and location only: no people, no record details.
// Notifications are local to this Mac (Tauri's notification plugin); nothing is sent anywhere.

import { confidenceText } from "./recurrence.js";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Decide flag or digest for Threads just created or updated, and record the decision in
 * `state` (saved by the caller). Returns the Threads to notify about now.
 * @param {Array<{thread, kind: "new" | "updated"}>} changes
 * @param {object} state  { flags: [{thread_id, time}], digest: [{thread_id, time, kind, domain}] }
 * @param {number} cap    Daily flag cap.
 */
export function routeAlerts(changes, state, cap, now = new Date()) {
  state.flags ??= [];
  state.digest ??= [];
  const toNotify = [];
  for (const { thread, kind } of changes) {
    const alreadyFlagged = state.flags.some((f) => f.thread_id === thread.id);
    const qualifies = thread.status === "Flagged" && !alreadyFlagged;
    if (qualifies && flagsToday(state, now) < cap) {
      state.flags.push({ thread_id: thread.id, time: now.toISOString() });
      thread.notification = "flag";
      toNotify.push(thread);
    } else {
      state.digest.push({
        thread_id: thread.id, time: now.toISOString(), kind, domain: thread.domain,
        ...(qualifies ? { over_cap: true } : {}),
      });
      if (!alreadyFlagged) thread.notification = "digest";
    }
  }
  return toNotify;
}

/** Flags raised today (local calendar day). */
export function flagsToday(state, now = new Date()) {
  const today = now.toDateString();
  return (state.flags ?? []).filter((f) => new Date(f.time).toDateString() === today).length;
}

/** Flags and digest items in the last 7 days. */
export function alertVolume(state, now = new Date()) {
  const since = now.getTime() - 7 * DAY;
  const recent = (list) => (list ?? []).filter((x) => new Date(x.time).getTime() >= since).length;
  return { flags: recent(state.flags), digest: recent(state.digest) };
}

/**
 * The digest: digest items since the last time it was opened (or the last 7 days),
 * grouped by domain, newest first, one entry per Thread.
 * @returns {Array<{domain, items: Array<{thread, kinds, over_cap}>}>}
 */
export function buildDigest(threads, state, now = new Date()) {
  const since = state.lastDigestAt ? new Date(state.lastDigestAt).getTime() : now.getTime() - 7 * DAY;
  const byThread = new Map();
  for (const item of (state.digest ?? []).filter((d) => new Date(d.time).getTime() > since)) {
    const thread = threads.find((t) => t.id === item.thread_id);
    if (!thread) continue;
    const entry = byThread.get(thread.id) ?? { thread, kinds: new Set(), over_cap: false };
    entry.kinds.add(item.kind);
    entry.over_cap ||= Boolean(item.over_cap);
    byThread.set(thread.id, entry);
  }
  const groups = new Map();
  for (const entry of byThread.values()) {
    const list = groups.get(entry.thread.domain) ?? [];
    list.push({ ...entry, kinds: [...entry.kinds] });
    groups.set(entry.thread.domain, list);
  }
  return [...groups].map(([domain, items]) => ({ domain, items }));
}

/**
 * The notification text: pattern, location, confidence with recurrence, and why it was
 * flagged (safety-relevant, or recurring). No people, no record details.
 */
export function notificationBody(thread, every) {
  const flag = thread.history.findLast((h) => h.status === "Flagged" && h.by === "Threadline");
  const why = flag?.note?.startsWith("Recurring") ? "recurring" : "safety-relevant";
  return `${thread.pattern_type} at ${thread.location} (${confidenceText(thread, every)}; ${why}). Review it in Signals.`;
}

/** Show one local macOS notification (asks for permission the first time). */
export async function sendLocalNotification(thread, every) {
  const api = window.__TAURI__?.notification;
  if (!api) return false;
  let allowed = await api.isPermissionGranted();
  if (!allowed) allowed = (await api.requestPermission()) === "granted";
  if (!allowed) return false;
  api.sendNotification({
    title: "Threadline: possible operational pattern",
    body: notificationBody(thread, every),
  });
  return true;
}
