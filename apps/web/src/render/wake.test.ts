// @vitest-environment node
import { describe, it, expect } from "vitest";
import type { Shoreline } from "@exiled/mapgen";
import { WAKE_CELL, WAKE_CELLS, WAKE_SPEED, WakeField, WakeStirrer, seaDepth, shoreDepth, type Footfall } from "./wake";

/** A straight shore: `cross` = 0 along the whole run, from -20 to +20. */
function straightShore(along: "x" | "y", seaSide: 1 | -1): Shoreline {
  return { along, start: -20, step: 0.5, cross: new Float32Array(81), seaSide };
}

/** Distance along +x from `x0` to the ring's leading edge: the furthest point
 *  standing a tenth of the line's largest swing from rest. */
function frontOut(field: WakeField, x0: number, z: number, reach: number): number {
  let peak = 0;
  for (let r = 0; r < reach; r += 0.02) peak = Math.max(peak, Math.abs(field.height(x0 + r, z)));
  let at = 0;
  for (let r = 0; r < reach; r += 0.02) if (Math.abs(field.height(x0 + r, z)) > peak * 0.1) at = r;
  return at;
}

describe("WakeField", () => {
  it("spreads a disturbance as a ring at the wave speed", () => {
    const field = new WakeField();
    field.follow(10, 4);
    field.push(10, 4, 0.2, 0.05);
    field.step(0.5);
    const a = frontOut(field, 10, 4, 6);
    field.step(0.5);
    const b = frontOut(field, 10, 4, 6);
    expect(b - a).toBeGreaterThan(WAKE_SPEED * 0.5 * 0.85);
    expect(b - a).toBeLessThan(WAKE_SPEED * 0.5 * 1.15);
  });

  it("keeps a ripple where it is in the world while the window follows the player", () => {
    const field = new WakeField();
    field.follow(0, 0);
    field.push(2, -1, 0.2, 0.05);
    field.step(0.3);
    const probe = [[2.6, -1], [2, -0.4], [1.5, -1.3]] as const;
    const before = probe.map(([x, z]) => field.height(x, z));
    field.follow(3.3, 1.7);
    probe.forEach(([x, z], k) => expect(field.height(x, z)).toBeCloseTo(before[k]!, 9));
    expect(Math.abs(before[0]!)).toBeGreaterThan(1e-4);
    // Further than the window reaches: the ripple is gone, nothing wraps round.
    field.follow(40, 0);
    expect(field.height(2, -1)).toBe(0);
    expect(field.height(42, -1)).toBe(0);
  });

  it("measures metres out to sea on either axis and either side", () => {
    expect(seaDepth(straightShore("x", 1), 3, 1.5)).toBeCloseTo(1.5);
    expect(seaDepth(straightShore("x", 1), 3, -1)).toBeCloseTo(-1);
    expect(seaDepth(straightShore("y", -1), -2, 7)).toBeCloseTo(2);
    expect(seaDepth(straightShore("y", -1), 4, 7)).toBeCloseTo(-4);
  });

  it("keeps waves off the dry beach", () => {
    const field = new WakeField();
    field.setDepth(shoreDepth(straightShore("x", 1)));
    field.follow(0, 0);
    field.push(0, 0.5, 0.2, 0.05);
    field.step(1.5);
    let dry = 0, wet = 0;
    for (let x = -4; x <= 4; x += 0.1) {
      dry = Math.max(dry, Math.abs(field.height(x, -3)));
      wet = Math.max(wet, Math.abs(field.height(x, 1.5)));
    }
    expect(dry).toBe(0);
    expect(wet).toBeGreaterThan(1e-4);
  });

  it("dies out within seconds and then falls asleep", () => {
    const field = new WakeField();
    field.follow(0, 0);
    expect(field.asleep).toBe(true);
    field.push(0, 0, 0.2, 0.05);
    expect(field.asleep).toBe(false);
    field.step(0.2);
    const early = Math.abs(field.height(WAKE_SPEED * 0.2, 0));
    field.step(4);
    let late = 0;
    for (let r = 0; r < 8; r += 0.05) late = Math.max(late, Math.abs(field.height(r, 0)));
    expect(late).toBeLessThan(early * 0.05);
    field.step(4);
    expect(field.asleep).toBe(true);
    expect(field.height(0, 0)).toBe(0);
  });

  it("packs height, slope and foam for the shader, and uploads nothing while asleep", () => {
    const field = new WakeField();
    const out = new Uint8Array(WAKE_CELLS * WAKE_CELLS * 4);
    field.follow(0, 0);
    expect(field.pack(out)).toBe(false);
    field.push(0, 0, 0.25, 0.03);
    field.step(1 / 60);
    expect(field.pack(out)).toBe(true);
    const byte = (x: number, z: number, ch: number): number =>
      out[(Math.floor((z - field.originZ) / WAKE_CELL) * WAKE_CELLS + Math.floor((x - field.originX) / WAKE_CELL)) * 4 + ch]!;
    expect(byte(0, 0, 0)).toBeGreaterThan(128);
    // Downhill away from the raised centre, on both axes.
    expect(byte(0.2, 0, 1)).toBeLessThan(128);
    expect(byte(-0.2, 0, 1)).toBeGreaterThan(128);
    expect(byte(0, 0.2, 2)).toBeLessThan(128);
    // Something running through the water churns it white behind itself.
    for (let k = 0; k < 40; k++) {
      field.push(-2 + k * 0.1, 1, 0.3, -0.02);
      field.step(1 / 60);
    }
    field.pack(out);
    let foam = 0;
    for (let k = 3; k < out.length; k += 4) foam = Math.max(foam, out[k]!);
    expect(foam).toBeGreaterThan(60);
    field.step(10);
    expect(field.asleep).toBe(true);
    // One last upload clears the texture, then none.
    expect(field.pack(out)).toBe(true);
    expect(out.every((v, k) => (k % 4 === 3 ? v === 0 : v === 128))).toBe(true);
    expect(field.pack(out)).toBe(false);
  });

  it("keeps white water it was given until it has faded, then sleeps", () => {
    const field = new WakeField();
    const out = new Uint8Array(WAKE_CELLS * WAKE_CELLS * 4);
    field.follow(0, 0);
    field.foamAt(0.5, -0.5, 0.3, 0.8);
    expect(field.asleep).toBe(false);
    field.step(0.1);
    field.pack(out);
    const at = (Math.floor((-0.5 - field.originZ) / WAKE_CELL) * WAKE_CELLS + Math.floor((0.5 - field.originX) / WAKE_CELL)) * 4 + 3;
    expect(out[at]).toBeGreaterThan(100);
    field.step(10);
    expect(field.asleep).toBe(true);
    field.pack(out);
    expect(out[at]).toBe(0);
  });
});

