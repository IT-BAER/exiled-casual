import { Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core";
import { blinkBurst } from "./skill-fx";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { animateActor, makeMesh, setHitFlash, updateTelegraph, updatePortal, updateMapDevice, updateStash, updateVendor, updateContainer, updateGroundItem, updateRareElement, portalAppear, portalVanish, isPortalMesh, PORTAL_STAGGER_MS, Y_LIFT } from "./meshes";
import type { MeshKind } from "./meshes";
import { COSMETIC_SLOTS, looksForEquipment, previewItemFor, rigOf, type Looks } from "./rig";
import { creatureOf } from "./meshes";
import { CORPSE_SECONDS, disposeRagdoll, dropDead } from "./ragdoll";
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

/**
 * Ticks a body stays lit after it is hit. Three is a tenth of a second: long
 * enough to survive a dropped frame, short enough that a fast weapon reads as a
 * rhythm of hits rather than a monster that is permanently white.
 */
const HIT_FLASH_TICKS = 3;

/**
 * Ticks after which the hand offset stops being applied (the bolt is far
 * enough that the constant offset is invisible). The offset is NOT blended
 * away: decaying it curves the bolt through the player's centre.
 */
const HAND_OFFSET_TTL = 30;

/** How long a corpse lies there, in ticks. */
const CORPSE_TICKS = Math.round(CORPSE_SECONDS * TICKS_PER_SEC);

/** Kinds that fall over when they die. Everything else just stops existing. */
const BODIES = new Set<MeshKind>(["player", "monster", "rare", "boss"]);

export interface CastingAnimation {
  playCast(seconds?: number): void;
  stopCast(): void;
}

export interface ActionAnimation extends CastingAnimation {
  playStrike(seconds?: number): void;
  stopStrike(): void;
}

/** Synchronise the render animation with the simulation-owned casting state. */
export function syncCastingAnimation(
  rig: CastingAnimation | null,
  wasCasting: boolean,
  isCasting: boolean,
  seconds?: number,
): void {
  if (!rig || wasCasting === isCasting) return;
  if (isCasting) rig.playCast(seconds);
  else rig.stopCast();
}

/**
 * Synchronise the render clip with the simulation's current cast action.
 * `seconds` is the wind-up the sim granted this cast (cast speed included), so
 * the clip is paced to end on the hit rather than run at its authored rate.
 */
export function syncActionAnimation(
  rig: ActionAnimation | null,
  wasCasting: boolean,
  isCasting: boolean,
  wasAction: "spell" | "melee" | undefined,
  action: "spell" | "melee" | undefined,
  seconds?: number,
): void {
  if (!rig) return;
  if (isCasting && (!wasCasting || wasAction !== action)) {
    if (action === "melee") rig.playStrike(seconds);
    else rig.playCast(seconds);
    return;
  }
  // A sword swing owns its full animation and is allowed to finish after the
  // simulation hit lands. Spell casting is a sustained pose, so it ends with
  // the cast window.
  if (!isCasting && wasCasting && wasAction !== "melee") rig.stopCast();
}

/** Height the death impulse is aimed above the floor, so a body topples rather
 *  than slides. */
const DEATH_LIFT = 0.35;

/**
 * Only bodies lean. A portal or a chest carries a fixed yaw and no weight, and
 * a rolled map device is furniture someone knocked over.
 */
const TILTS = new Set<MeshKind>(["player", "monster", "rare", "boss"]);

/**
 * Radians of roll per radian-per-second of turn, and the stop it runs into.
 * A hard corner turns ~7 rad/s, which at these numbers banks about 9 degrees:
 * enough to read as weight at this camera distance, short of the motorcycle
 * lean that a walking animation cannot sell.
 */
const ROLL_PER_TURN_RATE = 0.022;
const MAX_ROLL = 0.16;
/** Forward lean at a full run. Small: the gait already sells the pace. */
const RUN_PITCH = 0.05;
/** Sim units per second that count as a full run, for scaling both tilts. */
const RUN_SPEED = 3;
/** Per-frame ease onto the target tilt, so the body settles rather than snaps. */
const TILT_EASE = 0.12;

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
  if (e.kind === "container") return "container";
  if (e.kind === "groundItem") return "groundItem";
  return "groundArea";
}

