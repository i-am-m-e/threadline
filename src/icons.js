// icons.js — the few Lucide icons (lucide.dev) the design uses, as inline SVG.
// Each one draws with `currentColor`, so it takes the color of the text around it.

const lucide = (paths, strokeWidth = 1.5) => (size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const icons = {
  plus: lucide('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  search: lucide('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  paperclip: lucide('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
  arrowUp: lucide('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', 1.8),
  fileText: lucide('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/>'),
  x: lucide('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  pencil: lucide('<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/>'),
  panelRight: lucide('<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M15 3v18"/>'),
  clock: lucide('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'),
  chevronDown: lucide('<path d="m6 9 6 6 6-6"/>'),
  sun: lucide('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>'),
  moon: lucide('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  monitor: lucide('<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>'),
};

// The Threadline mark from the design: a wavy copper line with a hollow and a filled circle.
export const logo = (size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 22 22" fill="none" aria-hidden="true">` +
  `<path d="M1 11c3-4 6-4 10 0s7 4 10 0" stroke="var(--thread)" stroke-width="1.5" stroke-linecap="round"/>` +
  `<circle cx="6" cy="8.6" r="2.6" fill="var(--panel)" stroke="var(--thread)" stroke-width="1.5"/>` +
  `<circle cx="16" cy="13.4" r="3" fill="var(--thread)"/></svg>`;
