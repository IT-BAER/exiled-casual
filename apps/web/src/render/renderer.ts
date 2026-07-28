import { Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core";
import { blinkBurst } from "./skill-fx";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { animateActor, makeMesh, updateTelegraph, updatePortal, updateMapDevice, updateStash, updateVendor, updateGroundItem, updateRareElement, Y_LIFT } from "./meshes";
import type { MeshKind } from "./meshes";
import { COSMETIC_SLOTS, looksForEquipment, previewItemFor, rigOf, type Looks } from "./rig";
import { CAMERA_ALPHA } from "./engine";
import { lerp, lerpAngle } from "./interp";

/** Sim rate. Consecutive snapshots are one tick apart, which is what turns a
 *  position delta into a ground speed for the animation state machine. */
const TICKS_PER_SEC = 30;

/**
 * Yaw that turns a mesh authored facing +z toward the lens. It is the camera's
 * own yaw, not a literal: alpha used to be -PI/2 (camera due south) and PI was
 * the answer, but the camera leans 45 degrees now and anything still written as
 * PI shows the player a shoulder.
 */
const FACE_CAMERA_YAW = Math.PI / 2 - CAMERA_ALPHA;

/**
 * Heading a freshly spawned actor holds until it first moves: facing the camera,
 * so an actor that has not moved yet shows its front rather than its back — the
 * difference between a usable screenshot and a shot of a hood.
 */
const SPAWN_YAW = FACE_CAMERA_YAW;

/**
 * The sim's fixed yaws (the portal arc, the stash, the vendor) are authored for
 * a camera due south, where square to the screen meant PI. Turn every one of
 * them by however far the lens has moved since, so a prop that was composed
 * square to the frame stays square to it.
 */
const PROP_YAW_SHIFT = FACE_CAMERA_YAW - Math.PI;

/**
 * Distance the player has to cover in ONE tick for the move to be a teleport.
 * Blink is instant (no castTicks) and raises no flag the client can watch, so
 * the jump itself is the event: walking covers well under a unit per tick and
 * blink covers 5, so anything past this is unambiguous.
 */
const TELEPORT_STEP = 2;
/** Chest height, where the character actually vanishes from. */
const BLINK_Y = 0.9;

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
  if (e.kind === "stash") return "stash";
  if (e.kind === "vendor") return "vendor";
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
  private previewStep = 0;
  /** Entity id the mouse is hovering; drives mesh highlight, NOT inRange. */
  private hoveredEntityId: number | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /** Set the entity the mouse is hovering; drives portal/device highlight visuals. */
  setHoveredEntity(id: number | null): void {
    this.hoveredEntityId = id;
  }

  /**
   * Lab preview of the wardrobe. Step 0 is the truth — whatever the character
   * actually has equipped. The rest walk the armoured looks on one slot at a
   * time, because seeing all five slots from real drops means finding five
   * pieces of armour, and this shows the same thing in five keypresses.
   * Render-only either way: the sim never hears about it.
   */
  cyclePlayerOutfit(): void {
    this.previewStep = (this.previewStep + 1) % (COSMETIC_SLOTS.length + 2);
  }

  /** The look set to draw this frame: equipment, unless a preview is stepped in. */
  private looksFor(next: Snapshot): Looks {
    if (this.previewStep === 0) return looksForEquipment(next.equipment ?? {});
    const shown = COSMETIC_SLOTS.slice(0, this.previewStep - 1);
    return looksForEquipment(Object.fromEntries(shown.map((s) => [s, previewItemFor(s)])));
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

    // Dress the character from what it is wearing. Visibility only, so this is
    // cheap enough to reassert every frame and self-heals if a mesh was rebuilt.
    const playerMesh = this.meshes.get(next.player.id);
    if (playerMesh) rigOf(playerMesh)?.setLooks(this.looksFor(next));

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
        mesh.rotation.y = e.yaw + PROP_YAW_SHIFT;
      }
      // Highlight is driven by mouse hover, not by sim inRange. inRange only
      // triggers the interact intent once the player has walked close enough.
      if (e.kind === "portal") {
        updatePortal(mesh, this.hoveredEntityId === e.id);
      }
      if (e.kind === "mapDevice") {
        updateMapDevice(mesh, this.hoveredEntityId === e.id);
      }
      if (e.kind === "stash") {
        updateStash(mesh, this.hoveredEntityId === e.id);
      }
      if (e.kind === "vendor") {
        updateVendor(mesh, this.hoveredEntityId === e.id);
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
      if (prev) {
        const dx = next.player.x - prev.player.x;
        const dy = next.player.y - prev.player.y;
        if (dx * dx + dy * dy > TELEPORT_STEP * TELEPORT_STEP) {
          blinkBurst(
            this.scene,
            new Vector3(prev.player.x, BLINK_Y, prev.player.y),
            new Vector3(next.player.x, BLINK_Y, next.player.y),
          );
        }
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
    const x = lerp(prevX, nextX, alpha);
    const z = lerp(prevY, nextY, alpha);
    if (!mesh) {
      // Born where it belongs. A mesh built at the origin and moved afterwards
      // drags any trail it owns across the level on its first frames.
      mesh = makeMesh(this.scene, kind, `entity-${id}`, new Vector3(x, Y_LIFT[kind], z));
      mesh.rotation.y = SPAWN_YAW;
      this.meshes.set(id, mesh);
    }
    const wasX = mesh.position.x;
    const wasZ = mesh.position.z;
    mesh.position.x = x;
    mesh.position.z = z;
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