export class SnapshotRenderer {
  private readonly scene: Scene;
  // keyed by entity id (player id = player.id)
  private readonly meshes = new Map<number, Mesh>();
  /** Walk-cycle position per entity, advanced by distance walked (radians/unit). */
  private readonly gait = new Map<number, number>();
  /** Current [roll, pitch] per entity, eased toward the lean the run asks for. */
  private readonly tilt = new Map<number, [number, number]>();
  /** The tick each entity was last struck on. Absent means it is not lit. */
  private readonly hit = new Map<number, number>();
  /** Newborn bolts offset to the casting hand; constant until TTL expires. */
  private readonly fromHand = new Map<number, { offset: Vector3; tick: number }>();
  /** What each entity is drawn as, so a dead one can be told from a closed portal. */
  private readonly kinds = new Map<number, MeshKind>();
  /** Bodies the sim has forgotten, still falling. Disposed when their time is up. */
  private readonly corpses: { mesh: Mesh; until: number }[] = [];
  private static readonly GAIT_PER_UNIT = 3.2;
  /** apply() runs several times per snapshot while interpolating; once-per-tick
   *  work (like firing a cast animation) is gated on this. */
  private lastTick = -1;
  private playerId: number | null = null;
  private previewStep = 0;
  /** Entity id the mouse is hovering; drives mesh highlight, NOT inRange. */
  private hoveredEntityId: number | null = null;
  /** The last snapshot applied, for the DEV handles alone. */
  private lastSnapshot: Snapshot | null = null;

  constructor(scene: Scene) {
    this.scene = scene;
    // DEV handle, like `window.__sfx` and `window.__scene`: a death is the one
    // thing that cannot be staged from a driven page (it needs a fight), and a
    // ragdoll that never falls looks exactly like one that was never asked to.
    if (typeof window !== "undefined" && import.meta.env?.DEV) {
      (window as unknown as { __fell?: (id?: number) => boolean }).__fell = (id) => {
        const snap = this.lastSnapshot;
        if (!snap) return false;
        const target = id ?? snap.player.id;
        const mesh = this.meshes.get(target);
        if (!mesh || !this.fell(mesh, snap)) return false;
        this.meshes.delete(target);
        this.kinds.delete(target);
        return true;
      };
    }
  }

