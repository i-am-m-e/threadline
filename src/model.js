// model.js — the ONE place in the app that talks to an AI model.
//
// Nothing else in the app knows (or cares) that we use Ollama. The rest of
// the app only calls getModelResponse(messages, onProgress) and gets back a string.
// To switch to a cloud API later, rewrite the inside of this function and
// keep its inputs and output the same.

const OLLAMA_URL = "http://localhost:11434/api/chat";
const MODEL_NAME = "llama3.2";

/**
 * Send a conversation to the AI and get its reply.
 *
 * @param {Array<{role: "user" | "assistant" | "system", content: string}>} messages
 *        The conversation so far, oldest first. The last one is usually the
 *        user's newest message.
 * @param {(textSoFar: string) => void} [onProgress]
 *        Optional. Called repeatedly while the reply is being written, each time
 *        with all of the reply received so far.
 * @returns {Promise<string>} The AI's complete reply text.
 * @throws {Error} With a human-readable message if something goes wrong.
 */
export async function getModelResponse(messages, onProgress) {
  let response;
  try {
    response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: messages,
        stream: true, // send the reply in small pieces as it's written
        // How much text (in "tokens", roughly ¾ of a word each) the model can
        // read at once. Big enough for a long attached document plus the chat.
        options: { num_ctx: 16384 },
      }),
    });
  } catch (err) {
    // fetch() itself fails when nothing is listening on that address.
    throw new Error("Couldn't reach Ollama. Is it running? (Try opening the Ollama app.)");
  }

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Ollama returned an error (${response.status}): ${details}`);
  }

  // Ollama streams one small JSON object per line, like:
  //   {"message": {"role": "assistant", "content": "Hel"}, "done": false}
  //   {"message": {"role": "assistant", "content": "lo!"}, "done": false}
  // We read the lines as they arrive and add each piece to the full reply.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let unfinishedLine = ""; // a line can be split across two network chunks
  let reply = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = (unfinishedLine + decoder.decode(value, { stream: true })).split("\n");
    unfinishedLine = lines.pop(); // the last piece may be incomplete; keep it for next time

    for (const line of lines) {
      if (!line.trim()) continue;
      const data = JSON.parse(line);
      if (data.error) throw new Error(`Ollama error: ${data.error}`);
      reply += data.message?.content ?? "";
    }
    if (onProgress) onProgress(reply);
  }

  return reply;
}
