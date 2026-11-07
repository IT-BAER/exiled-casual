// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { applyCursor, cursorCss, trackCursorPress } from "./cursor";
import { PRESS_HOTSPOT_X } from "./cursor-frames.generated";

afterEach(() => {
  document.getElementById("cursor-css")?.remove();
  delete document.documentElement.dataset["cursorPress"];
});

describe("cursorCss", () => {
  it("draws the chosen look at the chosen size, 1x and 2x, tip on the hotspot", () => {
    const css = cursorCss("plain", "medium");
    expect(css).toContain("url(/textures/ui/cursor_plain_24.png) 1x, url(/textures/ui/cursor_plain_48.png) 2x) 0 0");
    expect(css).toContain("url(/textures/ui/cursor_plain_deny_24.png) 1x, url(/textures/ui/cursor_plain_deny_48.png) 2x) 0 0");
    expect(css).toContain(
      `url(/textures/ui/cursor_plain_press_24.png) 1x, url(/textures/ui/cursor_plain_press_48.png) 2x) ${PRESS_HOTSPOT_X.plain[24]} 0`,
    );
  });

  it("names the gilt blade's files without a look prefix, at 32 for huge", () => {
    const css = cursorCss("gilt", "huge");
    expect(css).toContain("url(/textures/ui/cursor_32.png) 1x, url(/textures/ui/cursor_64.png) 2x)");
    expect(css).toContain("url(/textures/ui/cursor_press_32.png) 1x, url(/textures/ui/cursor_press_64.png) 2x)");
    expect(css).not.toContain("cursor_plain");
  });

  it("lets a refusal outrank the press tilt", () => {
    expect(cursorCss("plain", "small")).toContain(':root[data-cursor-press] [data-cursor="deny"]');
  });
});

describe("applyCursor", () => {
  it("keeps one style element and rewrites it", () => {
    applyCursor("gilt", "large");
    applyCursor("plain", "small");
    const styles = document.querySelectorAll("#cursor-css");
    expect(styles).toHaveLength(1);
    expect(styles[0]!.textContent).toBe(cursorCss("plain", "small"));
  });
});

describe("trackCursorPress", () => {
  const press = (type: string, buttons: number) =>
    window.dispatchEvent(new MouseEvent(type, { buttons }));
  const pressed = () => document.documentElement.hasAttribute("data-cursor-press");

  it("marks the root while any button is held and clears it on release or blur", () => {
    const stop = trackCursorPress();
    press("pointerdown", 1);
    expect(pressed()).toBe(true);
    press("pointerup", 0);
    expect(pressed()).toBe(false);
    press("pointerdown", 2);
    window.dispatchEvent(new Event("blur"));
    expect(pressed()).toBe(false);
    press("pointerdown", 1);
    press("pointermove", 0); // released outside the window
    expect(pressed()).toBe(false);
    stop();
    press("pointerdown", 1);
    expect(pressed()).toBe(false);
  });
});
