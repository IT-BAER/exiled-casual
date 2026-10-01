import { Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core";
import { blinkBurst, fxProfile, meleeImpact, setStreakLength, stickArrow, STUCK_ARROW_TICKS, STUCK_ARROWS_MAX } from "./skill-fx";
import { HIT_STOP_SCALE, addTrauma, decayTrauma, hitStopMs, shakeOffset, swingWeight } from "./juice";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { animateActor, keepGroundBlobFlat, makeMesh, setHitFlash, updateTelegraph, updatePortal, updateMapDevice, updateStash, updateVendor, updateContainer, updateGroundItem, updateRareElement, portalAppear, portalVanish, isPortalMesh, PORTAL_STAGGER_MS, Y_LIFT } from "./meshes";
import type { MeshKind } from "./meshes";
import { rigOf } from "./rig";
import type { ReactionClip } from "./rig";
import { looksForEquipment } from "./gear-looks";
import { creatureOf } from "./meshes";
import { CORPSE_SECONDS, SINK_SECONDS, disposeRagdoll, dropDead, freezeRagdoll, sinkDepth } from "./ragdoll";
import { CAMERA_ALPHA } from "./engine";
import { lerp, springAngle } from "./interp";
import { FLINCH_TICKS, flinchPose, flinchStrength, kick, leanToTilt } from "./hit-reaction";
import type { Flinch } from "./hit-reaction";

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
/** A cursor this close to the player (units) has no direction worth turning to. */
const AIM_DEAD_ZONE = 0.3;
/**
 * Standing still, the head follows the cursor and the body holds until the
 * cursor is this far off it (radians, ~75 degrees, inside the head's 85).
 */
const STAND_TURN_AT = 1.3;

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
 * A monster this far from the player is past any frame the camera can show (the
 * ground reaches ~10.6 units at full zoom-out, ~13 on an ultrawide), so it is
 * disabled and its clips paused until it walks back into range.
 */
const SLEEP_RANGE = 20;

/**
 * How far a bolt is assumed to be flying when the cursor's own point is not
 * available (headless, or a cast before the first frame): the rate an arrow
 * drops from the bow hand, and where a bolt meets the sim's line.
 */
const ASSUMED_RANGE = 8;
/**
 * Farthest a bolt flies from the weapon tip before it is on the sim's line. It
 * aims straight at the cursor and meets the line there; past this a far click
 * would fly it visibly off the line it collides on.
 */
const HAND_BLEND_MAX = 6;

/** How long a corpse lies there before it starts to sink, in ticks. */
const CORPSE_TICKS = Math.round(CORPSE_SECONDS * TICKS_PER_SEC);

/** How long the sink takes, in ticks. */
const SINK_TICKS = Math.round(SINK_SECONDS * TICKS_PER_SEC);

/** Kinds that fall over when they die. Everything else just stops existing. */
const BODIES = new Set<MeshKind>(["player", "monster", "rare", "boss"]);

export interface ActionAnimation {
  playCast(seconds?: number): void;
  playBow(seconds?: number, releaseSeconds?: number): void;
  playStrike(seconds?: number, releaseSeconds?: number): void;
  stopStrike(): void;
}

/**
 * Synchronise the render clip with the simulation's current cast action.
 *
 * `seconds` is the BEAT the sim granted this cast: the wind-up or the cooldown,
 * whichever is longer, because that is the gap the player actually watches. The
 * casting flag only lives for the wind-up, so an action is started on its rising
 * edge and then left alone. Every clip here owns its full animation and is
 * allowed to finish after the hit lands: cutting the spell clip on the falling
 * edge showed the first 30% of a one-second swing, and the bolt left a hand that
 * was still lifting.
 */
export function syncActionAnimation(
  rig: ActionAnimation | null,
  wasCasting: boolean,
  isCasting: boolean,
  wasAction: "spell" | "melee" | "bow" | undefined,
  action: "spell" | "melee" | "bow" | undefined,
  seconds?: number,
  releaseSeconds?: number,
): void {
  if (!rig) return;
  if (isCasting && (!wasCasting || wasAction !== action)) {
    if (action === "melee") rig.playStrike(seconds, releaseSeconds);
    else if (action === "bow") rig.playBow(seconds, releaseSeconds);
    else rig.playCast(seconds);
  }
}

/** Share of the whole pool (life plus energy shield) one tick must take to stagger. */
const HEAVY_HIT = 0.1;

/**
 * The player's own reaction to what this tick did to him, off the snapshot diff
 * like the soundscape's cues: a heavy blow, a flask charge spent, a container
 * flipped to opened. The blow wins a shared tick; a chip hit is not a stagger.
 */
export function reactionFor(prev: Snapshot, next: Snapshot): ReactionClip | null {
  const p = next.player, b = prev.player;
  if (!p.alive) return null;
  // A pool that shrank is gear coming off, not damage (the soundscape's rule).
  const held = p.maxLife >= b.maxLife && p.maxEnergyShield >= b.maxEnergyShield;
  const lost = b.life - p.life + b.energyShield - p.energyShield;
  if (held && lost >= HEAVY_HIT * (p.maxLife + p.maxEnergyShield)) return "hit";
  if (p.flasks.lifeCharges < b.flasks.lifeCharges || p.flasks.manaCharges < b.flasks.manaCharges) return "drink";
  const opened = next.entities.some((e) => e.kind === "container" && e.opened === true
    && prev.entities.some((was) => was.id === e.id && was.opened !== true));
  return opened ? "open" : null;
}

/** Height the death impulse is aimed above the floor, so a body topples rather
 *  than slides. */
const DEATH_LIFT = 0.35;
/** Where on the body the blow lands: chest height, and up to this far off its
 *  centre line, which is the whole difference between a fall and a spin. */
const DEATH_CHEST = 0.65;
const DEATH_OFF_CENTRE = 0.3;
/** How close a vanished bolt has to be to the body to have been what killed it.
 *  Wide enough for a monster radius plus the tick the impact was resolved on,
 *  short enough that a bolt expiring against a wall nearby is not mistaken for it. */
const HIT_REACH = 1.5;
/** Farthest body a landed swing is drawn striking: Ground Slam's 3.5 reach plus a boss. */
const MELEE_FX_REACH = 5;
/** Bursts per swing. Past a few the sparks are one blur and only cost frames. */
const MAX_MELEE_BURSTS = 4;
/** A weapon knocks a body further back than a bolt of the same damage. */
const MELEE_KICK = 1.5;

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
/** Time constant (s) of the ease onto the target tilt, so the body settles rather than snaps. */
const TILT_EASE_SEC = 0.13;
/**
 * Stiffness (rad/s) of the critically damped spring a body turns on: it eases
 * into a turn and settles out of it, ~95 percent of the way in 0.19 s.
 */
const TURN_OMEGA = 25;
/** Fastest a body turns (rad/s): a half turn takes at least a quarter second. */
const TURN_MAX_RATE = 12;

/**
 * Where the killing blow came FROM, in world space.
 *
 * A bolt that was in the air last snapshot, is gone this one, and was standing
 * on top of the body when it went IS the thing that killed it — that is the only
 * report of a killer the client ever gets, and it is the one that matters for a
 * spitter shooting the player in the back while he runs at something else.
 * Everything else is a melee hit, and the player is who that was.
 */
export function blowFrom(
  x: number,
  z: number,
  prev: Snapshot | null,
  next: Snapshot,
): Vector3 {
  let best: Vector3 | null = null;
  let bestDist = HIT_REACH;
  // Gone this snapshot, or lingering its one spent tick at the point it struck.
  const struck = [
    ...(prev?.entities ?? []).filter((e) => !next.entities.some((n) => n.id === e.id)),
    ...next.entities.filter((e) => e.spent),
  ];
  for (const e of struck) {
    if (e.kind !== "projectile") continue;
    const dist = Math.hypot(e.x - x, e.y - z);
    if (dist >= bestDist) continue;
    bestDist = dist;
    best = new Vector3(e.x, 0, e.y);
  }
  return best ?? new Vector3(next.player.x, 0, next.player.y);
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
  if (e.kind === "container") return "container";
  if (e.kind === "groundItem") return "groundItem";
  if (e.kind === "gold") return "gold";
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
  /** Yaw rate (rad/s) per entity, the spring's state between frames. */
  private readonly yawVel = new Map<number, number>();
  /** The tick each entity was last struck on. Absent means it is not lit. */
  private readonly hit = new Map<number, number>();
  /** The flinch each struck monster is in, and the root scale it squashes from. */
  private readonly flinch = new Map<number, { f: Flinch; base: number }>();
  /** Render time in ticks (snapshot tick plus interpolation), the flinch's clock. */
  private now = 0;
  /** Last cursor point fed in by the render loop; the target a new bolt flies at. */
  private aim: { x: number; y: number } | null = null;
  /** The player's last facing off the cursor, held while the cursor sits on top of him. */
  private aimFacing: { x: number; y: number } | null = null;
  /** Where a standing body faces while the head alone follows the cursor. */
  private restFacing: { x: number; y: number } | null = null;
  /** Newborn bolts offset to the casting hand: where each was launched and how
   *  far it has to go, which is the rate the offset is spent at. */
  /** Arrows left in each body, oldest first, with the tick each one comes out on. */
  private readonly stuck = new Map<Mesh, { arrow: Mesh; until: number }[]>();
  private readonly fromHand = new Map<number, { offset: Vector3; from: { x: number; y: number }; range: number; join: number }>();
  /** What each entity is drawn as, so a dead one can be told from a closed portal. */
  private readonly kinds = new Map<number, MeshKind>();
  /** Bodies the sim has forgotten, still falling. `until` is the tick they start
   *  to sink on; `restY` is the height they settled at, the sink measured down
   *  from it. */
  private readonly corpses: { mesh: Mesh; until: number; restY?: number }[] = [];
  private static readonly GAIT_PER_UNIT = 3.2;
  /** apply() runs several times per snapshot while interpolating; once-per-tick
   *  work (like firing a cast animation) is gated on this. */
  private lastTick = -1;
  private playerId: number | null = null;
  /** Entity id the mouse is hovering; drives mesh highlight, NOT inRange. */
  private hoveredEntityId: number | null = null;
  /** The last snapshot applied, for the DEV handles alone. */
  private lastSnapshot: Snapshot | null = null;
  /** The area the last applied snapshot was of; drives areaChanged. */
  private lastArea: string | null = null;
  /** Camera shake left, 0..1; read by the render loop through cameraShake(). */
  shakeTrauma = 0;
  /** Real ms the hit-stop lets go at; 0 when the world is running. */
  private hitStopUntil = 0;
  private lastFrameMs = 0;

  constructor(scene: Scene) {
    this.scene = scene;
    // DEV handle, like `window.__sfx` and `window.__scene`: a death is the one
    // thing that cannot be staged from a driven page (it needs a fight), and a
    // ragdoll that never falls looks exactly like one that was never asked to.
    if (typeof window !== "undefined" && import.meta.env?.DEV) {
      // The instance itself: a driven page cannot reach renderer internals any
      // other way (a dynamic import() gets its own module identity under Vite).
      (window as unknown as { __renderer?: SnapshotRenderer }).__renderer = this;
      (window as unknown as { __fell?: (id?: number) => boolean }).__fell = (id) => {
        const snap = this.lastSnapshot;
        if (!snap) return false;
        const target = id ?? snap.player.id;
        const mesh = this.meshes.get(target);
        if (!mesh || !this.fell(mesh, snap, null)) return false;
        this.meshes.delete(target);
        this.kinds.delete(target);
        return true;
      };
    }
  }

  /** Feed the cursor's world position to the casting arm's aim solver. */
  setAim(worldX: number, worldZ: number): void {
    // Also kept as the point a bolt born this frame is flying AT: that is what
    // turns the hand offset into a straight line rather than a parallel one.
    this.aim = { x: worldX, y: worldZ };
    if (this.playerId === null) return;
    const mesh = this.meshes.get(this.playerId);
    if (mesh) rigOf(mesh)?.setAimTarget(worldX, worldZ);
  }

  /**
   * Per-frame world position of an entity's mesh in sim coords, for DOM overlays.
   * The mesh glides on interpolated coords between 30 Hz snapshots, so this is
   * smoother than the snapshot the overlay was rendered from.
   */
  entityWorldPos(id: number): { x: number; y: number } | null {
    const mesh = this.meshes.get(id);
    return mesh ? { x: mesh.position.x, y: mesh.position.z } : null;
  }

  /** Offset for the camera target this frame: the jolt of a landed swing. */
  cameraShake(): { x: number; z: number } {
    return shakeOffset(this.shakeTrauma, performance.now());
  }

  /** Set the entity the mouse is hovering; drives portal/device highlight visuals. */
  setHoveredEntity(id: number | null): void {
    this.hoveredEntityId = id;
  }

  /** Leave a spent arrow in the monster it struck, if one stands within reach of the strike point. */
  private stickInBody(arrow: Mesh, x: number, z: number, next: Snapshot): void {
    let body: Mesh | undefined;
    let bodyId = -1;
    let best = HIT_REACH;
    for (const e of next.entities) {
      if (e.kind !== "monster") continue;
      const d = Math.hypot(e.x - x, e.y - z);
      const m = this.meshes.get(e.id);
      if (d < best && m) { best = d; body = m; bodyId = e.id; }
    }
    if (!body) return;
    const list = this.stuck.get(body) ?? [];
    if (list.length >= STUCK_ARROWS_MAX) list.shift()!.arrow.dispose();
    // Parented against the body's rest scale: caught mid-flinch, the squash would shear the arrow for good.
    const squashed = body.scaling.clone();
    const base = this.flinch.get(bodyId)?.base;
    if (base !== undefined) { body.scaling.setAll(base); body.computeWorldMatrix(true); }
    list.push({ arrow: stickArrow(this.scene, arrow, body), until: this.now + STUCK_ARROW_TICKS });
    body.scaling.copyFrom(squashed);
    this.stuck.set(body, list);
  }

  /** Expire stuck arrows, and forget bodies that were disposed with theirs. */
  private pullStuckArrows(): void {
    for (const [body, list] of this.stuck) {
      const kept = list.filter((s) => {
        if (s.arrow.isDisposed()) return false;
        if (s.until > this.now) return true;
        s.arrow.dispose();
        return false;
      });
      if (kept.length === 0 || body.isDisposed()) this.stuck.delete(body);
      else this.stuck.set(body, kept);
    }
  }

  apply(prev: Snapshot | null, next: Snapshot, alpha: number): void {
    // Collect the full set of ids that should exist after this call
    const liveIds = new Set<number>();
    // apply() runs several times per snapshot while interpolating, so anything
    // that reacts to a CHANGE has to know which of those frames is the first.
    const newTick = next.tick !== this.lastTick;
    this.now = next.tick + alpha;
    this.pullStuckArrows();
    this.lastSnapshot = next;
    const ms = performance.now();
    if (this.lastFrameMs > 0) this.shakeTrauma = decayTrauma(this.shakeTrauma, (ms - this.lastFrameMs) / 1000);
    this.lastFrameMs = ms;
    if (this.hitStopUntil > 0 && ms >= this.hitStopUntil) {
      this.scene.animationTimeScale = 1;
      this.hitStopUntil = 0;
    }
    // The swing that landed this tick, if any: a new strikeTick is the only edge a
    // held button leaves, since the next cast starts on the tick this one resolves.
    const strikeHits = newTick && prev !== null && next.player.strikeTick !== undefined
      && next.player.strikeTick !== prev.player.strikeTick ? next.player.strikeHits ?? 0 : 0;
    let meleeBursts = 0;
    /** Largest share of max life one body lost to this tick's swing: how hard the camera jolts. */
    let swingShare = 0;

    // Player
    this.playerId = next.player.id;
    liveIds.add(next.player.id);
    // He falls like anything else does. The mesh leaves the live set the moment
    // he dies, so nothing walks it about the floor while it is a corpse, and the
    // revive builds a new one — standing, at the checkpoint, which is the point.
    const playerCorpse = this.meshes.get(next.player.id);
    if (!next.player.alive && playerCorpse) {
      if (this.fell(playerCorpse, next, prev)) {
        this.meshes.delete(next.player.id);
        this.kinds.delete(next.player.id);
      }
    }
    // PoE2 WASD: the body always faces the cursor and the keys carry it, so the
    // legs strafe or backpedal. The sim's facing covers a player with no cursor.
    if (this.aim) {
      const px = lerp(prev?.player.x ?? next.player.x, next.player.x, alpha);
      const py = lerp(prev?.player.y ?? next.player.y, next.player.y, alpha);
      const ax = this.aim.x - px;
      const ay = this.aim.y - py;
      const d = Math.hypot(ax, ay);
      if (d > AIM_DEAD_ZONE) this.aimFacing = { x: ax / d, y: ay / d };
    }
    const standing = prev !== null && prev.player.x === next.player.x && prev.player.y === next.player.y
      && !next.player.casting && next.player.facing === undefined;
    const rest = this.restFacing;
    if (this.aimFacing && (!standing || !rest
      || this.aimFacing.x * rest.x + this.aimFacing.y * rest.y < Math.cos(STAND_TURN_AT))) {
      this.restFacing = this.aimFacing;
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
      undefined,
      (standing ? this.restFacing : this.aimFacing) ?? next.player.facing,
    );

    // Dress the character from what the sim says he is wearing. Asserted every
    // frame rather than on a change: `setLooks` only moves visibility and exits
    // early when nothing differs, and doing it here self-heals a mesh that was
    // rebuilt underneath us.
    const playerMesh = this.meshes.get(next.player.id);
    if (playerMesh) rigOf(playerMesh)?.setLooks(looksForEquipment(next.equipment ?? {}));

    // Portals arriving this snapshot, in ring order (spawnPortalRing creates them
    // in that order, so ascending entity id IS the arc). Their index is what the
    // stagger is measured in — see portalAppear.
    //
    // A portal is only ARRIVING if we were watching the same place a moment ago.
    // Without that, every portal already standing in a place the client is seeing
    // for the first time announces itself with the opening sweep: walking into a
    // map plays it over the return portal, and in dev an HMR reload plays it on
    // every save, which is where it was finally heard. Same rule the closing cue
    // already carries — a missing previous snapshot is not an event.
    const arrivingPortals = prev !== null && prev.area === next.area
      ? next.entities
        .filter((e) => e.kind === "portal" && !this.meshes.has(e.id))
        .map((e) => e.id)
        .sort((a, b) => a - b)
      : [];

    // Entities
    for (const e of next.entities) {
      liveIds.add(e.id);
      const prevE = prev?.entities.find((p) => p.id === e.id);
      // On the bolt's first tick the cast animation hasn't moved the arm yet,
      // so castPoint() returns the idle-pose hand (at the hip). Skip the first
      // tick entirely: the bolt is invisible for 1/30s, and on the second tick
      // the arm is raised and castPoint() gives the real weapon tip.
      const playerRig = playerMesh ? rigOf(playerMesh) : undefined;
      // A spent bolt is drawn where it struck, never from the hand: point blank it
      // lives a single visible snapshot, and the burst goes off where it stands.
      if (e.kind === "projectile" && (e.team ?? 0) === 0 && playerRig && !this.meshes.has(e.id) && !e.spent) {
        if (!this.fromHand.has(e.id)) {
          this.fromHand.set(e.id, { offset: Vector3.Zero(), from: { x: e.x, y: e.y }, range: ASSUMED_RANGE, join: HAND_BLEND_MAX });
          continue;
        }
        const hand = playerRig.castPoint();
        if (hand) {
          // How far this bolt has to go: the cursor point the cast was aimed at,
          // which is the aim the frame before it appeared. An arrow drops over
          // it; floored, or one aimed at the player's own feet dives straight down.
          const aimed = this.aim ? Math.hypot(this.aim.x - e.x, this.aim.y - e.y) : ASSUMED_RANGE;
          this.fromHand.set(e.id, {
            offset: hand.subtract(new Vector3(e.x, Y_LIFT.projectile, e.y)),
            from: { x: e.x, y: e.y },
            range: Math.max(3, aimed),
            join: Math.min(HAND_BLEND_MAX, Math.max(0.5, aimed)),
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
      let kp = 0;
      let kn = 0;
      let dp = 0;
      let dn = 0;
      if (handEntry) {
        /*
         * The sim flies the bolt from the player's CENTRE; it is drawn from the
         * weapon tip. The offset is spent over the flight to the aim point (capped
         * at HAND_BLEND_MAX), one straight line from the tip to where it was aimed,
         * and from there the bolt is drawn exactly where the sim flies it. Each end of the interpolated
         * step carries its own share, or the offset shrinks in tick-sized jumps.
         */
        const flown = (x: number, y: number) => Math.hypot(x - handEntry.from.x, y - handEntry.from.y);
        const share = (x: number, y: number) => Math.max(0, 1 - flown(x, y) / handEntry.join);
        kp = share(ox, oy);
        kn = e.spent ? 0 : share(e.x, e.y);
        ox += handEntry.offset.x * kp;
        oy += handEntry.offset.z * kp;
        nx += handEntry.offset.x * kn;
        ny += handEntry.offset.z * kn;
        // An arrow drops from the bow hand to the flight height over the aim
        // distance: a 1.5-unit drop would dip it steeply and then level it off.
        dp = Math.max(0, 1 - flown(prevE?.x ?? e.x, prevE?.y ?? e.y) / handEntry.range);
        dn = Math.max(0, 1 - flown(e.x, e.y) / handEntry.range);
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
        // for containers, the base id for ground items (makeMesh reads it per kind).
        e.species ?? e.look ?? e.baseId ?? (e.kind === "gold" ? `gold:${e.amount ?? 1}:${e.jackpot ? 1 : 0}` : undefined),
        undefined,
        e.skillId,
      );
      const mesh = this.meshes.get(e.id);
      if (!mesh) continue;
      if (e.kind === "monster") {
        const far = Math.hypot(e.x - next.player.x, e.y - next.player.y) > SLEEP_RANGE;
        if (mesh.isEnabled(false) === far) mesh.setEnabled(!far);
        creatureOf(mesh)?.setAwake(!far);
      }
      if (e.kind === "projectile" && fxProfile(e.skillId).arrow) {
        // Floored at the aim point: past it the arrow flies level, not into the floor.
        const drop = handEntry?.offset.y ?? 0;
        const yo = Y_LIFT.projectile + drop * dp;
        const yn = Y_LIFT.projectile + drop * dn;
        mesh.position.y = lerp(yo, yn, alpha);
        if (handEntry) {
          const loosedX = handEntry.from.x + handEntry.offset.x;
          const loosedZ = handEntry.from.y + handEntry.offset.z;
          setStreakLength(mesh, Math.hypot(mesh.position.x - loosedX, mesh.position.z - loosedZ));
        }
        // Pointed down its DRAWN path: the hand offset bends it off the sim's.
        const run = Math.hypot(nx - ox, ny - oy);
        if (run > 1e-6) {
          mesh.rotation.y = Math.atan2(nx - ox, ny - oy);
          mesh.rotation.x = Math.atan2(yo - yn, run);
        }
        if (e.spent) mesh.metadata = { ...(mesh.metadata ?? {}), struck: true };
      }
      // The sim swung: one-shot strike over whatever locomotion was playing.
      creatureOf(mesh)?.noteAttack(e.attackTick);
      // Struck: life is the only report of a hit the client gets, and it is the
      // honest one — a swing that missed or was absorbed never moves it.
      if (newTick && e.life !== undefined && prevE?.life !== undefined && e.life < prevE.life) {
        this.hit.set(e.id, next.tick);
        const meleeHit = strikeHits > 0 && e.kind === "monster"
          && Math.hypot(e.x - next.player.x, e.y - next.player.y) <= MELEE_FX_REACH;
        if (meleeHit) swingShare = Math.max(swingShare, (prevE.life - Math.max(0, e.life)) / (e.maxLife ?? prevE.life));
        if (meleeHit && meleeBursts < MAX_MELEE_BURSTS) {
          meleeBursts++;
          meleeImpact(this.scene, new Vector3(e.x, Y_LIFT.projectile, e.y), e.x - next.player.x, e.y - next.player.y);
        }
        if (e.kind === "monster" && e.life > 0) {
          const from = blowFrom(e.x, e.y, prev, next);
          const was = this.flinch.get(e.id);
          const tier = e.boss ? "boss" : e.rare ? "rare" : "monster";
          const strength = flinchStrength(prevE.life - e.life, e.maxLife ?? prevE.life, tier) * (meleeHit ? MELEE_KICK : 1);
          this.flinch.set(e.id, {
            f: kick(was?.f, this.now, e.x - from.x, e.y - from.z, strength),
            base: was?.base ?? mesh.scaling.y,
          });
        }
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
    // Against the renderer's OWN last-applied area, never prev's: snapshots
    // advance per worker message but apply() runs per rendered frame, so a
    // burst across the transition (the loading plate all but guarantees one)
    // skips the straddling pair and prev is already in the new area.
    const areaChanged = this.lastArea !== next.area;
    this.lastArea = next.area;

    // Corpses belong to the place they fell in. They live outside `this.meshes`,
    // so without this they ride the crossing and lie in the new area until their
    // sink timer expires — ~220 of a map's meshes in the hideout for 28 seconds.
    if (areaChanged && this.corpses.length > 0) {
      for (const corpse of this.corpses) {
        disposeRagdoll(corpse.mesh);
        rigOf(corpse.mesh)?.dispose();
        creatureOf(corpse.mesh)?.dispose();
        corpse.mesh.dispose();
      }
      this.corpses.length = 0;
    }

    // Dispose meshes for entities that no longer exist. A rig owns scene-level
    // animation groups that mesh.dispose() would leave behind.
    for (const [id, mesh] of this.meshes) {
      if (!liveIds.has(id)) {
        // A body dies at its own size: a squash caught mid-flinch would freeze into the corpse.
        const struck = this.flinch.get(id);
        if (struck) mesh.scaling.setAll(struck.base);
        // A closing portal outlives the entity that was it: nothing else holds a
        // reference any more, so the collapse disposes it when it finishes.
        if (!areaChanged && isPortalMesh(mesh)) {
          rigOf(mesh)?.dispose();
          portalVanish(this.scene, mesh);
        } else if (!areaChanged && BODIES.has(this.kinds.get(id) ?? "groundArea")
          && this.fell(mesh, next, prev)) {
          // Kept: it is a corpse now, and owned by `corpses` rather than by the
          // entity id, which the sim is free to hand to something else.
        } else {
          // Its burst fires on dispose: put it on the struck point first, not partway
          // through the last interpolated step toward it.
          const last = prev?.entities.find((p) => p.id === id);
          if (last?.spent) { mesh.position.x = last.x; mesh.position.z = last.y; mesh.computeWorldMatrix(true); }
          if (last?.spent && last.kind === "projectile" && fxProfile(last.skillId).arrow) this.stickInBody(mesh, last.x, last.y, next);
          rigOf(mesh)?.dispose();
          creatureOf(mesh)?.dispose();
          mesh.dispose();
        }
        this.meshes.delete(id);
        this.kinds.delete(id);
        this.gait.delete(id);
        this.tilt.delete(id);
        this.yawVel.delete(id);
        this.hit.delete(id);
        this.flinch.delete(id);
        this.fromHand.delete(id);
      }
    }

    // Corpses whose time is up. They lie there long enough to be walked over and
    // looted around, then go down through the floor rather than blinking out:
    // the disappearance is what the eye catches, so it is spent on something
    // that reads as the ground taking the body.
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const corpse = this.corpses[i]!;
      if (next.tick < corpse.until) continue;
      if (corpse.restY === undefined) {
        // Physics has to let go first, or the ragdoll writes the body back to
        // the world position it settled at on every frame of the sink.
        freezeRagdoll(corpse.mesh);
        corpse.restY = corpse.mesh.position.y;
      }
      const done = next.tick - corpse.until;
      if (done >= SINK_TICKS) {
        this.corpses.splice(i, 1);
        disposeRagdoll(corpse.mesh);
        rigOf(corpse.mesh)?.dispose();
        creatureOf(corpse.mesh)?.dispose();
        corpse.mesh.dispose();
        continue;
      }
      corpse.mesh.position.y = corpse.restY - sinkDepth(done / SINK_TICKS);
    }

    if (strikeHits > 0) {
      // The pose holds on the real clock, never the sim's: the world keeps running.
      this.scene.animationTimeScale = HIT_STOP_SCALE;
      this.hitStopUntil = performance.now() + hitStopMs(strikeHits);
      this.shakeTrauma = addTrauma(this.shakeTrauma, strikeHits, swingWeight(swingShare));
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
          next.player.castWindupTicks === undefined ? undefined : next.player.castWindupTicks / TICKS_PER_SEC,
        );
      }
      const reaction = prev ? reactionFor(prev, next) : null;
      if (reaction) {
        const playerMesh = this.meshes.get(next.player.id);
        (playerMesh ? rigOf(playerMesh) : undefined)?.playReaction(reaction);
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
  private fell(mesh: Mesh, next: Snapshot, prev: Snapshot | null): boolean {
    const push = mesh.position
      .subtract(blowFrom(mesh.position.x, mesh.position.z, prev, next));
    push.y = 0;
    if (push.lengthSquared() < 1e-4) push.set(0, 0, 1);
    push.normalize().y = DEATH_LIFT;
    // WHERE the blow landed, which is what makes one death different from the
    // next. An impulse at the root is applied at the feet, so every body was
    // swept off its legs the same way and landed flat like a dropped plank.
    // Chest height topples it, and a random step off the centre line turns it as
    // it goes — the same rule as everything else in docs/09: the variance is the
    // effect, and there is no seed here because nothing replays a corpse.
    const side = new Vector3(-push.z, 0, push.x).normalize()
      .scale((Math.random() * 2 - 1) * DEATH_OFF_CENTRE);
    const at = mesh.position.add(new Vector3(0, DEATH_CHEST, 0)).add(side);
    // A kill past SLEEP_RANGE lands on a sleeping body; the ragdoll needs it live.
    mesh.setEnabled(true);
    creatureOf(mesh)?.setAwake(true);
    if (!dropDead(this.scene, mesh, push, at)) return false;
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
    skillId?: string,
    facing?: { x: number; y: number },
  ): void {
    let mesh = this.meshes.get(id);
    const fresh = !mesh;
    const x = lerp(prevX, nextX, alpha);
    const z = lerp(prevY, nextY, alpha);
    if (!mesh) {
      // Born where it belongs. A mesh built at the origin and moved afterwards
      // drags any trail it owns across the level on its first frames.
      mesh = makeMesh(this.scene, kind, `entity-${id}`, new Vector3(x, Y_LIFT[kind], z), species, skillId);
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
    // The step is the heading for everything that steers into its own movement.
    // The player does not, quite: a target inside his turning circle is walked
    // at in a straight line while the body comes about at its own rate, so the
    // sim sends the heading and this follows THAT or he pivots with the cursor.
    //
    // And a sent heading turns him whether or not he is moving, which is the
    // only way a man standing still can face what he is casting at. Zero is not
    // a direction — a heading nobody has written yet would snap him to +z.
    //
    // A held skill's `facing` outranks the heading: the body turns to the target
    // and the keys keep carrying it, so the legs sidestep or backpedal (PoE2).
    const turnTo = facing ?? heading;
    const sent = turnTo && (turnTo.x !== 0 || turnTo.y !== 0)
      ? Math.atan2(turnTo.x, turnTo.y)
      : null;
    if (dx * dx + dz * dz > 1e-6 || sent !== null) {
      const wasYaw = mesh.rotation.y;
      const aim = sent ?? Math.atan2(dx, dz);
      const dt = Math.max(this.scene.getEngine().getDeltaTime(), 1) / 1000;
      const s = springAngle(wasYaw, this.yawVel.get(id) ?? 0, aim, TURN_OMEGA, Math.min(dt, 0.1), TURN_MAX_RATE);
      mesh.rotation.y = s.angle;
      this.yawVel.set(id, s.vel);
      yawStep = mesh.rotation.y - wasYaw;
    } else {
      this.yawVel.set(id, 0);
    }
    const moving = dx * dx + dz * dz > 1e-6;
    // Only a held skill's facing parts the legs from the chest. Otherwise the body
    // is turning INTO its move, and the lag of that turn is not a sidestep.
    const rel = moving && facing ? Math.atan2(dx, dz) - mesh.rotation.y : 0;
    rigOf(mesh)?.setMoveAngle(rel, yawStep);
    rigOf(mesh)?.setLookYaw(moving ? (sent ?? Math.atan2(dx, dz)) : null);
    // A stopped actor still needs frames to settle back upright. Skipping this
    // call used to freeze the last running bank indefinitely. Turning to a
    // target is not a corner, and a backpedal does not lead with the chest.
    if (facing) this.lean(id, mesh, kind, 0, speed * Math.max(0, Math.cos(rel)));
    else this.lean(id, mesh, kind, yawStep, speed);
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
    const ease = 1 - Math.exp(-dt / TILT_EASE_SEC);
    const nextRoll = lerp(roll, rollTo, ease);
    const nextPitch = lerp(pitch, pitchTo, ease);
    this.tilt.set(id, [nextRoll, nextPitch]);
    // The flinch rides on top of the run's lean and is never eased into it: the
    // snap IS the hit, and the tilt state stays the run's alone.
    let drawRoll = nextRoll;
    let drawPitch = nextPitch;
    const struck = this.flinch.get(id);
    if (struck) {
      const pose = flinchPose(struck.f, this.now);
      const t = leanToTilt(mesh.rotation.y, pose.x, pose.z);
      drawRoll += t.roll;
      drawPitch += t.pitch;
      mesh.scaling.set(struck.base * (1 + pose.squash / 2), struck.base * (1 - pose.squash), struck.base * (1 + pose.squash / 2));
      if (this.now - struck.f.start >= FLINCH_TICKS) this.flinch.delete(id);
    }
    mesh.rotation.z = drawRoll;
    mesh.rotation.x = drawPitch;
    // The body leans; the pool it stands in does not. See `keepGroundBlobFlat`.
    keepGroundBlobFlat(mesh, drawPitch, drawRoll);
  }
}
