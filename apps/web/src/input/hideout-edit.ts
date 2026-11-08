import { Color3, MeshBuilder, StandardMaterial, type AbstractMesh, type Mesh, type Node, type Scene } from "@babylonjs/core";
import { fp } from "@exiled/fixed-point";
import {
  HIDEOUT_DECOR, HIDEOUT_SERVICES, ROT_STEP, decorById, decorDiscs, onHideoutFloorWorld, rotTrig, yawToRot,
  type HideoutServiceId, type PiecePlacement,
} from "@exiled/content-runtime";
import type { Intent, Snapshot } from "@exiled/protocol";
import { applyHideoutLayout, decorPlacement, moveDecorRoot } from "../render/hideout";

/**
 * Edit Hideout, PoE's decoration mode: click a piece to pick it up, it rides the
 * cursor, the wheel turns it a notch at a time, a click puts it down, a right
 * click or Escape puts it back. Furniture and the four services alike.
 *
 * While the mode is on, this owns the canvas: its listeners sit on the window's
 * CAPTURE phase and stop every pointer event aimed at the canvas, so the game's
 * bindings never see a click that was meant for a crate. The sim has the last
 * word on every placement (systems/hideout-edit.ts); this only previews it.
 */

const SERVICE_KINDS: ReadonlySet<string> = new Set(Object.keys(HIDEOUT_SERVICES));

/** The player's body, and the arrival spot's, as the sim measures them. */
const BODY = 0.5;
/** How far a carried piece floats off the floor, so it reads as picked up. */
const LIFT = 0.12;
/** Snapshots a placement may take to come back before the preview lets go of it. */
const COMMIT_TICKS = 3;

export interface HideoutEditState {
  active: boolean;
  /** Id of the piece under the cursor or riding it; null over bare floor. */
  hovered: string | null;
  carrying: string | null;
  /** Whether the carried piece may be put down where it is. */
  valid: boolean;
}

interface Carry {
  id: string;
  /** Snapshot entity id when the piece is a service. */
  entityId: number | null;
  /** Where it stood when picked up: a cancel puts it back here. */
  from: { x: number; z: number; rot: number };
  /** The piece's offset from the cursor's floor point, so it does not jump to it. */
  grab: { dx: number; dz: number };
  x: number;
  z: number;
  rot: number;
}

export interface HideoutEditDeps {
  canvas: HTMLCanvasElement;
  scene: Scene;
  renderer: { overridePlacement(id: number, at: { x: number; z: number; yaw: number } | null): void };
  post: (intent: Intent) => void;
  /** Render yaw for a service's sim yaw: the renderer turns every fixed yaw by the lens's lean. */
  serviceYawShift: number;
  onChange?: (state: HideoutEditState) => void;
  /** Escape with nothing in hand: the player is done. */
  onExit?: () => void;
}

/** A floor point under a screen pixel, or null off the plane. */
function floorAt(scene: Scene, sx: number, sy: number): { x: number; z: number } | null {
  const ray = scene.createPickingRay(sx, sy, null, null);
  if (ray.direction.y >= -1e-6) return null;
  const t = -ray.origin.y / ray.direction.y;
  if (t < 0) return null;
  return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
}

/** The piece a node belongs to: a decor root's id, or a service entity's kind and id. */
function pieceOf(node: Node | null): { id: string; entityId: number | null } | null {
  for (let n = node; n; n = n.parent as Node | null) {
    const meta = n.metadata as { hideoutPiece?: string; interactKind?: string } | null;
    if (meta?.hideoutPiece) return { id: meta.hideoutPiece, entityId: null };
    if (meta?.interactKind && SERVICE_KINDS.has(meta.interactKind)) {
      const m = n.name.match(/^entity-(\d+)$/);
      if (m) return { id: meta.interactKind, entityId: parseInt(m[1]!, 10) };
    }
  }
  return null;
}

