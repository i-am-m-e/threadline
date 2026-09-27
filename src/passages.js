// passages.js — splits documents into numbered passages so the AI can cite them.
//
// How citations work:
//   1. Each document is cut into passages of roughly a paragraph (splitIntoPassages).
//   2. Every passage in the thread gets a number, and the AI is told:
//      "cite passages like [3]" (buildSourcesPrompt).
//   3. When a reply comes back, we find the [3]-style markers (findCitations)
//      and turn them into clickable citations on screen.
//
// Nothing here touches the screen or the AI directly, which keeps it easy to test.

const TARGET_PASSAGE_CHARS = 600; // longest a passage usually gets
const MIN_PASSAGE_CHARS = 80;     // shorter paragraphs (like headings) join the next one

// Version 2 of the cutting rules also starts a new passage at lines that begin with a
// clause number ("2.1 …"), a timestamp ("15:30 - …") or a Markdown heading ("## …"), so
// each policy clause and each log entry can be cited on its own. Documents attached
// before version 2 keep version 1, so the citations saved in old answers still line up.
export const CURRENT_SPLIT_VERSION = 2;
const STRUCTURE_LINE = /\n(?=\s*(?:\d+(?:\.\d+)+\s|\d{1,2}:\d{2}\s*[-–—]|#{1,6}\s))/g;

/**
 * Cut a document's text into passages.
 * PDF text has a "\f" (form feed) between pages, so we can say which page a passage is on.
 *
 * @param {string} text
 * @param {number} [version]  Which cutting rules to use (see CURRENT_SPLIT_VERSION).
 * @returns {Array<{index: number, page: number | null, start: number, end: number, text: string}>}
 *          start/end are character positions in `text`, used to highlight the passage later.
 */
export function splitIntoPassages(text, version = CURRENT_SPLIT_VERSION) {
  const passages = [];
  const pageTexts = text.split("\f");
  const hasPages = pageTexts.length > 1;
  let pageStart = 0;

  pageTexts.forEach((pageText, pageIndex) => {
    // Where we can cut: at paragraph breaks (best, so each section gets its own
    // number, which helps small models cite the right one) or at sentence ends.
    const endsOf = (pattern) => [...pageText.matchAll(pattern)].map((m) => m.index + m[0].length);
    const paragraphCuts = endsOf(/\n\s*\n/g);
    if (version >= 2) paragraphCuts.push(...endsOf(STRUCTURE_LINE));
    paragraphCuts.sort((a, b) => a - b);
    const sentenceCuts = endsOf(/[.!?]["')\]]*\s+/g);

    let start = 0;
    while (start < pageText.length) {
      const limit = start + TARGET_PASSAGE_CHARS;
      const within = (p) => p > start && p <= limit;
      // 1. the first paragraph break that isn't too early,
      // 2. else the last sentence end that fits,
      // 3. else (one enormous sentence) the last space that fits.
      let end =
        paragraphCuts.find((p) => within(p) && p - start >= MIN_PASSAGE_CHARS) ??
        (limit >= pageText.length ? pageText.length : sentenceCuts.filter(within).pop());
      if (!end) end = pageText.lastIndexOf(" ", limit) > start ? pageText.lastIndexOf(" ", limit) : limit;

      const raw = pageText.slice(start, end);
      const trimmed = raw.trim();
      if (trimmed) {
        const from = pageStart + start + (raw.length - raw.trimStart().length);
        passages.push({
          index: passages.length,
          page: hasPages ? pageIndex + 1 : null,
          start: from,
          end: from + trimmed.length,
          text: trimmed,
        });
      }
      start = end;
    }
    pageStart += pageText.length + 1; // +1 for the "\f" we split on
  });

  return passages;
}

/** Where a passage is, like "p. 4" or "sheet 2" (empty for files without pages). */
export function passagePlace(passage, pageUnit = "page") {
  if (!passage.page) return "";
  return pageUnit === "sheet" ? `sheet ${passage.page}` : `p. ${passage.page}`;
}

/** A short human label for a passage, like: p. 4 · "The warehouse in Denver stores…" */
export function passageLabel(passage, pageUnit = "page") {
  const words = passage.text.replace(/\s+/g, " ").split(" ");
  const snippet = words.slice(0, 7).join(" ") + (words.length > 7 ? "…" : "");
  const place = passagePlace(passage, pageUnit);
  return (place ? `${place} · ` : "") + `“${snippet}”`;
}

/**
 * Build the instructions + numbered passages we send to the AI.
 *
 * Every passage of every document gets a number (the same number every time, so
 * citations stay stable). Small threads send everything. When the documents are
 * bigger than `budgetChars`, only the passages most relevant to the question are
 * sent (see rankPassages), plus each document's opening and any passages cited
 * recently, so follow-up questions still work.
 *
 * @param {Array<{id, name, text, pageUnit?, passages?}>} documents  In the order they were added.
 *        (`passages` can be passed in to skip re-splitting big documents.)
 * @param {object} [options]
 * @param {string} [options.query]  The question, used to pick relevant passages.
 * @param {number} [options.budgetChars]  Roughly how much passage text to send.
 * @param {Set<string> | null} [options.onlyDocIds]  Only show these documents (e.g. the source you linked).
 * @param {Set<string>} [options.mustInclude]  Passage keys ("docId#index") to always send.
 * @param {"answer" | "gaps"} [options.task]  "gaps" asks for policy-vs-practice gaps instead of a normal answer.
 * @param {{text: string}} [options.rulePack]  Domain rules from formatRulePack(), added to the instructions.
 * Documents may carry a `trustLabel` ("Authoritative", "Observed", "Experiential"); each of their
 * passages is then tagged with it, so the AI knows which sources say what *should* happen and
 * which record what *did* happen.
 * @returns {{ prompt: string, numbers: Object<string, {docId, index}>, shown: number, total: number }}
 *          `numbers` maps each passage number the AI sees to where that passage lives.
 */
export function buildSourcesPrompt(documents, {
  query = "", budgetChars = 24000, onlyDocIds = null, mustInclude = new Set(), task = "answer", rulePack = null,
} = {}) {
  // 1. Number every passage in the thread (documents in the order they were added).
  const all = [];
  let n = 0;
  for (const doc of documents) {
    for (const passage of doc.passages ?? splitIntoPassages(doc.text)) {
      n += 1;
      if (!onlyDocIds || onlyDocIds.has(doc.id)) all.push({ n, doc, passage, key: `${doc.id}#${passage.index}` });
    }
  }

  // 2. Choose what to send.
  const totalChars = all.reduce((sum, c) => sum + c.passage.text.length, 0);
  let chosen;
  if (totalChars <= budgetChars) {
    chosen = all; // it all fits
  } else {
    const picked = new Set();
    let used = 0;
    const take = (c) => {
      if (picked.has(c) || used + c.passage.text.length > budgetChars) return;
      picked.add(c);
      used += c.passage.text.length;
    };
    all.filter((c) => mustInclude.has(c.key)).forEach(take);   // cited recently
    all.filter((c) => c.passage.index === 0).forEach(take);    // each document's opening
    rankPassages(all, query).forEach(take);                    // best matches for the question
    chosen = all.filter((c) => picked.has(c));                 // back in document order
  }

  // 3. Write it out, grouped by document.
  const numbers = {};
  const sections = [];
  for (const doc of documents) {
    const lines = chosen
      .filter((c) => c.doc === doc)
      .map((c) => {
        numbers[c.n] = { docId: doc.id, index: c.passage.index };
        const place = c.passage.page ? ` (${doc.pageUnit === "sheet" ? "sheet" : "page"} ${c.passage.page})` : "";
        const label = TRUST_LABELS[doc.trustLabel] ? ` [${doc.trustLabel}]` : "";
        return `[${c.n}]${label}${place} ${c.passage.text.replace(/\s+/g, " ")}`;
      });
    const kind = TRUST_LABELS[doc.trustLabel] ? ` — ${doc.trustLabel}: ${TRUST_LABELS[doc.trustLabel]}` : "";
    if (lines.length > 0) sections.push(`Document: "${doc.name}"${kind}\n${lines.join("\n")}`);
  }

  const partial = chosen.length < all.length
    ? `\n\n(These are the passages most relevant to the question, not the whole documents.)`
    : "";

  const labelled = documents.some((d) => TRUST_LABELS[d.trustLabel]);
  const trustNote = labelled
    ? `\n\nEach passage is tagged with where its authority comes from: ` +
      Object.entries(TRUST_LABELS).map(([name, meaning]) => `[${name}] = ${meaning}`).join("; ") +
      `. Keep them apart: a log shows what happened, not what the rule is.`
    : "";
  const rules = rulePack?.text ? `\n\n${rulePack.text}` : "";
  const intro = task === "gaps"
    ? "You are Threadline, an organizational intelligence assistant. You compare what policies require with what actually happened."
    : "You are Threadline, an assistant that answers questions using the user's documents.";
  const job = task === "gaps"
    ? `Go through every [Authoritative] passage one by one and check it against every [Observed] passage. ` +
      `Using only the numbered passages above, identify:\n` +
      `1. Each gap where [Observed] practice deviates from an [Authoritative] requirement. ` +
      `Cite at least one [Observed] passage AND the [Authoritative] passage it breaks.\n` +
      `2. What triggered each deviation (for example surge, weather, staffing), citing the passage that shows it.\n` +
      `3. The roles affected and the downstream risk.\n` +
      `If practice matches policy, say that no gap was detected. Do not invent requirements or events.`
    : `Answer using the numbered passages above.`;

  // The rules go AFTER the documents: small models follow what they read last best.
  const prompt =
    `${intro}\n\n` +
    sections.join("\n\n") + partial + trustNote +
    `\n\n${job} After each sentence that uses a passage, ` +
    `write that passage's number in square brackets, like [2]. Every fact from the documents ` +
    `needs a citation. Check the number matches the passage you used. ` +
    `If the documents don't cover the question, say so plainly instead of guessing.` +
    rules; // house rules go last: small models follow what they read last most closely

  return { prompt, numbers, shown: chosen.length, total: all.length };
}

// ---------- Trust labels ----------
// What kind of authority a source has. Labels are set per document; its passages inherit it.
// ("Inferred" and "Suggested" from the methodology describe the AI's *output*, so they
// aren't labels you'd put on a source document.)
export const TRUST_LABELS = {
  Authoritative: "what should happen (policies, SOPs, standards, regulations)",
  Observed: "what did happen (logs, incident reports, audits, minutes)",
  Experiential: "what people say (interviews, notes, commentary)",
};

/**
 * Suggest a trust label from a file's name, then its opening text. Returns null if unsure,
 * so the person can choose. It's only a starting guess: always let the person change it.
 */
export function guessTrustLabel(name, text = "") {
  const patterns = [
    ["Authoritative", /\b(policy|policies|sop|procedure|standard|guideline|regulation|protocol|bylaw|code of)\b|document id:\s*(pol|sop)/i],
    ["Observed", /\b(log|logs|report|incident|near[- ]?miss|audit|minutes|handover|shift|census|inspection)\b/i],
    ["Experiential", /\b(interview|transcript|notes|feedback|survey|comment|comments|debrief)\b/i],
  ];
  const readable = (s) => s.replace(/[_\-.]+/g, " ");
  for (const source of [readable(name), text.slice(0, 400)]) {
    for (const [label, pattern] of patterns) if (pattern.test(source)) return label;
  }
  return null;
}

// ---------- Domain rule packs (from domain_rules.json) ----------
/**
 * Turn one domain's saved rules into short instructions for the AI.
 * The store looks like: { "Healthcare": { acronyms: {CTAS: "…"}, user_overrides: [{pattern, action, weight}] } }.
 * Malformed entries are skipped, long text is trimmed, and only the `maxRules` highest-weight
 * overrides are used (every rule costs room in the prompt).
 *
 * @returns {{ text: string, applied: Array<{pattern, action}> }}  `applied` lists the rules used,
 *          so the interface can show which house rules shaped an answer.
 */
export function formatRulePack(domain, store, { maxRules = 12 } = {}) {
  const pack = store?.[domain];
  if (!domain || !pack || typeof pack !== "object") return { text: "", applied: [] };
  const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 300);

  const acronyms = Object.entries(pack.acronyms ?? {})
    .filter(([short, long]) => clean(short) && clean(long))
    .slice(0, 40)
    .map(([short, long]) => `- ${clean(short)} = ${clean(long)}`);

  const applied = (Array.isArray(pack.user_overrides) ? pack.user_overrides : [])
    .map((r) => ({ pattern: clean(r?.pattern), action: clean(r?.action), weight: Number(r?.weight) || 0 }))
    .filter((r) => r.pattern && r.action && r.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxRules);

  const parts = [];
  if (acronyms.length) parts.push(`${clean(domain)} terms:\n${acronyms.join("\n")}`);
  if (applied.length) {
    parts.push(
      `House rules for ${clean(domain)}, set by the user. When a situation matches a rule, apply it and ` +
        `use the rule's wording (for example "Classified as: …") in your answer:\n` +
        applied.map((r) => `- When: ${r.pattern} → ${r.action}`).join("\n")
    );
  }
  return { text: parts.join("\n\n"), applied: applied.map(({ pattern, action }) => ({ pattern, action })) };
}

/**
 * Evidence you can check, instead of a confidence score: how many distinct passages of each
 * trust label a reply cites. A gap claim that cites no Observed passage, or no Authoritative
 * one, isn't supported by both sides.
 * @returns {{ Authoritative: number, Observed: number, Experiential: number, Unlabelled: number }}
 */
export function citationEvidence(reply, numbers, trustLabelOf) {
  const counts = { Authoritative: 0, Observed: 0, Experiential: 0, Unlabelled: 0 };
  const seen = new Set();
  for (const c of findCitations(reply)) {
    for (const n of c.numbers) {
      const ref = numbers[n];
      if (!ref || seen.has(n)) continue;
      seen.add(n);
      const label = trustLabelOf(ref.docId);
      counts[label in counts ? label : "Unlabelled"] += 1;
    }
  }
  return counts;
}

/**
 * Check a gap analysis claim by claim. A gap needs evidence from both sides: something
 * that happened ([Observed]) and the rule it breaks ([Authoritative]). Claims (list items or
 * paragraphs) that cite only one side are returned, so the interface can mark them
 * "unsupported" instead of presenting them as findings.
 * @returns {Array<{claim: string, missing: "Observed" | "Authoritative"}>}
 */
export function unsupportedGapClaims(reply, numbers, trustLabelOf) {
  const claims = reply
    .split(/\n\s*\n|\n(?=\s*(?:[-*•]|\d+[.)])\s)/)
    .map((c) => c.trim())
    .filter((c) => findCitations(c).length > 0 && !/^(\s*\[\d+\]\s*)+$/.test(c)); // skip bare "[2] [3]" lines
  const problems = [];
  for (const claim of claims) {
    const labels = new Set(
      findCitations(claim).flatMap((c) => c.numbers).map((n) => numbers[n] && trustLabelOf(numbers[n].docId))
    );
    for (const side of ["Observed", "Authoritative"]) {
      if (!labels.has(side)) problems.push({ claim, missing: side });
    }
  }
  return problems;
}

// ---------- Finding the passages that match a question ----------
// BM25, a standard way search engines rank text: a passage scores higher when it
// contains the question's words, especially rare ones (a word that appears in every
// passage, like "policy", counts for little; "weekend" counts for a lot).

const STOP_WORDS = new Set((
  "a an and are as at be been but by can could did do does for from had has have how i if in into is it " +
  "its me my no not of on or our so than that the their them then there these they this those to was we " +
  "were what when where which who why will with would you your about any all also after before between " +
  "document documents passage passages please tell explain show find should take need use get give make " +
  "know say says said like just more most some such very"
).split(" "));

export function words(text) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)); // "reviews" → "review"
}