  /** Feed the cursor's world position to the casting arm's aim solver. */
  setAim(worldX: number, worldZ: number): void {
    if (this.playerId === null) return;
    const mesh = this.meshes.get(this.playerId);
    if (mesh) rigOf(mesh)?.setAimTarget(worldX, worldZ);
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
    // apply() runs several times per snapshot while interpolating, so anything
    // that reacts to a CHANGE has to know which of those frames is the first.
    const newTick = next.tick !== this.lastTick;
    this.lastSnapshot = next;

    // Player
    this.playerId = next.player.id;
    liveIds.add(next.player.id);
    // He falls like anything else does. The mesh leaves the live set the moment
    // he dies, so nothing walks it about the floor while it is a corpse, and the
    // revive builds a new one — standing, at the checkpoint, which is the point.
    const playerCorpse = this.meshes.get(next.player.id);
    if (!next.player.alive && playerCorpse) {
      if (this.fell(playerCorpse, next)) {
        this.meshes.delete(next.player.id);
        this.kinds.delete(next.player.id);
      }
    }
    if (next.player.alive) this.syncMesh(
      next.player.id,
      "player",
      prev?.player.x ?? next.player.x,
      prev?.player.y ?? next.player.y,
      next.player.x,
      next.player.y,
      alpha,
      undefined,
      undefined,
      next.player.heading,
    );

    // Dress the character from what it is wearing. Visibility only, so this is
    // cheap enough to reassert every frame and self-heals if a mesh was rebuilt.
    const playerMesh = this.meshes.get(next.player.id);
    if (playerMesh) rigOf(playerMesh)?.setLooks(this.looksFor(next));

    // Portals arriving this snapshot, in ring order (spawnPortalRing creates them
    // in that order, so ascending entity id IS the arc). Their index is what the
    // stagger is measured in — see portalAppear.
    const arrivingPortals = next.entities
      .filter((e) => e.kind === "portal" && !this.meshes.has(e.id))
      .map((e) => e.id)
      .sort((a, b) => a - b);

    // Entities
    for (const e of next.entities) {
      liveIds.add(e.id);
      const prevE = prev?.entities.find((p) => p.id === e.id);
      // On the bolt's first tick the cast animation hasn't moved the arm yet,
      // so castPoint() returns the idle-pose hand (at the hip). Skip the first
      // tick entirely: the bolt is invisible for 1/30s, and on the second tick
      // the arm is raised and castPoint() gives the real weapon tip.
      const playerRig = playerMesh ? rigOf(playerMesh) : undefined;
      if (e.kind === "projectile" && (e.team ?? 0) === 0 && playerRig && !this.meshes.has(e.id)) {
        if (!this.fromHand.has(e.id)) {
          this.fromHand.set(e.id, { offset: Vector3.Zero(), tick: next.tick });
          continue;
        }
        const hand = playerRig.castPoint();
        if (hand) {
          this.fromHand.set(e.id, {
            offset: hand.subtract(new Vector3(e.x, Y_LIFT.projectile, e.y)),
            tick: next.tick,
          });
        } else {
          this.fromHand.delete(e.id);
        }
      }
      const handEntry = this.fromHand.get(e.id);
      let ox = prevE?.x ?? e.x;
      let oy = prevE?.y ?? e.y;
      let nx = e.x;
      let ny = e.y;
      if (handEntry) {
        const age = next.tick - handEntry.tick + alpha;
        if (age >= HAND_OFFSET_TTL) {
          this.fromHand.delete(e.id);
        } else {
          ox += handEntry.offset.x;
          oy += handEntry.offset.z;
          nx += handEntry.offset.x;
          ny += handEntry.offset.z;
        }
      }
      this.syncMesh(
        e.id,
        kindOf(e),
        ox,
        oy,
        nx,
        ny,
        alpha,
        e.radius,
        // The shared string channel: species for monsters, the furniture look
        // for containers (makeMesh reads it per kind).
        e.species ?? e.look,
      );
      const mesh = this.meshes.get(e.id);
      if (!mesh) continue;
      // Struck: life is the only report of a hit the client gets, and it is the
      // honest one — a swing that missed or was absorbed never moves it.
      if (newTick && e.life !== undefined && prevE?.life !== undefined && e.life < prevE.life) {
        this.hit.set(e.id, next.tick);
      }
      // Born this snapshot: hold it shut and open it in its turn. The group is one
      // map-device event, so its first portal carries the shared opening cue.
      const arriving = arrivingPortals.indexOf(e.id);
      if (arriving >= 0) portalAppear(this.scene, mesh, arriving * PORTAL_STAGGER_MS, arriving === 0);
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
      if (e.kind === "container") {
        updateContainer(mesh, this.hoveredEntityId === e.id, e.opened === true);
      }
      if (e.kind === "groundItem") {
        updateGroundItem(mesh, e.rarity);
      }
      if (e.rare) {
        updateRareElement(mesh, e.element);
      }
    }

    // Crossing an area replaces the whole population at once. A portal that went
    // away because the hideout did was not closed, so it gets no collapse and no
    // cue — six of those under the loading plate is just noise.
    // No previous snapshot counts as a change too, and that is the one that
    // mattered: crossing into the hideout hands the first snapshot of the new
    // area with `prev` null, so the map's six portals were reported gone one by
    // one and each of them played its closing cue over the loading plate.
    const areaChanged = prev === null || prev.area !== next.area;

    // Dispose meshes for entities that no longer exist. A rig owns scene-level
    // animation groups that mesh.dispose() would leave behind.
    for (const [id, mesh] of this.meshes) {
      if (!liveIds.has(id)) {
        // A closing portal outlives the entity that was it: nothing else holds a
        // reference any more, so the collapse disposes it when it finishes.
        if (!areaChanged && isPortalMesh(mesh)) {
          rigOf(mesh)?.dispose();
          portalVanish(this.scene, mesh);
        } else if (!areaChanged && BODIES.has(this.kinds.get(id) ?? "groundArea")
          && this.fell(mesh, next)) {
          // Kept: it is a corpse now, and owned by `corpses` rather than by the
          // entity id, which the sim is free to hand to something else.
        } else {
          rigOf(mesh)?.dispose();
          mesh.dispose();
        }
        this.meshes.delete(id);
        this.kinds.delete(id);
        this.gait.delete(id);
        this.tilt.delete(id);
        this.hit.delete(id);
        this.fromHand.delete(id);
      }
    }

    // Corpses whose time is up. Nothing fades them out: at this camera a body
    // sinking through the floor is more visible than one that is simply gone by
    // the time the player has looked away from it.
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const corpse = this.corpses[i]!;
      if (next.tick < corpse.until) continue;
      this.corpses.splice(i, 1);
      disposeRagdoll(corpse.mesh);
      rigOf(corpse.mesh)?.dispose();
      corpse.mesh.dispose();
    }