function layoutRecord(snap: Snapshot | null): Record<string, PiecePlacement> {
  const out: Record<string, PiecePlacement> = {};
  for (const p of snap?.hideoutLayout ?? []) out[p.id] = { x: p.x, z: p.y, rot: p.rot };
  return out;
}

export function attachHideoutEdit(deps: HideoutEditDeps): {
  setActive: (on: boolean) => void;
  onSnapshot: (snap: Snapshot) => void;
  /** The arrangement the last snapshot reported, for a decor rebuild. */
  moved: () => Record<string, PiecePlacement>;
  /** Pick up / put down / turn, driven without a mouse (tests, the dev console). */
  pickUp: (id: string) => boolean;
  carryTo: (x: number, z: number) => void;
  rotate: (notches: number) => void;
  place: () => boolean;
  cancel: () => void;
  state: () => HideoutEditState;
  detach: () => void;
} {
  const { canvas, scene, renderer, post } = deps;
  let active = false;
  let hovered: { id: string; entityId: number | null } | null = null;
  let carry: Carry | null = null;
  let snap: Snapshot | null = null;
  let movedNow: Record<string, PiecePlacement> = {};
  let appliedSig = "";
  /** A placement sent and not yet seen back: the preview holds it until then. */
  let pending: { id: string; entityId: number | null; tick: number } | null = null;
  let lastState: HideoutEditState = { active: false, hovered: null, carrying: null, valid: true };

  // The ring under the hovered or carried piece: gold to say "this one", green or
  // red once it is in hand to say whether it may go down here.
  let ring: Mesh | null = null;
  let ringMat: StandardMaterial | null = null;
  function ringMesh(): Mesh {
    if (ring && !ring.isDisposed()) return ring;
    ringMat = new StandardMaterial("hideout-edit-ring-mat", scene);
    ringMat.disableLighting = true;
    ringMat.diffuseColor = Color3.Black();
    ringMat.alpha = 0.9;
    ring = MeshBuilder.CreateTorus("hideout-edit-ring", { diameter: 1, thickness: 0.04, tessellation: 40 }, scene);
    ring.material = ringMat;
    ring.isPickable = false;
    ring.receiveShadows = false;
    ring.position.y = 0.03;
    ring.setEnabled(false);
    return ring;
  }

  function emit(): void {
    const next: HideoutEditState = {
      active, hovered: hovered?.id ?? null, carrying: carry?.id ?? null, valid: carry ? validAt(carry) : true,
    };
    if (next.active === lastState.active && next.hovered === lastState.hovered
      && next.carrying === lastState.carrying && next.valid === lastState.valid) return;
    lastState = next;
    deps.onChange?.(next);
  }

  /** Where a piece stands right now and how it is turned, in whole degrees. */
  function standing(id: string, entityId: number | null): { x: number; z: number; rot: number } {
    const m = movedNow[id];
    if (m) return { x: m.x, z: m.z, rot: m.rot };
    if (entityId !== null) {
      const e = snap?.entities.find((en) => en.id === entityId);
      const d = HIDEOUT_SERVICES[id as HideoutServiceId];
      return { x: e?.x ?? d.x, z: e?.y ?? d.z, rot: yawToRot(e?.yaw ?? d.yaw) };
    }
    const d = decorById(id)!;
    const at = decorPlacement(d);
    return { x: at.x, z: at.z, rot: yawToRot(at.yaw) };
  }

  /** The discs a piece would stand on, as the sim measures them. */
  function discs(id: string, x: number, z: number, rot: number): { x: number; z: number; r: number }[] {
    const d = decorById(id);
    if (d) return decorDiscs(d, x, z, rotTrig(rot));
    return [{ x, z, r: HIDEOUT_SERVICES[id as HideoutServiceId].block }];
  }

  /** The sim's rule, previewed: on the floor and clear of the player and the arrival spot. */
  function validAt(c: Carry): boolean {
    if (!onHideoutFloorWorld(c.x, c.z)) return false;
    const bodies = [{ x: 0, z: 0 }, ...(snap ? [{ x: snap.player.x, z: snap.player.y }] : [])];
    for (const d of discs(c.id, c.x, c.z, c.rot)) {
      if (d.r <= 0) continue;
      for (const b of bodies) if (Math.hypot(d.x - b.x, d.z - b.z) < d.r + BODY) return false;
    }
    return true;
  }

  /** Radius of the ring that marks a piece: its own footprint's reach, or a body's. */
  function ringRadius(id: string): number {
    const d = decorById(id);
    if (d?.kind === "rug") return 1.3 * Math.max(d.scale?.x ?? 1, d.scale?.z ?? 1);
    const at = { x: 0, z: 0 };
    const reach = Math.max(0.45, ...discs(id, at.x, at.z, 0).map((c) => Math.hypot(c.x, c.z) + c.r));
    return reach + 0.25;
  }

  function drawPiece(c: Carry, lift: number): void {
    const yaw = (c.rot * Math.PI) / 180;
    if (c.entityId !== null) renderer.overridePlacement(c.entityId, { x: c.x, z: c.z, yaw: yaw + deps.serviceYawShift });
    else moveDecorRoot(scene, c.id, c.x, c.z, yaw);
    const root = c.entityId === null ? scene.getMeshByName(`hideout-decor-${c.id}`) : null;
    if (root) root.position.y = lift;
  }

  function showRing(): void {
    const r = ringMesh();
    const target = carry ?? (hovered ? { id: hovered.id, ...standing(hovered.id, hovered.entityId) } : null);
    if (!active || !target) { r.setEnabled(false); return; }
    const radius = ringRadius(target.id);
    r.setEnabled(true);
    r.position.x = target.x;
    r.position.z = target.z;
    r.scaling.set(radius * 2, 1, radius * 2);
    const col = !carry ? new Color3(1, 0.8, 0.35) : validAt(carry) ? new Color3(0.4, 1, 0.45) : new Color3(1, 0.3, 0.25);
    ringMat!.emissiveColor = col;
  }

  function pickAt(sx: number, sy: number): { id: string; entityId: number | null } | null {
    const pick = scene.pick(sx, sy, (m: AbstractMesh) => m.isEnabled() && m.isVisible && pieceOf(m) !== null);
    return pick.pickedMesh ? pieceOf(pick.pickedMesh) : null;
  }

  function pickUp(id: string, cursor?: { x: number; z: number }): boolean {
    if (!active || carry) return false;
    const entityId = SERVICE_KINDS.has(id) ? (snap?.entities.find((e) => e.kind === id)?.id ?? null) : null;
    if (SERVICE_KINDS.has(id) && entityId === null) return false;
    if (!SERVICE_KINDS.has(id) && !decorById(id)) return false;
    const from = standing(id, entityId);
    carry = {
      id, entityId, from,
      grab: cursor ? { dx: from.x - cursor.x, dz: from.z - cursor.z } : { dx: 0, dz: 0 },
      x: from.x, z: from.z, rot: from.rot,
    };
    hovered = { id, entityId };
    drawPiece(carry, LIFT);
    showRing();
    emit();
    return true;
  }

  function carryTo(x: number, z: number): void {
    if (!carry) return;
    carry.x = x + carry.grab.dx;
    carry.z = z + carry.grab.dz;
    drawPiece(carry, LIFT);
    showRing();
    emit();
  }

  function rotate(notches: number): void {
    if (!carry) return;
    carry.rot = ((carry.rot + notches * ROT_STEP) % 360 + 360) % 360;
    drawPiece(carry, LIFT);
    showRing();
    emit();
  }

  /** Put the carried piece down. False (and still in hand) where the sim would refuse it. */
  function place(): boolean {
    if (!carry || !validAt(carry)) return false;
    const c = carry;
    post({ kind: "placeHideoutPiece", pieceId: c.id, x: fp(c.x), y: fp(c.z), rot: c.rot });
    drawPiece(c, 0);
    pending = { id: c.id, entityId: c.entityId, tick: snap?.tick ?? 0 };
    carry = null;
    showRing();
    emit();
    return true;
  }

  function cancel(): void {
    if (!carry) return;
    const c = carry;
    carry = null;
    if (c.entityId !== null) renderer.overridePlacement(c.entityId, null);
    const back = { ...c, ...c.from };
    if (c.entityId === null) drawPiece(back, 0);
    showRing();
    emit();
  }

  // ── Pointer, wheel and keys: captured on the window while the mode is on ──
  const onCanvas = (e: Event) => active && e.target === canvas;

  function onPointerMove(e: PointerEvent): void {
    if (!onCanvas(e)) return;
    e.stopImmediatePropagation();
    if (carry) {
      const at = floorAt(scene, e.clientX, e.clientY);
      if (at) carryTo(at.x, at.z);
      return;
    }
    const next = pickAt(e.clientX, e.clientY);
    if (next?.id !== hovered?.id) {
      hovered = next;
      showRing();
      emit();
    }
  }

  function onPointerDown(e: PointerEvent): void {
    if (!onCanvas(e)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.button === 2) { cancel(); return; }
    if (e.button !== 0) return;
    if (carry) { place(); return; }
    const hit = pickAt(e.clientX, e.clientY);
    if (hit) pickUp(hit.id, floorAt(scene, e.clientX, e.clientY) ?? undefined);
  }

  function onPointerUp(e: PointerEvent): void {
    if (onCanvas(e)) e.stopImmediatePropagation();
  }

  function onWheel(e: WheelEvent): void {
    if (!onCanvas(e) || !carry) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    rotate(e.deltaY > 0 ? 1 : -1);
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!active || e.key !== "Escape") return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (carry) cancel();
    else deps.onExit?.();
  }

  const capture = { capture: true } as const;
  window.addEventListener("pointermove", onPointerMove, capture);
  window.addEventListener("pointerdown", onPointerDown, capture);
  window.addEventListener("pointerup", onPointerUp, capture);
  window.addEventListener("wheel", onWheel, { capture: true, passive: false });
  window.addEventListener("keydown", onKeyDown, capture);

  function setActive(on: boolean): void {
    if (on === active) return;
    if (!on) cancel();
    active = on;
    hovered = null;
    showRing();
    emit();
  }

  function onSnapshot(next: Snapshot): void {
    snap = next;
    if (next.area !== "hideout") {
      if (active) { setActive(false); deps.onExit?.(); }
      return;
    }
    movedNow = layoutRecord(next);
    const sig = JSON.stringify(next.hideoutLayout ?? []);
    if (pending && next.tick >= pending.tick + COMMIT_TICKS) {
      if (pending.entityId !== null) renderer.overridePlacement(pending.entityId, null);
      pending = null;
      appliedSig = "";
    }
    if (sig !== appliedSig && !pending) {
      appliedSig = sig;
      applyHideoutLayout(scene, movedNow);
      if (carry) drawPiece(carry, LIFT);
    }
    if (active) showRing();
  }

  function detach(): void {
    window.removeEventListener("pointermove", onPointerMove, capture);
    window.removeEventListener("pointerdown", onPointerDown, capture);
    window.removeEventListener("pointerup", onPointerUp, capture);
    window.removeEventListener("wheel", onWheel, capture);
    window.removeEventListener("keydown", onKeyDown, capture);
    ring?.dispose();
    ringMat?.dispose();
  }

  return {
    setActive, onSnapshot, moved: () => movedNow,
    pickUp: (id) => pickUp(id), carryTo, rotate, place, cancel,
    state: () => lastState, detach,
  };
}

/** Every piece Edit Hideout can move, by id: for tests and the dev console. */
export const HIDEOUT_PIECE_IDS: readonly string[] = [...Object.keys(HIDEOUT_SERVICES), ...HIDEOUT_DECOR.map((d) => d.id)];
