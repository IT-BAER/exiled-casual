/**
 * The browser's install offer, held for the roster to make at the right moment.
 *
 * Chrome and Edge fire `beforeinstallprompt` once the page is installable (the
 * service worker makes it so), usually seconds after boot and long before the
 * player has a reason to install. Its default is a mini-infobar on mobile;
 * holding the event lets the roster offer it after a session instead, when the
 * next goal is on screen. Firefox and Safari never fire it, so they never see
 * the offer.
 */
import React from "react";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

let offered: InstallEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => { for (const l of listeners) l(); };

/** Start listening. Call once at boot, before the browser can fire the offer. */
export function captureInstallPrompt(target: Window = window): void {
  target.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    offered = e as InstallEvent;
    changed();
  });
  target.addEventListener("appinstalled", () => {
    offered = null;
    changed();
  });
}

/** Show the browser's install dialog, or null when there is no offer. One use: a second prompt() throws. */
export function installPrompt(): (() => Promise<void>) | null {
  const e = offered;
  if (!e) return null;
  return () => {
    offered = null;
    changed();
    return e.prompt();
  };
}

/** Whether an offer is held, re-rendering when that changes. */
export function useInstallOffer(): boolean {
  return React.useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => offered !== null,
  );
}

/** Test seam. */
export function _resetInstallPrompt(): void {
  offered = null;
  changed();
}
