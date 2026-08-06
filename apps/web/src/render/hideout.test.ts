// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Matrix, NullEngine, Scene, Vector3 } from "@babylonjs/core";
import { HIDEOUT_DECOR, SCREEN_SQUARE, hideoutFootprints } from "@exiled/content-runtime";
import { buildHideoutDecor, clearHideoutDecor } from "./hideout";
import { PROP_KINDS } from "./props";
import { CAMERA_ALPHA } from "./engine";

/**
 * The camera looks along the world diagonal, so a placement's world coordinates say
 * nothing about where it lands on screen. Screen x runs right across the frame and
 * screen y up it, both measured from the player's arrival point.
 */
function toScreen(x: number, z: number): { sx: number; sy: number } {
  const r = Math.SQRT1_2;
  return { sx: (x + z) * r, sy: (z - x) * r };
}

/** Half the ortho view, in world units. The camera shows about 19 by 9.5. */
const HALF_W = 9.5;
const HALF_H = 4.75;

describe("hideout decor", () => {
  it("asks only for props the asset actually carries", () => {
    for (const d of HIDEOUT_DECOR) expect(PROP_KINDS).toContain(d.kind);
  });

  /**
   * The first pass put all four columns at the world's corners, which is ten units
   * off the top of the frame: a prop nobody can see is a prop nobody asked for.
   */
  it("keeps every piece inside the frame", () => {
    for (const d of HIDEOUT_DECOR) {
      const { sx, sy } = toScreen(d.x, d.z);
      expect(Math.abs(sx), `${d.kind} sx`).toBeLessThan(HALF_W);
      expect(Math.abs(sy), `${d.kind} sy`).toBeLessThan(HALF_H);
    }
  });

  /**
   * The furniture must not stand where the game does. The device is the walk every
   * session starts with, and the two shops are the ones the player clicks.
   */
  it("stands clear of the player, the device and the two shops", () => {
    const busy: readonly { x: number; z: number; r: number }[] = [
      { x: 0, z: 0, r: 1.6 },            // where he arrives
      { x: -2.828, z: 2.828, r: 3.6 },   // the map device and its portal arc
      { x: -4.95, z: -2.121, r: 2.0 },   // the stash
      { x: 2.121, z: 4.95, r: 2.0 },     // the disenchanter
    ];
    for (const d of HIDEOUT_DECOR) {
      for (const b of busy) {
        const gap = Math.hypot(d.x - b.x, d.z - b.z);
        expect(gap, `${d.kind} at ${d.x.toFixed(1)},${d.z.toFixed(1)}`).toBeGreaterThan(b.r);
      }
    }
  });

  it("does not stack two pieces on one spot", () => {
    for (let i = 0; i < HIDEOUT_DECOR.length; i++) {
      for (let j = i + 1; j < HIDEOUT_DECOR.length; j++) {
        const a = HIDEOUT_DECOR[i]!;
        const b = HIDEOUT_DECOR[j]!;
        expect(Math.hypot(a.x - b.x, a.z - b.z), `${a.kind} vs ${b.kind}`).toBeGreaterThan(0.7);
      }
    }
  });

  /**
   * The decor list left the renderer so the sim can collide against it, and it
   * took the camera angle with it as a literal. If the camera ever leans a
   * different way, every long piece is turned across the frame instead of along
   * it — and the table's collision discs with it.
   */
  it("is still composed against the camera the client actually uses", () => {
    expect(SCREEN_SQUARE).toBeCloseTo(CAMERA_ALPHA, 10);
  });

  /**
   * ...and the sign of it, measured rather than asserted. Babylon takes a yawed
   * prop's local +X to (cos y, -sin y), and `at(1, 0)` is where the frame's own
   * right-hand direction lands in the world. They have to be the same vector, or
   * every long piece stands across the composition it was written for — which is
   * how a table ended up running up the screen with a bench under each end.
   */
  it("turns a long prop ALONG the frame, not up it", () => {
    const long = Vector3.TransformNormal(
      new Vector3(1, 0, 0), Matrix.RotationY(SCREEN_SQUARE));
    const r = Math.SQRT1_2;
    expect(long.x).toBeCloseTo(r, 6);
    expect(long.z).toBeCloseTo(r, 6);
  });

  /**
   * Furniture the player bumps into has to be furniture that is drawn: a disc
   * where nothing stands is an invisible wall, and both come from one list.
   */
  it("gives every solid piece a footprint that sits on it", () => {
    const solid = HIDEOUT_DECOR.filter((d) => d.kind !== "rug");
    const discs = hideoutFootprints();
    expect(discs.length).toBeGreaterThanOrEqual(solid.length);
    for (const disc of discs) {
      const nearest = Math.min(...solid.map((d) => Math.hypot(d.x - disc.x, d.z - disc.z)));
      expect(nearest).toBeLessThanOrEqual(0.7);
    }
    for (const d of solid) {
      const nearest = Math.min(...discs.map((disc) => Math.hypot(d.x - disc.x, d.z - disc.z)));
      expect(nearest, `${d.kind} has no footprint`).toBeLessThanOrEqual(0.7);
    }
  });

  /**
   * Without the asset there is nothing to greybox: every other prop falls back to
   * primitives because it has to stay clickable, and a rug does not have to be
   * anything at all.
   */
  it("builds nothing at all when the asset has not loaded", () => {
    const scene = new Scene(new NullEngine());
    buildHideoutDecor(scene);
    expect(scene.meshes.filter((m) => m.name.startsWith("hideout-decor-"))).toEqual([]);
  });

  it("clearing a scene that never had decor is safe", () => {
    const scene = new Scene(new NullEngine());
    expect(() => clearHideoutDecor(scene)).not.toThrow();
  });
});
