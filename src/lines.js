// lines.js — draws the copper lines between citations and their sources.
//
// The lines live on one see-through SVG layer covering the whole window
// (#lines in index.html). app.js works out where each line starts and ends
// (in window coordinates) and calls drawLines() whenever anything moves.

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
// the page scrolls and the lines get redrawn in their new positions.
let onScreen = new Set();

/**
 * @param {SVGElement} svg
 * @param {Array<{key: string, from: {x, y}, to: {x, y}}>} traces
 *        key identifies a line between redraws (e.g. which citation it starts at).
 */
export function drawLines(svg, traces) {
  const parts = [];
  const drawnNow = new Set();

  for (const { key, from, to } of traces) {
    const d = curve(from, to);
    const animate = onScreen.has(key) ? "" : " draw-in";
    parts.push(
      // A wider line in the background color first, so the copper line stays
      // readable where it crosses text.
      `<path d="${d}" class="line-halo${animate}" pathLength="1"/>`,
      `<path d="${d}" class="line${animate}" pathLength="1"/>`,
      `<circle cx="${from.x}" cy="${from.y}" r="13" class="line-ring"/>`,
      `<circle cx="${to.x}" cy="${to.y}" r="4" class="line-dot"/>`
    );
    drawnNow.add(key);
  }

  onScreen = drawnNow;
  svg.innerHTML = parts.join("");
}