/** Passages ordered best match first. With no useful words in the query, earlier passages come first. */
export function rankPassages(candidates, query) {
  const queryList = words(query);
  const queryWords = [...new Set(queryList)];
  // Neighbouring words in the question ("chest pain", "red flags") score extra when
  // they also appear side by side in a passage.
  const pairs = [...new Set(queryList.slice(1).map((w, i) => `${queryList[i]} ${w}`))];
  if (queryWords.length === 0) return [...candidates].sort((a, b) => a.passage.index - b.passage.index);

  const docsWords = candidates.map((c) => words(c.passage.text));
  const averageLength = docsWords.reduce((sum, w) => sum + w.length, 0) / (docsWords.length || 1);
  const containing = Object.fromEntries(
    queryWords.map((q) => [q, docsWords.filter((w) => w.includes(q)).length])
  );
  const k1 = 1.2;
  const b = 0.75;
  const rarity = (q) => Math.log(1 + (candidates.length - containing[q] + 0.5) / (containing[q] + 0.5));
  const scored = candidates.map((c, i) => {
    const w = docsWords[i];
    let score = 0;
    for (const q of queryWords) {
      const count = w.filter((x) => x === q).length;
      if (count === 0) continue;
      score += rarity(q) * ((count * (k1 + 1)) / (count + k1 * (1 - b + (b * w.length) / averageLength)));
    }
    if (score > 0 && pairs.length > 0) {
      const joined = ` ${w.join(" ")} `;
      for (const pair of pairs) {
        if (joined.includes(` ${pair} `)) score += pair.split(" ").reduce((sum, q) => sum + rarity(q), 0);
      }
    }
    return { c, score };
  });
  return scored.filter((s) => s.score > 0).sort((x, y) => y.score - x.score).map((s) => s.c);
}