describe("WakeStirrer", () => {
  /** Walk one body along the shore at `cross` metres out, `speed` m/s, for `metres`. */
  function walk(cross: number, metres: number, speed = 4.2) {
    const field = new WakeField();
    const shore = straightShore("x", 1);
    field.setDepth(shoreDepth(shore));
    const stirrer = new WakeStirrer(field, shoreDepth(shore));
    const falls: Footfall[] = [];
    const out: Footfall[] = [];
    const dt = 1 / 60;
    for (let t = 0, x = 0; x <= metres; t += dt, x += speed * dt) {
      field.follow(x, cross);
      stirrer.stir([{ id: 7, x, z: cross, radius: 0.5, player: true }], dt, out);
      field.step(dt);
      falls.push(...out);
    }
    return { field, falls };
  }

  it("splashes a footfall every stride while wading and stirs the water", () => {
    const { field, falls } = walk(1, 6);
    expect(falls.length).toBeGreaterThanOrEqual(4);
    expect(falls.length).toBeLessThanOrEqual(6);
    expect(falls.every((f) => f.depth > 0.5 && f.player)).toBe(true);
    expect(field.asleep).toBe(false);
  });

  it("rings white water round the legs of anything wading, even at a walk", () => {
    const { field } = walk(1, 3, 1.5);
    const out = new Uint8Array(WAKE_CELLS * WAKE_CELLS * 4);
    field.pack(out);
    const foamAt = (x: number, z: number): number =>
      out[(Math.floor((z - field.originZ) / WAKE_CELL) * WAKE_CELLS + Math.floor((x - field.originX) / WAKE_CELL)) * 4 + 3]!;
    expect(foamAt(3, 1)).toBeGreaterThan(150);
    // A trail that fades: a second behind him it is half gone; well behind, clear.
    expect(foamAt(1.5, 1)).toBeLessThan(foamAt(2.7, 1) * 0.5);
    expect(foamAt(0.2, 1)).toBeLessThan(40);
  });

  it("leaves the water alone on dry sand", () => {
    const { field, falls } = walk(-5, 6);
    expect(falls).toEqual([]);
    expect(field.asleep).toBe(true);
  });

  it("does not splash across a jump such as a portal", () => {
    const field = new WakeField();
    const shore = straightShore("x", 1);
    field.setDepth(shoreDepth(shore));
    field.follow(0, 1);
    const stirrer = new WakeStirrer(field, shoreDepth(shore));
    const out: Footfall[] = [];
    stirrer.stir([{ id: 3, x: -6, z: 1, radius: 0.5, player: true }], 1 / 60, out);
    stirrer.stir([{ id: 3, x: 0, z: 1, radius: 0.5, player: true }], 1 / 60, out);
    expect(out).toEqual([]);
    expect(field.asleep).toBe(true);
  });
});
