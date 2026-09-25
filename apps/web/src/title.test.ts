import { describe, it, expect } from "vitest";
import { GAME_NAME, titleFor } from "./title";

describe("titleFor", () => {
  it("names the place after the game", () => {
    expect(titleFor("Hideout")).toBe(`${GAME_NAME} - Hideout`);
  });

  it("is the bare game name when there is no place", () => {
    expect(titleFor()).toBe(GAME_NAME);
    expect(titleFor(null)).toBe(GAME_NAME);
    expect(titleFor("  ")).toBe(GAME_NAME);
  });

  it("falls back to the page's own title when there is no place", () => {
    const home = "Exiled Casual: a free browser ARPG";
    expect(titleFor(null, home)).toBe(home);
    expect(titleFor("  ", home)).toBe(home);
    expect(titleFor("Hideout", home)).toBe(`${GAME_NAME} - Hideout`);
  });

  it("never uses an em dash", () => {
    expect(titleFor("Vaal Foundry")).not.toContain("\u2014");
  });
});
