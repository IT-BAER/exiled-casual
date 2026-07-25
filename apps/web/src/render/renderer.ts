import type { Scene } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { animateActor, makeMesh, updateTelegraph, updatePortal, updateMapDevice, updateGroundItem, updateRareElement, Y_LIFT } from "./meshes";
import type { MeshKind } from "./meshes";
import { OUTFITS, rigOf } from "./rig";
import { lerp, lerpAngle } from "./interp";

/** Sim rate. Consecutive snapshots are one tick apart, which is what turns a
 *  position delta into a ground speed for the animation state machine. */
const TICKS_PER_SEC = 30;

/**
 * Heading a freshly spawned actor holds until it first moves. South (-Z) faces
 * the camera, so an actor that has not moved yet shows its front rather than
 * its back — the difference between a usable screenshot and a shot of a hood.
 */
const SPAWN_YAW = Math.PI;

/** Rising edge of the sim's casting flag, i.e. a cast just started this tick. */
function didCast(prev: Snapshot, next: Snapshot): boolean {
  return next.player.casting && !prev.player.casting;
}

function kindOf(e: SnapshotEntity): MeshKind {
  if (e.kind === "monster") {
    if (e.boss) return "boss";
    return e.rare ? "rare" : "monster";
  }
  if (e.kind === "projectile") return "projectile";
  if (e.kind === "telegraph") return "telegraph";
  if (e.kind === "portal") return "portal";
  if (e.kind === "mapDevice") return "mapDevice";
  if (e.kind === "groundItem") return "groundItem";
  return "groundArea";
}

export class SnapshotRenderer {
  private readonly scene: Scene;
  // keyed by entity id (player id = player.id)
  private readonly meshes = new Map<number, Mesh>();
  /** Walk-cycle position per entity, advanced by distance walked (radians/unit). */
  private readonly gait = new Map<number, number>();
  private static readonly GAIT_PER_UNIT = 3.2;
  /** apply() runs several times per snapshot while interpolating; once-per-tick
   *  work (like firing a cast animation) is gated on this. */
  private lastTick = -1;
  private playerId: number | null = null;
  /** Entity id the mouse is hovering; drives mesh highlight, NOT inRange. */
  private hoveredEntityId: number | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Set the entity the mouse is hovering; drives portal/device highlight visuals. */
  setHoveredEntity(id: number | null): void {
    this.hoveredEntityId = id;
  }

  /** Try on the next outfit. Render-only: the sim never hears about it. */
  cyclePlayerOutfit(): void {
    const mesh = this.playerId === null ? undefined : this.meshes.get(this.playerId);
    const rig = mesh ? rigOf(mesh) : null;
    if (!rig) return;
    const next = OUTFITS[(OUTFITS.indexOf(rig.outfit) + 1) % OUTFITS.length]!;
    rig.setOutfit(next);
  }

