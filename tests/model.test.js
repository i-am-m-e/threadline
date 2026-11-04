// Tests for src/model.js: what happens when Ollama is slow, sends something unreadable, or
// sends nothing. A stand-in for fetch plays Ollama's part; nothing here talks to Ollama.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getModelResponse } from "../src/model.js";

const enc = new TextEncoder();
const line = (content, done = false) => JSON.stringify({ message: { role: "assistant", content }, done }) + "\n";

/**
 * A stand-in for fetch. `chunks` are sent in order; "HANG" means stop sending (until aborted).
 * `hangBeforeHeaders` means it never even answers.
 */
function fakeFetch(chunks, { hangBeforeHeaders = false } = {}) {
  return (url, { signal } = {}) => new Promise((resolve, reject) => {
    const aborted = () => Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    signal?.addEventListener("abort", () => reject(aborted()));
    if (hangBeforeHeaders) return;
    const body = new ReadableStream({
      async start(controller) {
        signal?.addEventListener("abort", () => controller.error(aborted()));
        for (const c of chunks) {
          if (c === "HANG") return;
          controller.enqueue(enc.encode(c));
          await new Promise((r) => setTimeout(r, 1));
        }
        controller.close();
      },
    });
    resolve(new Response(body, { status: 200 }));
  });
}
const ask = (chunks, opts = {}) =>
  getModelResponse([{ role: "user", content: "hi" }], { fetch: fakeFetch(chunks, opts), idleTimeoutMs: 50, ...opts });

test("a normal streamed reply is put together", async () => {
  assert.equal(await ask([line("Hel"), line("lo"), line("", true)]), "Hello");
});

test("a last line without a closing newline is still read", async () => {
  assert.equal(await ask([line("Hel"), line("lo").trim()]), "Hello");
});

test("a reply that stops arriving gives a clear time-out message", async () => {
  await assert.rejects(ask([line("Hel"), "HANG"]), /stopped responding/);
});

test("Ollama never answering at all also times out", async () => {
  await assert.rejects(ask([], { hangBeforeHeaders: true }), /stopped responding/);
});

test("a slow but steady reply is not cut off (the time limit is for silence, not total time)", async () => {
  const chunks = [];
  for (let i = 0; i < 10; i++) chunks.push(line("x"));
  const slowFetch = (url, init) => fakeFetch(chunks)(url, init).then((res) => {
    const reader = res.body.getReader();
    return new Response(new ReadableStream({
      async pull(c) {
        await new Promise((r) => setTimeout(r, 20)); // 20 ms between pieces, 200 ms in total
        const { done, value } = await reader.read();
        done ? c.close() : c.enqueue(value);
      },
    }));
  });
  assert.equal(await getModelResponse([{ role: "user", content: "hi" }], { fetch: slowFetch, idleTimeoutMs: 50 }), "xxxxxxxxxx");
});

test("a garbled line gives a readable message, not a parser error", async () => {
  await assert.rejects(ask([line("Hel"), "{not json\n"]), (err) => /couldn't read/.test(err.message) && !(err instanceof SyntaxError));
});

test("an empty reply is refused instead of being saved", async () => {
  await assert.rejects(ask([line(""), line("  ", true)]), /empty reply/);
});

test("Ollama's own error message is passed on", async () => {
  await assert.rejects(ask([JSON.stringify({ error: "model crashed" }) + "\n"]), /Ollama error: model crashed/);
});

test("an error reply that stalls while being read still gives the plain time-out message", async () => {
  const stallingError = (url, { signal } = {}) => Promise.resolve(new Response(new ReadableStream({
    start(c) { signal?.addEventListener("abort", () => c.error(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }))); },
  }), { status: 500 }));
  await assert.rejects(getModelResponse([{ role: "user", content: "hi" }], { fetch: stallingError, idleTimeoutMs: 50 }), /stopped responding/);
});