/** A short reminder added to the user's latest question (small models forget the rules). */
export const CITE_REMINDER = "\n\n(Cite passage numbers like [2].)";

// Matches [3], [3, 5], [3][5] (as two matches) and [Passage 3]. It skips Markdown
// links like [3](https://…) because a link has "(" straight after the "]".
const CITATION_PATTERN = /\[(?:passages?\s*)?(\d+(?:\s*[,;]\s*\d+)*)\](?!\()/gi;

/**
 * Find citation markers in a reply.
 * @param {string} text
 * @returns {Array<{match: string, at: number, numbers: number[]}>}
 */
export function findCitations(text) {
  return [...text.matchAll(CITATION_PATTERN)].map((m) => ({
    match: m[0],
    at: m.index,
    numbers: m[1].split(/[,;]/).map((s) => Number(s.trim())),
  }));
}

/** Remove citation markers, e.g. before re-sending an old answer (its numbers may not apply any more). */
export function stripCitations(text) {
  return text.replace(/\s?\[(?:passages?\s*)?\d+(?:\s*[,;]\s*\d+)*\](?!\()/gi, "");
}

/**
 * Replace citation markers with the output of `makeMarker(number)`, in one pass.
 * Numbers the AI made up (not in `known`) are left as plain text.
 */
export function replaceCitations(text, known, makeMarker) {
  return text.replace(CITATION_PATTERN, (whole, list) => {
    const numbers = list.split(/[,;]/).map((s) => Number(s.trim()));
    if (!numbers.every((num) => num in known)) return whole;
    return numbers.map(makeMarker).join("");
  });
}
