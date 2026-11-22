// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Matrix, NullEngine, Scene, Vector3, VertexBuffer } from "@babylonjs/core";
import { HIDEOUT_DECOR, HIDEOUT_FLOOR, HIDEOUT_SERVICES, ROT_STEP, SCREEN_SQUARE, decorDiscs, hideoutFootprints } from "@exiled/content-runtime";
import { HIDEOUT_EDGE_NAME, buildHideoutDecor, clearHideoutDecor } from "./hideout";
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
    for (const x of HIDEOUT_DECOR.flatMap((d) => d.extras ?? [])) {
      if (x.kind !== "atlasModel") expect(PROP_KINDS).toContain(x.kind);
    }
  });

  /**
   * The owner's layout: each shop table runs DOWN the frame, a few degrees off
   * true, with its person behind it on the outer long side, facing across it into
   * the room. Measured through Babylon's own rotation, so a sign slip shows as a
   * table across the frame.
   */
  for (const [kind, table] of [["vendor", "vendor-counter"], ["cartographer", "carto-table"]] as const) {
    it(`runs ${table} down the frame with ${kind} behind it`, () => {
      const t = HIDEOUT_DECOR.find((d) => d.id === table)!;
      const npc = HIDEOUT_SERVICES[kind];
      const along = Vector3.TransformNormal(new Vector3(1, 0, 0), Matrix.RotationY(t.yaw));
      const dir = toScreen(along.x, along.z);
      const offTrue = Math.abs((Math.atan2(dir.sx, -dir.sy) * 180) / Math.PI);
      expect(dir.sy, "runs down").toBeLessThan(0);
      expect(offTrue, "off true vertical").toBeGreaterThan(2);
      expect(offTrue, "off true vertical").toBeLessThan(ROT_STEP / 2);
      // The person stands off the long side away from the room's centre, inside the
      // table's length, clear of its edge.
      const rel = toScreen(npc.x - t.x, npc.z - t.z);
      const lengthwise = Math.abs(rel.sx * dir.sx + rel.sy * dir.sy);
      const out = (rel.sx * -dir.sy + rel.sy * dir.sx) * Math.sign(toScreen(t.x, t.z).sx);
      expect(lengthwise, "within the length").toBeLessThan(1.1 * (t.scale?.x ?? 1) - 0.4);
      expect(out, "behind the outer edge").toBeGreaterThan(0.475 * (t.scale?.z ?? 1) + 0.25);
      // Facing across it: the camera is PI, a quarter turn toward the room, plus the table's tilt.
      const across = Math.sign(toScreen(t.x, t.z).sx) * Math.PI / 2;
      expect(npc.yaw - 3.14159).toBeCloseTo(across + t.yaw - Math.PI / 4, 6);
    });
  }

  /** The sim collides on the nearest whole step, so a drawn table may stray at most half of one. */
  it("collides every long piece within half a rotation step of where it is drawn", () => {
    const hit = hideoutFootprints();
    for (const d of HIDEOUT_DECOR) {
      for (const c of decorDiscs(d, d.x, d.z, [Math.cos(d.yaw), Math.sin(d.yaw)])) {
        const nearest = Math.min(...hit.map((h) => Math.hypot(h.x - c.x, h.z - c.z)));
        expect(nearest, d.id).toBeLessThan(0.15);
      }
    }
  });

  it("gives every piece its own id", () => {
    const ids = HIDEOUT_DECOR.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of Object.keys(HIDEOUT_SERVICES)) expect(ids).not.toContain(id);
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
  it("stands clear of the player, the device and the stash, and of each person but their own table", () => {
    const S = HIDEOUT_SERVICES;
    const busy: readonly { x: number; z: number; r: number }[] = [
      { x: 0, z: 0, r: 1.6 },                         // where he arrives
      { x: S.mapDevice.x, z: S.mapDevice.z, r: 3.6 }, // the map device and its portal arc
      { x: S.stash.x, z: S.stash.z, r: 2.0 },
      { x: S.vendor.x, z: S.vendor.z, r: 1.5 },
      { x: S.cartographer.x, z: S.cartographer.z, r: 1.5 },
    ];
    // A person stands behind their own table on purpose, on their own rug.
    const own = new Set(["vendor-counter", "rug-stall", "carto-table", "rug-carto"]);
    for (const d of HIDEOUT_DECOR) {
      if (own.has(d.id)) continue;
      for (const b of busy) {
        const gap = Math.hypot(d.x - b.x, d.z - b.z);
        expect(gap, `${d.kind} at ${d.x.toFixed(1)},${d.z.toFixed(1)}`).toBeGreaterThan(b.r);
      }
    }
  });

  it("does not stack two pieces on one spot (a rug is floor, and goes under)", () => {
    const solid = HIDEOUT_DECOR.filter((d) => d.kind !== "rug");
    for (let i = 0; i < solid.length; i++) {
      for (let j = i + 1; j < solid.length; j++) {
        const a = solid[i]!;
        const b = solid[j]!;
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
      // A stretched table's corner discs sit just inside its top: 1.35 out on the map table (half-diagonal 1.73).
      const nearest = Math.min(...solid.map((d) => Math.hypot(d.x - disc.x, d.z - disc.z)));
      expect(nearest).toBeLessThanOrEqual(1.4);
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

  /**
   * The floor plane runs on into the dark, so a walk away lost the room: the sim
   * stops the player at HIDEOUT_FLOOR, and this is what shows him where.
   */
  it("fades the floor to black past the walkable edge, and never over it", () => {
    const scene = new Scene(new NullEngine());
    buildHideoutDecor(scene);
    const edge = scene.getMeshByName(HIDEOUT_EDGE_NAME)!;
    expect(edge).not.toBeNull();
    const pos = edge.getVerticesData(VertexBuffer.PositionKind)!;
    const col = edge.getVerticesData(VertexBuffer.ColorKind)!;
    const F = HIDEOUT_FLOOR;
    let atEdge = 0;
    let dark = 0;
    for (let v = 0; v < pos.length / 3; v++) {
      const { sx, sy } = toScreen(pos[v * 3]!, pos[v * 3 + 2]!);
      // How far outside the walkable rect this vertex lies, in screen units.
      const out = Math.max(F.left - sx, sx - F.right, F.bottom - sy, sy - F.top);
      expect(out, `vertex ${v} inside the floor`).toBeGreaterThan(-1e-4);
      if (Math.abs(out) < 1e-4) { atEdge++; expect(col[v * 4 + 3]).toBe(0); }
      if (out >= 3) { dark++; expect(col[v * 4 + 3]).toBe(1); }
    }
    expect(atEdge).toBeGreaterThan(0);
    expect(dark).toBeGreaterThan(0);
  });

  it("takes the edge away with the decor", () => {
    const scene = new Scene(new NullEngine());
    buildHideoutDecor(scene);
    clearHideoutDecor(scene);
    expect(scene.getMeshByName(HIDEOUT_EDGE_NAME)).toBeNull();
  });

  it("clearing a scene that never had decor is safe", () => {
    const scene = new Scene(new NullEngine());
    expect(() => clearHideoutDecor(scene)).not.toThrow();
  });
});
