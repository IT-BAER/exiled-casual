import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, sanitize, type Settings } from "../settings";
import { FIRST_MAP_TIP, TIPS, pickTip } from "../tips";
import { MAP_ENTERED_CAP, hasEnteredMap, markMapEntered, showsMapPointer } from "./first-map";

const ID = "3f1c2a9e-0000-4000-8000-000000000001";
const at = (area: "hideout" | "map", level = 1) => ({ area, player: { level } });

describe("the first-map pointer", () => {
  it("shows in the hideout of a new character", () => {
    expect(showsMapPointer(DEFAULT_SETTINGS, ID, at("hideout"))).toBe(true);
  });

  it("is not shown inside a map, nor before the first snapshot", () => {
    expect(showsMapPointer(DEFAULT_SETTINGS, ID, at("map"))).toBe(false);
    expect(showsMapPointer(DEFAULT_SETTINGS, ID, null)).toBe(false);
  });

  it("goes for good once the character has entered a map", () => {
    const after = markMapEntered(DEFAULT_SETTINGS, ID);
    expect(hasEnteredMap(after, ID)).toBe(true);
    expect(showsMapPointer(after, ID, at("hideout"))).toBe(false);
    // Persisted through the settings blob, the way the roster stores it.
    const reloaded = sanitize(JSON.parse(JSON.stringify(after)));
    expect(showsMapPointer(reloaded, ID, at("hideout"))).toBe(false);
  });

  it("is per character", () => {
    const after = markMapEntered(DEFAULT_SETTINGS, ID);
    expect(showsMapPointer(after, "another-character", at("hideout"))).toBe(true);
  });

  it("never shows for a character past level 1, who has been in a map before the list existed", () => {
    expect(showsMapPointer(DEFAULT_SETTINGS, ID, at("hideout", 2))).toBe(false);
  });

  it("never shows in the lab, which has no character", () => {
    expect(hasEnteredMap(DEFAULT_SETTINGS, "")).toBe(true);
    expect(showsMapPointer(DEFAULT_SETTINGS, "", at("hideout"))).toBe(false);
  });

  it("marking twice changes nothing, so it cannot loop a settings write", () => {
    const once = markMapEntered(DEFAULT_SETTINGS, ID);
    expect(markMapEntered(once, ID)).toBe(once);
  });

  it("keeps the newest ids when the list is full", () => {
    let s: Settings = DEFAULT_SETTINGS;
    for (let i = 0; i < MAP_ENTERED_CAP + 5; i++) s = markMapEntered(s, `c${i}`);
    expect(s.ui.mapEntered).toHaveLength(MAP_ENTERED_CAP);
    expect(hasEnteredMap(s, `c${MAP_ENTERED_CAP + 4}`)).toBe(true);
    expect(hasEnteredMap(s, "c0")).toBe(false);
  });

  it("a hand-edited list loses what is not an id", () => {
    const s = sanitize({ ui: { mapEntered: [ID, 7, "", "x".repeat(65), null, ID] } });
    expect(s.ui.mapEntered).toEqual([ID]);
    expect(sanitize({ ui: { mapEntered: "nope" } }).ui.mapEntered).toEqual([]);
    expect(sanitize({}).ui.mapEntered).toEqual([]);
  });
});

describe("the first load's tip", () => {
  it("is the map device tip for a character that has not entered a map", () => {
    expect(pickTip(() => 0.99, true)).toBe(FIRST_MAP_TIP);
    expect(FIRST_MAP_TIP).toMatch(/map device/i);
  });

  it("is random otherwise", () => {
    expect(pickTip(() => 0)).toBe(TIPS[0]);
    expect(pickTip(() => 0, false)).toBe(TIPS[0]);
  });
});
