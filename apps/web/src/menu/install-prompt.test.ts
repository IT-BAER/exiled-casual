// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { captureInstallPrompt, installPrompt, _resetInstallPrompt } from "./install-prompt";

afterEach(() => _resetInstallPrompt());

/** What Chrome and Edge fire once the page is installable. */
function offer(target: EventTarget) {
  const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  e.prompt = vi.fn(() => Promise.resolve());
  e.userChoice = Promise.resolve({ outcome: "accepted" });
  target.dispatchEvent(e);
  return e;
}

describe("the install prompt", () => {
  it("is unavailable until the browser offers one (Firefox, Safari)", () => {
    captureInstallPrompt(window);
    expect(installPrompt()).toBeNull();
  });

  it("holds the browser's offer back for the menu, then prompts once", async () => {
    captureInstallPrompt(window);
    const e = offer(window);
    expect(e.defaultPrevented).toBe(true);
    const install = installPrompt();
    expect(install).not.toBeNull();
    await install!();
    expect(e.prompt).toHaveBeenCalledTimes(1);
    // A prompt can be shown once; after it the offer is spent.
    expect(installPrompt()).toBeNull();
  });

  it("is gone once the game is installed", () => {
    captureInstallPrompt(window);
    offer(window);
    window.dispatchEvent(new Event("appinstalled"));
    expect(installPrompt()).toBeNull();
  });
});
