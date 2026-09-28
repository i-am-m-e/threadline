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
};