    // Faded on the sim's clock, like every other timing in the client: a wall
    // clock would also have to survive a paused engine reporting no time passing,
    // and a body left permanently white is a worse bug than a flash one tick long.
    for (const [id, hitTick] of this.hit) {
      const mesh = this.meshes.get(id);
      const left = HIT_FLASH_TICKS - (next.tick - hitTick);
      if (!mesh || left <= 0) {
        if (mesh) setHitFlash(mesh, 0);
        this.hit.delete(id);
        continue;
      }
      setHitFlash(mesh, left / HIT_FLASH_TICKS);
    }

    if (next.tick !== this.lastTick) {
      this.lastTick = next.tick;
      // The sim owns the whole recovery window. Start the looping upper-body
      // clip on its rising edge and stop it on the falling edge, so holding a
      // skill cannot leave the arm frozen while the cast is still active.
      if (!prev || next.player.casting !== prev.player.casting || next.player.castingAction !== prev.player.castingAction) {
        const playerMesh = this.meshes.get(next.player.id);
        const rig = playerMesh ? rigOf(playerMesh) : null;
        syncActionAnimation(
          rig,
          prev?.player.casting ?? false,
          next.player.casting,
          prev?.player.castingAction,
          next.player.castingAction,
          next.player.castTicks === undefined ? undefined : next.player.castTicks / TICKS_PER_SEC,
        );
      }
      if (prev) {
        const dx = next.player.x - prev.player.x;
        const dy = next.player.y - prev.player.y;
        if (dx * dx + dy * dy > TELEPORT_STEP * TELEPORT_STEP) {
          const pm = this.meshes.get(next.player.id);
          if (pm) {
            pm.setEnabled(false);
            pm.position.x = next.player.x;
            pm.position.z = next.player.y;
          }
          const BLINK_REVEAL_MS = 60;
          const fromV = new Vector3(prev.player.x, BLINK_Y, prev.player.y);
          const toV = new Vector3(next.player.x, BLINK_Y, next.player.y);
          setTimeout(() => {
            blinkBurst(this.scene, fromV, toV);
            if (pm) pm.setEnabled(true);
          }, BLINK_REVEAL_MS);
        }
      }
    }
  }

  /**
   * Turn a mesh the sim has stopped reporting into a body on the floor.
   *
   * False when the physics is not up (the wasm is still compiling, a headless
   * test, a browser that refused it), which leaves the caller on the old path
   * where a dead thing simply vanishes.
   */
  private fell(mesh: Mesh, next: Snapshot): boolean {
    // Away from whatever killed it. The client is never told who did, but the
    // player is who it was fighting, and a body thrown at its killer is wrong in
    // a way anyone can see while thrown away from it is right often enough.
    const push = mesh.position
      .subtract(new Vector3(next.player.x, 0, next.player.y));
    push.y = 0;
    if (push.lengthSquared() < 1e-4) push.set(0, 0, 1);
    push.normalize().y = DEATH_LIFT;
    if (!dropDead(this.scene, mesh, push)) return false;
    rigOf(mesh)?.stopForDeath();
    creatureOf(mesh)?.stopForDeath();
    this.corpses.push({ mesh, until: next.tick + CORPSE_TICKS });
    return true;
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
    species?: string,
    heading?: { x: number; y: number },
  ): void {
    let mesh = this.meshes.get(id);
    const fresh = !mesh;
    const x = lerp(prevX, nextX, alpha);
    const z = lerp(prevY, nextY, alpha);
    if (!mesh) {
      // Born where it belongs. A mesh built at the origin and moved afterwards
      // drags any trail it owns across the level on its first frames.
      mesh = makeMesh(this.scene, kind, `entity-${id}`, new Vector3(x, Y_LIFT[kind], z), species);
      mesh.rotation.y = SPAWN_YAW;
      this.meshes.set(id, mesh);
      this.kinds.set(id, kind);
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
    let yawStep = 0;
    if (dx * dx + dz * dz > 1e-6) {
      const wasYaw = mesh.rotation.y;
      // The step is the heading for everything that steers into its own movement.
      // The player does not, quite: a target inside his turning circle is walked
      // at in a straight line while the body comes about at its own rate, so the
      // sim sends the heading and this follows THAT or he pivots with the cursor.
      const aim = heading ? Math.atan2(heading.x, heading.y) : Math.atan2(dx, dz);
      mesh.rotation.y = lerpAngle(wasYaw, aim, 0.25);
      yawStep = mesh.rotation.y - wasYaw;
    }
    // A stopped actor still needs frames to settle back upright. Skipping this
    // call used to freeze the last running bank indefinitely.
    this.lean(id, mesh, kind, yawStep, speed);
  }

  /**
   * Bank into the corner, and lead with the chest down the straight.
   *
   * Both are one rotation of the root, which pivots on the feet, so the lean
   * comes out of the ground the way a runner's does rather than about his
   * navel. Roll is read off how fast the actor is TURNING and pitch off how
   * fast it is going, and both are eased rather than set, so the body arrives
   * in the lean after the turn has started and leaves it after the turn ends —
   * which is the whole reason it reads as weight and not as a tilted sprite.
   */
  private lean(id: number, mesh: Mesh, kind: MeshKind, yawStep: number, speed: number): void {
    if (!TILTS.has(kind)) return;
    // Per second, not per frame: a 165Hz display turns in smaller bites than a
    // 60Hz one and would otherwise lean a third as far for the same corner.
    const dt = Math.max(this.scene.getEngine().getDeltaTime(), 1) / 1000;
    const runFrac = Math.min(1, speed / RUN_SPEED);
    // Negated: a positive roll about the facing axis drops the OUTSIDE shoulder,
    // which is a runner falling out of his own corner.
    const raw = -(yawStep / dt) * ROLL_PER_TURN_RATE * runFrac;
    const rollTo = Math.max(-MAX_ROLL, Math.min(MAX_ROLL, raw));
    const pitchTo = RUN_PITCH * runFrac;
    const [roll, pitch] = this.tilt.get(id) ?? [0, 0];
    const nextRoll = lerp(roll, rollTo, TILT_EASE);
    const nextPitch = lerp(pitch, pitchTo, TILT_EASE);
    this.tilt.set(id, [nextRoll, nextPitch]);
    mesh.rotation.z = nextRoll;
    mesh.rotation.x = nextPitch;
  }
}
