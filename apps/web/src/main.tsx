import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Retire the first-boot cover (`index.html`'s `#boot`) once React has painted.
 *
 * `requestAnimationFrame` twice, not once: the first fires before the commit
 * this render schedules, so lifting the cover there uncovers the empty page the
 * cover existed to hide. The second is after it.
 *
 * Removed rather than hidden, because it is a fixed full-screen element with a
 * background image, and one left in the tree is one the compositor keeps paying
 * for on every frame of the game behind it.
 */
const boot = document.getElementById("boot");
if (boot) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      boot.classList.add("gone");
      boot.addEventListener("transitionend", () => boot.remove(), { once: true });
      // A cover that outlives its own fade because the transition never fired
      // (reduced motion, a background tab) is a cover that never goes away.
      setTimeout(() => boot.remove(), 600);
    });
  });
}

/**
 * Install the service worker, in a real build only.
 *
 * It is what makes the game installable from the browser's own menu and what
 * makes the second visit come off the disk. Under Vite's dev server it would
 * serve yesterday's modules back to a developer editing today's, so it is not
 * registered there — and any worker left over from a production build on the
 * same origin is torn out instead.
 */
if ("serviceWorker" in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        /* An install that fails costs the offline cache and nothing else. */
      });
    });
  } else {
    void navigator.serviceWorker.getRegistrations?.()
      .then((regs) => regs.forEach((r) => void r.unregister()))
      .catch(() => {});
  }
}
