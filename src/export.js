// export.js — turns a thread into a Markdown document you can save and share.
//
// Markdown is plain text with light formatting (# headings, **bold**), so the file
// reads fine in any text editor and looks formatted in apps like Notion, Obsidian
// or GitHub. Citations become footnotes that quote the passage they point to.

import { replaceCitations, passagePlace } from "./passages.js";

/**
 * @param {object} thread
 * @param {object} thread.conversation  The saved thread (title, messages, links…).
 * @param {Array} thread.documents      Its documents, in the order they were added.
 * @param {(docId: string) => Array} thread.passagesOf  A document's passages.
 * @param {Map<string, number>} thread.numberOf  Passage key → the citation number shown on screen.
 * @param {(modelId: string) => string} thread.modelLabel
 * @returns {string} The Markdown text.
 */
export function threadToMarkdown({ conversation, documents, passagesOf, numberOf, modelLabel }) {
  const docById = (id) => documents.find((d) => d.id === id);
  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");
  const out = [];

  out.push(`# ${conversation.title}`, "");
  out.push(`*Exported from Threadline on ${when(new Date().toISOString())}*`, "");

  // Sources
  if (documents.length > 0) {
    out.push("## Sources", "");
    documents.forEach((doc, i) => {
      const unit = doc.pageUnit === "sheet" ? "sheet" : "page";
      const size = doc.pages ? ` · ${doc.pages} ${unit}${doc.pages === 1 ? "" : "s"}` : "";
      out.push(`${i + 1}. **${doc.name}** (${doc.type ?? "file"}${size}, added ${when(doc.addedAt)})`);
    });
    out.push("");
  }

  // The conversation
  out.push("## Thread", "");
  for (const msg of conversation.messages) {
    const attachments = msg.attachments ?? (msg.attachment ? [msg.attachment] : []);
    if (attachments.length > 0 && attachments.some((a) => docById(a.id))) {
      const names = attachments.filter((a) => docById(a.id)).map((a) => a.name).join(", ");
      out.push(`> 📎 *Documents added: ${names}* · ${when(msg.time ?? attachments[0].addedAt)}`, "");
    }
    if (msg.role === "user" && msg.kind === "link") {
      out.push(`**You linked** · ${when(msg.time)}`, "", `↔ ${msg.text}`, "");
    } else if (msg.role === "user" && msg.text) {
      out.push(`**You** · ${when(msg.time)}`, "", msg.text, "");
    } else if (msg.role === "assistant") {
      const model = msg.model ? ` · ${modelLabel(msg.model)}` : "";
      // [3] → [^3], using the same numbers you see on screen.
      const known = Object.fromEntries(
        Object.entries(msg.citations ?? {}).filter(([, ref]) => docById(ref.docId))
      );
      const text = replaceCitations(msg.text, known, (n) => {
        const number = numberOf.get(`${known[n].docId}#${known[n].index}`);
        return number ? `[^${number}]` : "";
      });
      out.push(`**Threadline** · ${when(msg.time)}${model}`, "", text, "");
    }
  }

  // Links you drew
  const describe = (id) => {
    if (id.startsWith("s:")) return docById(id.slice(2))?.name ?? "a removed document";
    const msg = conversation.messages[Number(id.replace(/^m(\d+).*$/, "$1"))];
    const text = (msg?.text ?? "").replace(/\s+/g, " ");
    const attached = msg?.attachments ?? (id.endsWith("d") && msg?.attachment ? [msg.attachment] : null);
    if (attached) return `the documents added (${attached.map((a) => a.name).join(", ")})`;
    return `“${text.length > 60 ? text.slice(0, 60) + "…" : text}”`;
  };
  if (conversation.links?.length) {
    out.push("## Links", "");
    for (const link of conversation.links) out.push(`- ${describe(link.a)} ↔ ${describe(link.b)}`);
    out.push("");
  }

  // Footnotes: every cited passage, quoted in full.
  if (numberOf.size > 0) {
    out.push("## Citations", "");
    for (const [key, number] of [...numberOf].sort((a, b) => a[1] - b[1])) {
      const [docId, index] = key.split("#");
      const doc = docById(docId);
      const passage = doc && passagesOf(docId)?.[Number(index)];
      if (!passage) continue;
      const place = passagePlace(passage, doc.pageUnit);
      out.push(`[^${number}]: ${doc.name}${place ? `, ${place}` : ""}: “${passage.text.replace(/\s+/g, " ")}”`);
    }
    out.push("");
  }

  return out.join("\n");
}
