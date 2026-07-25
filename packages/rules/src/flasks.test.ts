import { describe, it, expect } from "vitest";
import { flaskRecovery, FLASK_RECOVERY_PCT } from "./flasks.js";

describe("flaskRecovery", () => {
  it("returns 30% of max floored", () => {
    expect(flaskRecovery(100)).toBe(30);
    expect(flaskRecovery(33)).toBe(Math.floor((33 * FLASK_RECOVERY_PCT) / 100));
  });

  it("is never negative for max 0", () => {
    expect(flaskRecovery(0)).toBe(0);
  });
});
