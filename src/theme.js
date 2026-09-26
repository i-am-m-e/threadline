// theme.js — the Light / Dark / Auto switch.
//
// "Auto" follows your Mac's appearance setting; "Light" and "Dark" ignore it.
// It works by setting data-theme="light" or "dark" on the <html> element, which
// styles.css uses to pick a set of colors. The choice is remembered on this Mac.

import { icons } from "./icons.js";

const CHOICES = [
  { id: "system", label: "Auto", icon: icons.monitor, next: "light" },
  { id: "light", label: "Light", icon: icons.sun, next: "dark" },
  { id: "dark", label: "Dark", icon: icons.moon, next: "system" },
];

let current = "system";

/** Apply the saved theme and make every `.theme-button` on the page cycle through the choices. */
export function initTheme() {
  try {
    current = localStorage.getItem("theme") ?? "system";
  } catch {
    // Storage unavailable: just use Auto.
  }
  apply();
  for (const button of document.querySelectorAll(".theme-button")) {
    button.addEventListener("click", () => {
      current = CHOICES.find((c) => c.id === current).next;
      try {
        localStorage.setItem("theme", current);
      } catch {
        // Not important enough to bother you about.
      }
      apply();
    });
  }
}

function apply() {
  const choice = CHOICES.find((c) => c.id === current) ?? CHOICES[0];
  if (choice.id === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice.id;

  for (const button of document.querySelectorAll(".theme-button")) {
    button.title = `Appearance: ${choice.label} (click to change)`;
    button.innerHTML = choice.icon(16) + (button.dataset.label ? `<span>${choice.label}</span>` : "");
  }

  // Match the window's title bar too (null = follow the Mac).
  window.__TAURI__?.window?.getCurrentWindow().setTheme(choice.id === "system" ? null : choice.id).catch(() => {});
}
