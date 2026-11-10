// model.js — the ONE place in the app that talks to an AI model.
//
// Nothing else in the app knows (or cares) that we use Ollama. The rest of
// the app only calls getModelResponse(messages, { model, onProgress }) and gets
// back a string. To switch to a cloud API later, rewrite the inside of this
// file (including the MODELS list) and keep the function's inputs and output the same.

const OLLAMA_URL = "http://localhost:11434/api/chat";

// The models you can pick from in the app. `id` is the name Ollama knows it by.
export const MODELS = [
  { id: "command-r", label: "Command R" },
  { id: "qwen3:8b", label: "Qwen3 8B" },
];
export const DEFAULT_MODEL = "command-r";

// When you link two things, this model reviews the connection, whatever model the
// thread uses. Command R handled comparisons best in testing.
export const LINK_REVIEW_MODEL = "command-r";

/** The model to use for a saved choice: falls back to the default if it's missing or no longer offered. */
export function resolveModel(id) {
  return MODELS.some((m) => m.id === id) ? id : DEFAULT_MODEL;
}

// If Ollama sends nothing at all for this long, give up with a clear message rather than
// waiting forever. This is a limit on SILENCE, not on total time: a long reply that keeps
// arriving is never cut off. Generous, because loading a model and reading a long prompt
// can take a few minutes before the first word arrives.
export const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Send a conversation to the AI and get its reply.
 *
 * @param {Array<{role: "user" | "assistant" | "system", content: string}>} messages
 *        The conversation so far, oldest first. The last one is usually the
 *        user's newest message.
 * @param {object} [options]
 * @param {string} [options.model]  Which model answers (an `id` from MODELS). Defaults to DEFAULT_MODEL.
 * @param {(textSoFar: string) => void} [options.onProgress]
 *        Called repeatedly while the reply is being written, each time
 *        with all of the reply received so far.
 * @param {object} [options.format]  A JSON Schema. When given, the model can only answer with
 *        JSON matching it (Ollama's "structured outputs"). Used by Signals, via src/llm.js.
 * @param {number} [options.temperature]  0 = most predictable, 1 = most varied. Leave out for the model's default.
 * @param {number} [options.idleTimeoutMs]  See IDLE_TIMEOUT_MS (tests use a short one).
 * @param {Function} [options.fetch]  Stand-in for fetch (tests only).
 * @returns {Promise<string>} The AI's complete reply text (never empty).
 * @throws {Error} With a human-readable message if something goes wrong.
 */
export async function getModelResponse(messages, {
  model = DEFAULT_MODEL, onProgress, format, temperature, idleTimeoutMs = IDLE_TIMEOUT_MS, fetch: fetchImpl = globalThis.fetch,
} = {}) {
  // How much text (in "tokens", roughly ¾ of a word each) the model can
  // read at once. Big enough for a long attached document plus the chat.
  const options = { num_ctx: 16384 };
  if (temperature !== undefined) options.temperature = temperature;

  // The silence timer: restarted every time something arrives; if it runs out, the request
  // is cancelled and we say so plainly.
  const controller = new AbortController();
  let timedOut = false;
  let timer;
  const restartTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, idleTimeoutMs);
  };
  const timeoutError = () => new Error(
    `Ollama stopped responding (nothing arrived for ${Math.round(idleTimeoutMs / 1000)} seconds). ` +
    "Check that the Ollama app is running, then try again."
  );

  try {
    restartTimer();
    let response;
    try {
      response = await fetchImpl(OLLAMA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: model,
          messages: messages,
          stream: true, // send the reply in small pieces as it's written
          options,
          ...(format ? { format } : {}),
        }),
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) throw timeoutError();
      // fetch() itself fails when nothing is listening on that address.
      throw new Error("Couldn't reach Ollama. Is it running? (Try opening the Ollama app.)");
    }

    if (response.status === 404) {
      throw new Error(`The model "${model}" isn't installed in Ollama. In Terminal, run: ollama pull ${model}`);
    }
    if (!response.ok) {
      let details = "";
      try {
        details = await response.text();
      } catch {
        if (timedOut) throw timeoutError();
      }
      throw new Error(`Ollama returned an error (${response.status}): ${details}`);
    }

    // Ollama streams one small JSON object per line, like:
    //   {"message": {"role": "assistant", "content": "Hel"}, "done": false}
    //   {"message": {"role": "assistant", "content": "lo!"}, "done": false}
    // We read the lines as they arrive and add each piece to the full reply.
    // (Thinking models like qwen3 first send their reasoning in a separate
    // "thinking" field; we skip that and only keep the answer in "content".)
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let unfinishedLine = ""; // a line can be split across two network chunks
    let reply = "";
    const readLine = (line) => {
      if (!line.trim()) return;
      let data;
      try {
        data = JSON.parse(line);
      } catch {
        throw new Error("Threadline couldn't read part of Ollama's reply (it wasn't in the expected format). Try again.");
      }
      if (data.error) throw new Error(`Ollama error: ${data.error}`);
      reply += data.message?.content ?? "";
    };

    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (timedOut) throw timeoutError();
        throw new Error(`The connection to Ollama broke off mid-reply (${err.message}). Try again.`);
      }
      const { done, value } = chunk;
      if (done) break;
      restartTimer();

      const lines = (unfinishedLine + decoder.decode(value, { stream: true })).split("\n");
      unfinishedLine = lines.pop(); // the last piece may be incomplete; keep it for next time
      for (const line of lines) readLine(line);
      if (onProgress) onProgress(reply);
    }
    readLine(unfinishedLine + decoder.decode()); // a last line without a closing newline

    if (!reply.trim()) throw new Error("The model sent an empty reply. Try again.");
    return reply;
  } finally {
    clearTimeout(timer);
  }
}
