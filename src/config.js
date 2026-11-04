// config.js — settings for Signals (the system-signals monitor).
// Change them here; nothing else in the code hard-codes these values.
// (Trigger thresholds are NOT here: they live in domain_rules.json, per domain.)

export const SIGNALS_CONFIG = {
  // Which Ollama model runs the four Signals prompts. Command R kept to the
  // confidence rules in testing (Qwen3 rated a single afternoon "High").
  model: "command-r",

  // How varied each prompt's answers may be (0 = most predictable).
  temperatures: {
    pattern: 0.2,
    analysis: 0.2,
    options: 0.5,
    reviewCard: 0.2,
  },

  // How often to check data/incoming/ for new files, in minutes. 0 = only when you press "Check now".
  monitorIntervalMinutes: 0,

  // At most this many Threads per day may raise a flag (badge + macOS notification).
  // Anything beyond goes to the digest instead.
  dailyFlagCap: 3,

  // Recurrence (src/recurrence.js): how many occasions (triggered time windows) a Thread has
  // been seen on is always shown beside its confidence. Bands come every `recurrenceEvery`
  // occasions (10 → 10+, 20+, 30+…; 5 → 5+, 10+, 15+…) and raise a Thread's place in the
  // list; reaching recurrenceFlagAt occasions can flag it for review even at Low confidence
  // (the daily cap still applies). Recurrence never changes confidence.
  recurrenceEvery: 10,
  recurrenceFlagAt: 10,

  // "Learn more" options must be about gathering information (src/pipeline.js). OFF until the
  // founder approves the word list: an option typed "Learn more" counts as genuine when its
  // description uses one of these words (any ending: "tracking", "reviewed"…). When on, one that
  // doesn't gets the retry, then is relabelled "Process adjustment". "monitor" is left out on
  // purpose: it's ambiguous, and monitoring individuals is refused by another check anyway.
  learnMoreCheck: false,
  learnMoreWords: [
    "track", "review", "observe", "watch", "ask", "huddle", "debrief", "gather", "collect", "measure",
    "count", "map", "walk through", "shadow", "survey", "interview", "listen", "check in", "look into",
    "explore", "learn", "understand",
  ],
};