  apply(prev: Snapshot | null, next: Snapshot, alpha: number): void {
    // Collect the full set of ids that should exist after this call
    const liveIds = new Set<number>();

    // Player
    this.playerId = next.player.id;
    liveIds.add(next.player.id);
    this.syncMesh(
      next.player.id,
      "player",
      prev?.player.x ?? next.player.x,
      prev?.player.y ?? next.player.y,
      next.player.x,
      next.player.y,
      alpha,
    );

    // Entities
    for (const e of next.entities) {
      liveIds.add(e.id);
      const prevE = prev?.entities.find((p) => p.id === e.id);
      this.syncMesh(
        e.id,
        kindOf(e),
        prevE?.x ?? e.x,
        prevE?.y ?? e.y,
        e.x,
        e.y,
        alpha,
        e.radius,
      );
      const mesh = this.meshes.get(e.id);
      if (!mesh) continue;
      if (e.kind === "telegraph") {
        updateTelegraph(mesh, e.progress ?? 0);
      }
      // Portals and map devices carry a fixed yaw from the sim so a ring of portals
      // reads correctly (some face the camera, others turn nearly edge-on).
      if (e.yaw !== undefined) {
        mesh.rotation.y = e.yaw;
      }
      // Highlight is driven by mouse hover, not by sim inRange. inRange only
      // triggers the interact intent once the player has walked close enough.
      if (e.kind === "portal") {
        updatePortal(mesh, this.hoveredEntityId === e.id);
      }
      if (e.kind === "mapDevice") {
        updateMapDevice(mesh, this.hoveredEntityId === e.id);
      }
      if (e.kind === "groundItem") {
        updateGroundItem(mesh, e.rarity);
      }
      if (e.rare) {
        updateRareElement(mesh, e.element);
      }
    }

    // Dispose meshes for entities that no longer exist. A rig owns scene-level
    // animation groups that mesh.dispose() would leave behind.
    for (const [id, mesh] of this.meshes) {
      if (!liveIds.has(id)) {
        rigOf(mesh)?.dispose();
        mesh.dispose();
        this.meshes.delete(id);
        this.gait.delete(id);
      }
    }

    if (next.tick !== this.lastTick) {
      this.lastTick = next.tick;
      // The sim's casting flag going up means a cast started this tick — drives
      // the spell animation. Instant skills (castTicks 0) never raise it.
      if (prev && didCast(prev, next)) {
        const playerMesh = this.meshes.get(next.player.id);
        if (playerMesh) rigOf(playerMesh)?.playCast();
      }
    }
  }

  private syncMesh(
    id: number,
    kind: MeshKind,
    prevX: number,
    prevY: number,
    nextX: number,
    nextY: number,
    alpha: number,
    radius?: number,
  ): void {
    let mesh = this.meshes.get(id);
    const fresh = !mesh;
    if (!mesh) {
      mesh = makeMesh(this.scene, kind, `entity-${id}`);
      mesh.rotation.y = SPAWN_YAW;
      this.meshes.set(id, mesh);
    }
    const wasX = mesh.position.x;
    const wasZ = mesh.position.z;
    mesh.position.x = lerp(prevX, nextX, alpha);
    mesh.position.z = lerp(prevY, nextY, alpha);
    mesh.position.y = Y_LIFT[kind];

    // Scale telegraph and groundArea on x/z only to match their world radius.
    if ((kind === "telegraph" || kind === "groundArea") && radius !== undefined) {
      mesh.scaling.x = radius;
      mesh.scaling.z = radius;
    }

    // Advance the walk cycle by how far the mesh actually moved on screen this
    // frame, not by the snapshot delta: apply() runs several times per snapshot
    // while interpolating, so a snapshot delta would count the same step twice.
    // A mesh spawning at the origin teleports on its first frame, which is not
    // a step.
    const step = fresh ? 0 : Math.hypot(mesh.position.x - wasX, mesh.position.z - wasZ);
    const phase = (this.gait.get(id) ?? 0) + step * SnapshotRenderer.GAIT_PER_UNIT;
    this.gait.set(id, phase);
    // Ground speed comes from the snapshot delta, not the frame step: it is one
    // tick's worth of movement regardless of how many frames render between.
    const speed = Math.hypot(nextX - prevX, nextY - prevY) * TICKS_PER_SEC;
    animateActor(mesh, phase, step > 1e-5, speed);

    // Turn the actor to face where it's heading (sim x,y -> world x,z). The
    // meshes are authored facing +z; yaw = atan2(dx, dz) aligns +z with the
    // movement direction. Only turn while actually moving so idle actors hold
    // their last heading instead of snapping back to +z.
    const dx = nextX - prevX;
    const dz = nextY - prevY;
    if (dx * dx + dz * dz > 1e-6) {
      mesh.rotation.y = lerpAngle(mesh.rotation.y, Math.atan2(dx, dz), 0.25);
    }
  }
}
