// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { applyCursor } from "./cursor";

afterEach(() => { delete document.documentElement.dataset["cursorStyle"]; });

describe("applyCursor", () => {
  it("marks the page root, which is what index.html's cursor rules key on", () => {
    applyCursor("gilt");
    expect(document.documentElement.getAttribute("data-cursor-style")).toBe("gilt");
    applyCursor("plain");
    expect(document.documentElement.getAttribute("data-cursor-style")).toBe("plain");
  });
});
