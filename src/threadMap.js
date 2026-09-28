// threadMap.js — the Thread map (review-first), drawn with Cytoscape and the dagre layout.
// Based on the renderer in docs/threadline-spec-v3.2.md, section 12. (It lives here rather
// than in lines.js, which already draws the citation lines in chat.)
//
// Encoding: shape = node type, colour = trust label, dashed = unconfirmed (Inferred or
// Suggested), line thickness = number of supporting records. Tapping a node shows its
// source records or evidence items (provenance on demand).

import cytoscape from "./vendor/cytoscape.esm.min.mjs";

export const TRUST_COLORS = {
  Authoritative: "#2A9D8F", Observed: "#B87333", Historical: "#4A5568",
  Experiential: "#D69E2E", Inferred: "#E76F51", Suggested: "#805AD5",
};
export const SHAPES = {
  evidence: "round-rectangle", policy: "rectangle", condition: "diamond",
  role: "ellipse", effect: "hexagon", approach: "tag",
};

// The dagre layout is an older-style script: load it (and its Cytoscape adapter) once.
let dagreReady = null;
function ensureDagre() {
  dagreReady ??= (async () => {
    if (!window.dagre) await loadScript("./vendor/dagre.min.js");
    if (!window.cytoscapeDagre) await loadScript("./vendor/cytoscape-dagre.js");
    cytoscape.use(window.cytoscapeDagre);
  })();
  return dagreReady;
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.append(s);
  });
}

/**
 * The analysis graph plus the options from Prompt 3 as "approach" nodes (Suggested),
 * linked from the main effect nodes (or role nodes, if there are no effects) with
 * "may reduce". "may reduce" is only ever used for these code-added edges.
 */
export function withApproaches(graph, options) {
  const nodes = graph.nodes.map((n) => ({ ...n }));
  const edges = graph.edges.map((e) => ({ ...e }));
  const anchors = nodes.filter((n) => n.node_type === "effect").length
    ? nodes.filter((n) => n.node_type === "effect")
    : nodes.filter((n) => n.node_type === "role");
  for (const o of options) {
    const id = `approach-${o.option_id}`;
    nodes.push({
      id, label: o.title.split(/\s+/).slice(0, 6).join(" "), node_type: "approach", trust_label: "Suggested",
      source_ids: [], evidence_ids: o.evidence_ids, option_id: o.option_id,
    });
    for (const a of anchors) edges.push({ source: a.id, target: id, relationship: "may reduce", weight: 1, inferred: true });
  }
  return { nodes, edges };
}

/**
 * Draw the map in a container.
 * @param {HTMLElement} container
 * @param {{nodes, edges}} graph  From withApproaches().
 * @param {(nodeData) => void} onNodeTap
 * @param {"TB" | "LR"} direction  Top-to-bottom (default) or left-to-right.
 * @returns {Promise<object>} The Cytoscape instance (call .destroy() before redrawing).
 */
export async function renderThreadMap(container, graph, onNodeTap, direction = "TB") {
  await ensureDagre();
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue("--ink").trim() || "#15181c";
  const ink3 = css.getPropertyValue("--ink3").trim() || "#737b88";
  const bg = css.getPropertyValue("--bg").trim() || "#ffffff";

  const cy = cytoscape({
    container,
    elements: [
      ...graph.nodes.map((n) => ({
        data: { ...n, color: TRUST_COLORS[n.trust_label] || "#999", shape: SHAPES[n.node_type] || "ellipse" },
      })),
      ...graph.edges.map((e, i) => ({ data: { id: `e${i}`, weight: 1, ...e } })),
    ],
    style: [
      { selector: "node", style: {
          "background-color": "data(color)", shape: "data(shape)", width: 34, height: 34,
          label: "data(label)", "text-wrap": "wrap", "text-max-width": 110, color: ink,
          "font-size": 11, "text-valign": "bottom", "text-margin-y": 6 } },
      { selector: 'node[trust_label = "Inferred"], node[trust_label = "Suggested"]', style: {
          "border-width": 2, "border-style": "dashed", "border-color": ink, "background-opacity": 0.6 } },
      { selector: "node:selected", style: { "border-width": 3, "border-color": ink, "border-style": "solid" } },
      { selector: "edge", style: {
          width: "mapData(weight, 1, 5, 1, 5)", "line-color": "#999",
          "target-arrow-shape": "triangle", "target-arrow-color": "#999",
          "curve-style": "bezier", label: "data(relationship)", "font-size": 9, color: ink3,
          "text-background-color": bg, "text-background-opacity": 0.85, "text-background-padding": 2 } },
      { selector: "edge[?inferred]", style: { "line-style": "dashed" } },
      { selector: 'edge[relationship = "conflicts with"]', style: { "line-color": "#E76F51", "target-arrow-color": "#E76F51" } },
      { selector: 'edge[relationship = "may reduce"]', style: { "line-color": "#805AD5", "target-arrow-color": "#805AD5" } },
    ],
    // Spacing is wider than the spec example (40) so long labels on the same row don't overlap.
    layout: { name: "dagre", rankDir: direction, nodeSep: 90, rankSep: 90 },
    wheelSensitivity: 0.3,
  });

  // Tapping a node surfaces its source records or evidence (provenance on demand).
  cy.on("tap", "node", (evt) => onNodeTap && onNodeTap(evt.target.data()));
  return cy;
}
