import { fp, toNumber, type Fixed } from "@exiled/fixed-point";
import {
  HIDEOUT_FLOOR, HIDEOUT_SERVICES, HIDEOUT_SERVICE_IDS, ROT_STEP, decorById, yawToRot,
  type HideoutServiceId, type PiecePlacement,
} from "@exiled/content-runtime";
import type { World } from "./ecs";
import type { HideoutLayoutC, HideoutPieceC, InteractableC, Position } from "./components";

/**
 * The player's own arrangement of the hideout (PoE's Edit Hideout). Content says
 * where every piece stands by default; this is the short list of pieces he moved,
 * kept on the session singleton so the save carries it and both the build and the
 * collision read it.
 */

const SERVICES: ReadonlySet<string> = new Set(HIDEOUT_SERVICE_IDS);

export function isServiceId(id: string): id is HideoutServiceId {
  return SERVICES.has(id);
}

/** A piece Edit Hideout may move: a service or a decor id content knows. */
export function isPieceId(id: string): boolean {
  return isServiceId(id) || decorById(id) !== undefined;
}

/** The moved pieces, or none. */
export function layoutOf(world: World): readonly HideoutPieceC[] {
  const e = world.query("session")[0];
  if (e === undefined) return [];
  return world.get<HideoutLayoutC>(e, "hideoutLayout")?.pieces ?? [];
}

/** The moved pieces as content's float placements, by id. */
export function movedRecord(pieces: readonly HideoutPieceC[]): Record<string, PiecePlacement> {
  const out: Record<string, PiecePlacement> = {};
  for (const p of pieces) out[p.id] = { x: toNumber(p.x), z: toNumber(p.y), rot: p.rot };
  return out;
}

/** Where a service stands and faces: moved, or content's default. */
export function servicePlacement(pieces: readonly HideoutPieceC[], id: HideoutServiceId): { x: Fixed; y: Fixed; yaw: number } {
  const m = pieces.find((p) => p.id === id);
  if (m) return { x: m.x, y: m.y, yaw: (m.rot * Math.PI) / 180 };
  const d = HIDEOUT_SERVICES[id];
  return { x: fp(d.x), y: fp(d.z), yaw: d.yaw };
}

/** The rotation a piece holds now, in whole degrees: what Edit Hideout turns from. */
export function currentRot(pieces: readonly HideoutPieceC[], id: string): number {
  const m = pieces.find((p) => p.id === id);
  if (m) return m.rot;
  if (isServiceId(id)) return yawToRot(HIDEOUT_SERVICES[id].yaw);
  return yawToRot(decorById(id)?.yaw ?? 0);
}

/**
 * Stand every service where the layout says, and carry the portal ring with the
 * device so its doorways keep their arc around it.
 */
export function placeServices(world: World, pieces: readonly HideoutPieceC[]): void {
  let deviceShift: { dx: number; dy: number } | null = null;
  for (const e of world.query("interactable", "position")) {
    const it = world.get<InteractableC>(e, "interactable")!;
    if (!isServiceId(it.kind)) continue;
    const at = servicePlacement(pieces, it.kind);
    const was = world.get<Position>(e, "position")!;
    if (it.kind === "mapDevice") deviceShift = { dx: at.x - was.x, dy: at.y - was.y };
    world.set<Position>(e, "position", { x: at.x, y: at.y });
    world.set<InteractableC>(e, "interactable", { ...it, yaw: at.yaw });
  }
  if (!deviceShift || (deviceShift.dx === 0 && deviceShift.dy === 0)) return;
  for (const e of world.query("interactable", "position")) {
    if (world.get<InteractableC>(e, "interactable")!.kind !== "portal") continue;
    const p = world.get<Position>(e, "position")!;
    world.set<Position>(e, "position", { x: p.x + deviceShift.dx, y: p.y + deviceShift.dy });
  }
}

/**
 * `HIDEOUT_FLOOR` in the sim's own integers. Screen (sx, sy) is world
 * ((x + y) / sqrt2, (y - x) / sqrt2), so each bound is compared times sqrt2.
 */
const FLOOR_SQRT2 = {
  left: fp(HIDEOUT_FLOOR.left * Math.SQRT2), right: fp(HIDEOUT_FLOOR.right * Math.SQRT2),
  bottom: fp(HIDEOUT_FLOOR.bottom * Math.SQRT2), top: fp(HIDEOUT_FLOOR.top * Math.SQRT2),
};

export function onHideoutFloor(x: Fixed, y: Fixed): boolean {
  const across = x + y;
  const up = y - x;
  return across >= FLOOR_SQRT2.left && across <= FLOOR_SQRT2.right
    && up >= FLOOR_SQRT2.bottom && up <= FLOOR_SQRT2.top;
}

/**
 * A saved layout, proven rather than trusted: known ids only, integer coordinates
 * on the floor, a whole rotation step, one entry per id, sorted. A hand-edited
 * save or a piece content has since dropped loses that entry, never the load.
 */
export function sanitizeLayout(raw: unknown): HideoutPieceC[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, HideoutPieceC>();
  for (const v of raw as unknown[]) {
    const p = v as Partial<HideoutPieceC> | null;
    if (!p || typeof p.id !== "string" || !isPieceId(p.id)) continue;
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || !Number.isInteger(p.rot)) continue;
    if (p.rot! % ROT_STEP !== 0 || !onHideoutFloor(p.x!, p.y!)) continue;
    byId.set(p.id, { id: p.id, x: p.x!, y: p.y!, rot: ((p.rot! % 360) + 360) % 360 });
  }
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
