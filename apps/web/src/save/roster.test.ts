import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryKv, emptyRoster, loadRoster, saveRoster } from "@exiled/persistence";
import { DEFAULT_SETTINGS } from "../settings";
import {
  SETTINGS_DEBOUNCE_MS,
  flushSettingsSave,
  saveSettingsSoon,
  setKv,
  settingsOf,
} from "./roster";

let store: MemoryKv;

beforeEach(() => {
  store = new MemoryKv();
  setKv(store);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  setKv(null);
});

describe("settingsOf", () => {
  it("reads defaults from a roster that has never had settings", () => {
    expect(settingsOf(emptyRoster())).toEqual(DEFAULT_SETTINGS);
  });

  it("sanitizes whatever was on the disk rather than trusting it", () => {
    const roster = { ...emptyRoster(), settings: { sound: { master: 99 } } };
    expect(settingsOf(roster).sound.master).toBe(1);
  });
});

describe("saveSettingsSoon", () => {
  it("writes once for a burst, with the last value", async () => {
    const roster = emptyRoster();
    for (let i = 1; i <= 10; i++) {
      saveSettingsSoon(roster, {
        ...DEFAULT_SETTINGS,
        sound: { ...DEFAULT_SETTINGS.sound, master: i / 10, muted: false },
      });
    }
    expect(store.writes).toBe(0); // nothing yet: the burst is still inside the window
    await vi.advanceTimersByTimeAsync(SETTINGS_DEBOUNCE_MS + 10);
    await flushSettingsSave();
    expect(store.writes).toBe(1);
    const saved = await loadRoster(store);
    expect((saved!.settings as { sound: { master: number } }).sound.master).toBeCloseTo(1);
  });

  it("keeps everything else in the blob", async () => {
    const roster = { ...emptyRoster(), stash: { keep: true } };
    await saveRoster(store, roster);
    saveSettingsSoon(roster, DEFAULT_SETTINGS);
    await vi.advanceTimersByTimeAsync(SETTINGS_DEBOUNCE_MS + 10);
    await flushSettingsSave();
    const saved = await loadRoster(store);
    expect(saved!.stash).toEqual({ keep: true });
  });
});
