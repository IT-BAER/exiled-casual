import { describe, it, expect } from "vitest";
import { fp, isqrt, fpDist2 } from "@pact/fixed-point";
import { ARENA_RADIUS, clampToArena } from "./movement";

const BODY = fp(0.5); // 500

describe("clampToArena", () => {
  it("origin is unchanged", () => {
    const r = clampToArena(0, 0, BODY);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it("point well inside is unchanged", () => {
    const x = fp(5);
    const y = fp(3);
    const r = clampToArena(x, y, BODY);
    expect(r.x).toBe(x);
    expect(r.y).toBe(y);
  });

  it("point exactly on the limit is unchanged", () => {
    // limit = ARENA_RADIUS - BODY = fp(14) - fp(0.5) = 13500
    const limit = ARENA_RADIUS - BODY; // 13500
    const r = clampToArena(limit, 0, BODY);
    expect(r.x).toBe(limit);
    expect(r.y).toBe(0);
  });

  it("point far outside is clamped to at most the limit", () => {
    const limit = ARENA_RADIUS - BODY; // 13500
    const tol = 3; // allow a few fixed-point units of truncation
    const r = clampToArena(fp(100), 0, BODY);
    const d = isqrt(fpDist2(0, 0, r.x, r.y));
    expect(d).toBeLessThanOrEqual(limit + tol);
    // and close enough (within tol)
    expect(d).toBeGreaterThanOrEqual(limit - tol);
  });

  it("direction is preserved: sign and rough ratio", () => {
    const x = fp(30);
    const y = fp(20);
    const r = clampToArena(x, y, BODY);
    // same signs
    expect(Math.sign(r.x)).toBe(Math.sign(x));
    expect(Math.sign(r.y)).toBe(Math.sign(y));
    // roughly same ratio (within 1%)
    const origRatio = x / y;
    const clampRatio = r.x / r.y;
    expect(Math.abs(clampRatio - origRatio) / origRatio).toBeLessThan(0.01);
  });

  it("negative coordinates are clamped with correct sign", () => {
    const limit = ARENA_RADIUS - BODY;
    const tol = 3;
    const r = clampToArena(fp(-50), fp(-50), BODY);
    expect(r.x).toBeLessThan(0);
    expect(r.y).toBeLessThan(0);
    const d = isqrt(fpDist2(0, 0, r.x, r.y));
    expect(d).toBeLessThanOrEqual(limit + tol);
  });
});
