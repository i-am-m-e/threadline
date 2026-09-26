// lines.js — draws the lines on the see-through layer over the window (#lines):
//   • traces: citation → its source (while hovered or pinned)
//   • links:  the connections you make by dragging a dot onto something
//   • drag:   the dashed line following your pointer while you drag
//
// app.js works out where each line starts and ends (in window coordinates) and
// calls drawLines() whenever anything moves.

// Each source in a thread gets its own line style, so you can tell whose line is whose.
// A style is a color (--src-0 … --src-5 in styles.css, with light and dark versions)
// plus a dash pattern. The first 6 sources are solid in 6 colors, the next 6 dashed,
// then dotted, then dash-dot: 24 different styles before any repeats.
// (With round line ends, a 0.1-long dash draws as a dot.)
const COLOR_COUNT = 6;
const DASHES = [null, "7 5", "0.1 5", "10 4 0.1 4"];
export const styleFor = (sourceIndex) => sourceIndex % (COLOR_COUNT * DASHES.length);
export const colorOf = (style) => (style === "thread" ? "var(--thread)" : `var(--src-${style % COLOR_COUNT})`);
const dashOf = (style) => (style === "thread" ? null : DASHES[Math.floor(style / COLOR_COUNT) % DASHES.length]);

/** A small sample of a source's line (shown on its card, like a map legend). */
export function swatch(style, width = 24) {
  const dash = dashOf(style);
  return (
    `<svg class="swatch" width="${width}" height="6" viewBox="0 0 ${width} 6" aria-hidden="true">` +
    `<line x1="2" y1="3" x2="${width - 2}" y2="3" stroke="${colorOf(style)}" stroke-width="2" ` +
    `stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ""}/></svg>`
  );
}

// A smooth S-shaped curve from a to b (the formula from the design handoff).
export function curve(a, b) {
  if (Math.abs(b.x - a.x) < 40) {
    // Nearly above each other: bow out to the left instead.
    const bx = Math.min(a.x, b.x) - 50;
    return `M${a.x} ${a.y} C${bx} ${a.y} ${bx} ${b.y} ${b.x} ${b.y}`;
  }
  const d = Math.max(40, Math.abs(b.x - a.x) * 0.45);
  const s = b.x >= a.x ? 1 : -1;
  return `M${a.x} ${a.y} C${a.x + d * s} ${a.y} ${b.x - d * s} ${b.y} ${b.x} ${b.y}`;
}

// Lines already on screen, so we don't replay the "draw in" animation every time
// something scrolls and the lines get redrawn in their new positions.
let onScreen = new Set();

/**
 * @param {SVGElement} svg
 * @param {object} what
 * @param {Array<{key, from, to, style}>} what.traces  style: a source style number
 * @param {Array<{key, from, to, style, index, faded}>} what.links  style: a number, or "thread" (copper);
 *        faded: one end is scrolled out of view (the line is drawn lighter)
 * @param {{from, to} | null} what.drag
 */
export function drawLines(svg, { traces = [], links = [], drag = null }) {
  const defs = [];
  const parts = [];
  const drawnNow = new Set();

  // One line: a background-colored "halo" underneath (keeps it readable over text),
  // then the colored line. New lines are revealed by an animated mask ("draw in"),
  // which works for dashed and dotted lines too.
  const line = (key, d, style, width, faded = false) => {
    const isNew = !onScreen.has(key);
    drawnNow.add(key);
    let mask = "";
    if (isNew) {
      const id = `reveal-${key.replace(/[^\w-]/g, "_")}`;
      defs.push(
        `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%">` +
          `<path d="${d}" class="reveal" pathLength="1"/></mask>`
      );
      mask = ` mask="url(#${id})"`;
    }
    const dash = dashOf(style);
    parts.push(
      `<g${mask}${faded ? ' class="is-faded"' : ""}>` +
        `<path d="${d}" class="line-halo" style="stroke-width:${width + 4}px"/>` +
        `<path d="${d}" class="line" style="stroke:${colorOf(style)};stroke-width:${width}px"` +
        `${dash ? ` stroke-dasharray="${dash}"` : ""}/>` +
        `</g>`
    );
  };

  for (const t of traces) {
    line(t.key, curve(t.from, t.to), t.style, 2);
    parts.push(
      `<circle cx="${t.from.x}" cy="${t.from.y}" r="13" class="line-ring" style="stroke:${colorOf(t.style)}"/>`,
      `<circle cx="${t.to.x}" cy="${t.to.y}" r="4" style="fill:${colorOf(t.style)}"/>`
    );
  }

  for (const l of links) {
    const d = curve(l.from, l.to);
    line(l.key, d, l.style, 2.25, l.faded);
    const dotClass = l.faded ? ' class="is-faded"' : "";
    parts.push(
      `<circle cx="${l.from.x}" cy="${l.from.y}" r="3.5"${dotClass} style="fill:${colorOf(l.style)}"/>`,
      `<circle cx="${l.to.x}" cy="${l.to.y}" r="3.5"${dotClass} style="fill:${colorOf(l.style)}"/>`,
      // A wide invisible line on top makes the link easy to click (to remove it).
      `<path d="${d}" class="link-hit" data-link-index="${l.index}"><title>Click to remove link</title></path>`
    );
  }

  if (drag) {
    parts.push(
      `<path d="${curve(drag.from, drag.to)}" class="line drag-line"/>`,
      `<circle cx="${drag.to.x}" cy="${drag.to.y}" r="5" class="drag-dot"/>`
    );
  }

  onScreen = drawnNow;
  svg.innerHTML = `<defs>${defs.join("")}</defs>${parts.join("")}`;
}
