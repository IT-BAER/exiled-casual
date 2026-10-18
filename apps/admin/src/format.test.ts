import { describe, expect, it } from "vitest";
import {
  countryName,
  flagEmoji,
  formatAgo,
  formatBytes,
  formatDuration,
  formatHours,
  formatNumber,
  formatPct,
  formatTime,
  rarityTier,
} from "./format";

describe("format helpers", () => {
  it("formats durations in two units at most", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(42.7)).toBe("42s");
    expect(formatDuration(65)).toBe("1m 05s");
    expect(formatDuration(3600)).toBe("1h 00m");
    expect(formatDuration(3 * 3600 + 7 * 60 + 59)).toBe("3h 07m");
    expect(formatDuration(2 * 86400 + 4 * 3600)).toBe("2d 04h");
    expect(formatDuration(-5)).toBe("0s");
  });

  it("formats hours with one decimal", () => {
    expect(formatHours(0)).toBe("0.0");
    expect(formatHours(5400)).toBe("1.5");
    expect(formatHours(360000)).toBe("100.0");
  });

  it("formats bytes in 1024 steps", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(12.34 * 1024 * 1024)).toBe("12.3 MB");
    expect(formatBytes(300 * 1024 ** 3)).toBe("300 GB");
    expect(formatBytes(2.5 * 1024 ** 4)).toBe("2.5 TB");
  });

  it("formats shares as percents and numbers with grouping", () => {
    expect(formatPct(0)).toBe("0 %");
    expect(formatPct(0.4239)).toBe("42 %");
    expect(formatPct(0.4239, 1)).toBe("42.4 %");
    expect(formatPct(1)).toBe("100 %");
    expect(formatPct(null)).toBe("-");
    expect(formatNumber(1234567)).toBe("1,234,567");
    expect(formatNumber(0)).toBe("0");
  });

  it("maps sessions to an item rarity tier", () => {
    expect(rarityTier(0)).toBe("normal");
    expect(rarityTier(1)).toBe("normal");
    expect(rarityTier(2)).toBe("magic");
    expect(rarityTier(9)).toBe("magic");
    expect(rarityTier(10)).toBe("rare");
    expect(rarityTier(49)).toBe("rare");
    expect(rarityTier(50)).toBe("unique");
    expect(rarityTier(5000)).toBe("unique");
  });

  it("formats local times and ages", () => {
    expect(formatTime(new Date(2026, 9, 18, 14, 5, 9).getTime())).toBe("2026-10-18 14:05");
    const now = 1_800_000_000_000;
    expect(formatAgo(now - 90_000, now)).toBe("1m 30s ago");
    expect(formatAgo(now + 5_000, now)).toBe("0s ago");
  });

  it("turns ISO country codes into flags and English names", () => {
    expect(flagEmoji("DE")).toBe("\u{1F1E9}\u{1F1EA}");
    expect(flagEmoji("us")).toBe("\u{1F1FA}\u{1F1F8}");
    expect(flagEmoji("XYZ")).toBe("");
    expect(flagEmoji(null)).toBe("");
    expect(countryName("DE")).toBe("Germany");
    expect(countryName("T1")).toBe("T1");
    expect(countryName(null)).toBe("Unknown");
  });
});
