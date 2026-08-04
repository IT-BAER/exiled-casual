import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import {
  playSfx, preloadSfx,
  startSfxLoop, setSfxLoopVolume, stopSfxLoop, stopAllSfxLoops,
  worldSfxMix,
} from "./sfx";
import { setRoom } from "./bus";

/**
 * The fight, heard rather than described.
 *
 * The client is given snapshots, not events, so every sound here is a DIFFERENCE
 * between two of them: a monster that was in the last one and is not in this one
 * died, a telegraph that vanished landed, a flask charge spent was drunk. That is
 * the only honest source available — the sim never says "a claw connected" — and it
 * has the useful property that a sound can never fire for something that did not
 * actually happen in the world.
 *
 * Two exceptions. The UI clicks fire at their own dispatch sites, because a button
 * press is not a change to the world. And the portals belong to the renderer
 * (meshes.ts): the snapshot says all six arrived on one tick, but they open a
 * quarter-second apart, and only the thing staggering them knows when each one is
 * meant to be heard.
 *
 * Casts are NOT an exception: they are read off the cooldown a successful cast set,
 * which costs a frame and buys the guarantee that a bolt refused for mana never
 * makes the noise of one that flew.
 *
 * Timing is measured in TICKS off the snapshot, never in wall-clock milliseconds:
 * the sim is the clock, so a stall cannot make footsteps run while the player is
 * standing still.
 */

/** Ticks between footfalls while moving. Ten is a third of a second, PoE's cadence. */
const STEP_TICKS = 10;
/** How far the player must have moved between snapshots to count as walking. */
const STEP_MIN_MOVE = 0.02;
/**
 * How many hits apart two hit cues are, at the least and at the most.
 *
 * A grunt on every connect is a rattle rather than a fight: at three attacks a
 * second the cue stops being an event and becomes the texture of combat, and the
 * ear filters it out. So one hit in five to ten is heard. Counted in HITS, not in
 * ticks, which is the unit that survives attack speed: a fast weapon and a slow one
 * sound equally sparse. Deaths stay ungated — that one is the reward.
 */
const HIT_GATE_MIN = 5;
const HIT_GATE_MAX = 10;

/**
 * A counter that says yes once per five-to-ten calls, and on the first.
 *
 * The first is deliberate: a fight whose opening connect is the silent one reads as
 * a hit that did not register.
 */
function hitGate(): () => boolean {
  let skip = 0;
  return () => {
    if (skip > 0) { skip--; return false; }
    skip = HIT_GATE_MIN - 1 + Math.floor(Math.random() * (HIT_GATE_MAX - HIT_GATE_MIN + 1));
    return true;
  };
}

/**
 * Most sounds of one kind in a single snapshot. A Cinder Ground over eight bodies
 * would otherwise fire eight samples on one tick, which is not eight hits — it is
 * one loud smear, and docs/09 rule 2 wants the hit audible, not the mix ruined.
 */
const MAX_PER_KIND = 3;
/** Inside this distance a hit on the player is something's hands, not something's spell. */
const MELEE_RANGE = 2.4;

/**
 * What a monster is MADE of, because that is what a hit on it sounds like.
 *
 * One `monster-hurt` served a carved stone construct, a desiccated husk, wet chitin
 * and meat under iron, and it was written for none of them. The fix is not one sample
 * per species — that is 32 files to tell a husk from a skitterer, which are the same
 * dry thing — it is one per material, which is the axis the ear actually hears.
 *
 * A species with no entry keeps the generic cue, so a monster added tomorrow is
 * quietly ordinary rather than silent.
 */
const MATERIAL: Record<string, string> = {
  "monster.vaal_construct.v1": "stone",
  "monster.sunbaked_colossus.v1": "stone",
  "monster.vaal_husk.v1": "husk",
  "monster.sand_skitterer.v1": "husk",
  "monster.dune_spitter.v1": "husk",
  "monster.bog_drowned.v1": "bog",
  "monster.rotting_behemoth.v1": "bog",
  "monster.mother_vhal.v1": "bog",
  "monster.blood_sentinel.v1": "beast",
  "monster.thornhide_boar.v1": "beast",
  "monster.bramble_whelp.v1": "beast",
  "monster.ghaltrek.v1": "beast",
  "monster.cinder_imp.v1": "ember",
  "monster.cinder_warden.v1": "ember",
  "monster.sirrath.v1": "ember",
  "monster.fen_wisp.v1": "spirit",
  "monster.hoarfrost_spitter.v1": "spirit",
};

/** `monster-death` for a stranger, `monster-death-stone` for something carved. */
function cueFor(base: string, species: string | undefined): string {
  const material = species === undefined ? undefined : MATERIAL[species];
  return material === undefined ? base : `${base}-${material}`;
}

/**
 * What the floor of a biome is MADE of, because that is what a boot on it sounds
 * like. Same argument as `MATERIAL` above, and the same shape: keyed on the axis the
 * ear hears rather than on the place, so two biomes over the same ground share it.
 *
 * A biome with no entry — and the hideout, which has no map base at all — walks on
 * stone, because the one floor in the game that is definitely paved is his.
 */
const GROUND: Record<string, string> = {
  vaal_stone: "stone",
  desert: "dirt",
  swamp: "mud",
  forest: "grass",
  strand: "dirt",
};
const DEFAULT_GROUND = "stone";

/**
 * How much of each cue's own reverb the place gives back, as a multiplier.
 *
 * The axis is enclosure, not biome: a stone hall and a cave return almost
 * everything, open sand returns nearly nothing, and trees sit between because
 * they scatter what they do not swallow. The hideout is a vault with a roof, so
 * it is wetter than one, and it is what an unlisted area falls back to.
 */
const ROOM: Record<string, number> = {
  vaal_stone: 1.6,
  swamp: 0.7,
  forest: 0.55,
  desert: 0.3,
  // The most open place in the game: sand underfoot and water on one side, so
  // there is nothing at all to give a cue back.
  strand: 0.2,
};
const HIDEOUT_ROOM = 1.15;
/** Falls per ground on disk, `footstep-<ground>-1..N`. */
const GROUND_VARIANTS = 3;
/**
 * Quietest a footfall may be, as a fraction of its voice's own level.
 *
 * Three samples is not enough variety on its own for a cue that fires every third
 * of a second all game: the sample is only one of three things that differ per step,
 * the other two being pitch (`vary` in sfx.ts) and this. Down-only, because the
 * voice's gain is a ceiling that `playSfx` clamps to.
 */
const STEP_LEVEL_FLOOR = 0.65;

/** Which cue a skill's own cast makes. A skill with no entry casts silently. */
const CAST_SFX: Record<string, string> = {
  "skill.ember_bolt.v1": "skill-ember-bolt-cast",
  "skill.cinder_ground.v1": "skill-cinder-ground-cast",
  "skill.blink.v1": "skill-blink",
};

export interface Soundscape {
  /** Called once per snapshot, in arrival order. */
  observe(snap: Snapshot): void;
  /**
   * New area: the next snapshot is a different world, so nothing carries over.
   *
   * `biomeId` is what the area is made of, `null` for the hideout. Omitting it keeps
   * the current ground, which is what the rebuild path inside `observe` needs — that
   * is one area failing to diff against itself, not a journey.
   */
  reset(biomeId?: string | null): void;
}

interface Options {
  play?: (name: string, volume?: number, distance?: number, pan?: number) => void;
  loop?: (name: string, key: string, volume?: number, distance?: number, pan?: number) => void;
  loopVolume?: (key: string, volume: number, distance?: number, pan?: number) => void;
  room?: (amount: number) => void;
  stopLoop?: (key: string) => void;
  stopAllLoops?: () => void;
}

/**
 * The sustained cue an entity carries while it exists, and nothing for the kinds
 * that carry none. A player bolt burns all the way to whatever it hits; cinder
 * ground burns for its whole duration. Both were a single one-shot at the cast,
 * which is over long before the thing it described is.
 */
function sustainedCue(e: SnapshotEntity): string | null {
  if (e.kind === "projectile") return (e.team ?? 0) === 0 ? "skill-ember-bolt-flight" : null;
  if (e.kind === "groundArea") return "skill-cinder-ground-loop";
  return null;
}

export function createSoundscape(opts: Options = {}): Soundscape {
  const play = opts.play ?? playSfx;
  const loop = opts.loop ?? startSfxLoop;
  const loopVolume = opts.loopVolume ?? setSfxLoopVolume;
  const stopLoop = opts.stopLoop ?? stopSfxLoop;
  const stopAllLoops = opts.stopAllLoops ?? stopAllSfxLoops;
  const room = opts.room ?? setRoom;
  /** Entity id -> loop key, for everything currently sounding. */
  const sustained = new Map<number, string>();
  let prev: Snapshot | null = null;
  /**
   * One gate for the whole pack, not one per monster: eight monsters each heard
   * every seventh hit is a roar, and what he asked to thin out is the RATE at the
   * ear, which only a shared counter controls.
   */
  let dealt = hitGate();
  let taken = hitGate();
  let lastStepTick = 0;
  /** 0-based index of the sample the last footfall used, so the next one differs. */
  let stepVariant = 0;
  let ground = DEFAULT_GROUND;

  const reset = (biomeId?: string | null): void => {
    prev = null;
    // Before the ids are gone: the next area reuses them, and a voice left running
    // would be stopped by whatever inherits its number, or by nothing at all.
    stopAllLoops();
    sustained.clear();
    dealt = hitGate();
    taken = hitGate();
    lastStepTick = 0;
    if (biomeId === undefined) return;
    ground = GROUND[biomeId ?? ""] ?? DEFAULT_GROUND;
    room(biomeId === null ? HIDEOUT_ROOM : ROOM[biomeId] ?? HIDEOUT_ROOM);
    // Ahead of the first step rather than on it: an area message arrives well
    // before the player has walked anywhere in the place it describes.
    void preloadSfx(Array.from(
      { length: GROUND_VARIANTS }, (_, i) => `footstep-${ground}-${i + 1}`));
  };

  return {
    reset,
    observe(snap: Snapshot): void {
      const before = prev;
      prev = snap;
      if (before === null) return;
      // A rebuilt area replaces every entity at once. Diffing across that would
      // report the whole population as dead and every portal as closed.
      if (before.area !== snap.area || snap.tick < before.tick) { reset(); prev = snap; return; }

      const was = new Map<number, SnapshotEntity>();
      for (const e of before.entities) was.set(e.id, e);
      const now = new Map<number, SnapshotEntity>();
      for (const e of snap.entities) now.set(e.id, e);

      // Level, distance and direction are spread into the call: volume, muffling,
      // and stereo bearing are related but independent parts of world position.
      const at = (e: SnapshotEntity): [number, number, number] => {
        const dx = e.x - snap.player.x;
        const dy = e.y - snap.player.y;
        return worldSfxMix(dx, dy);
      };

      // ── Gone ────────────────────────────────────────────────────────────────
      let deaths = 0;
      for (const [id, e] of was) {
        if (now.has(id)) continue;
        if (e.kind === "monster" && deaths < MAX_PER_KIND) {
          deaths++;
          play(cueFor("monster-death", e.species), ...at(e));
        } else if (e.kind === "telegraph") {
          // A ring only ever leaves the world by landing.
          play("monster-slam-impact", ...at(e));
        } else if (e.kind === "projectile" && (e.team ?? 0) === 0) {
          // His own bolt, spent: it either hit something or ran out of range, and
          // both are the same burst as far as the ear is concerned.
          play("skill-ember-bolt-impact", ...at(e));
        }
        // Whatever it was, it is not sounding any more.
        const key = sustained.get(id);
        if (key !== undefined) { sustained.delete(id); stopLoop(key); }
      }

      // ── Arrived ─────────────────────────────────────────────────────────────
      for (const [id, e] of now) {
        if (was.has(id)) continue;
        if (e.kind === "telegraph") play("monster-slam-windup", ...at(e));
        else if (e.kind === "projectile" && (e.team ?? 0) !== 0) play("monster-spit", ...at(e));
        const cue = sustainedCue(e);
        if (cue) {
          const key = `${cue}#${id}`;
          sustained.set(id, key);
          loop(cue, key, ...at(e));
        }
      }

      // A voice already running follows its source: a bolt crossing the screen and a
      // fire the player walks away from both have to move in the mix, or the level
      // they started at is the level they keep until they stop.
      for (const [id, key] of sustained) {
        const e = now.get(id);
        if (e) loopVolume(key, ...at(e));
      }

      // ── Hurt ────────────────────────────────────────────────────────────────
      for (const [id, e] of now) {
        if (e.kind !== "monster" || e.life === undefined) continue;
        const old = was.get(id);
        if (old?.life === undefined || e.life >= old.life) continue;
        // Every hit is counted, one in five to ten is heard, so the gate must be
        // asked about all of them and never short-circuited past.
        if (!dealt()) continue;
        play(cueFor("monster-hurt", e.species), ...at(e));
      }

      // The player taking a hit: something's hands if anything is standing on him,
      // and something's spell otherwise. Two samples for one event reads as variety
      // rather than as a double hit, because only one of them ever plays.
      if ((snap.player.life < before.player.life
        || snap.player.energyShield < before.player.energyShield) && taken()) {
        const adjacent = snap.entities.some((e) =>
          e.kind === "monster"
          && Math.hypot(e.x - snap.player.x, e.y - snap.player.y) <= MELEE_RANGE);
        play(adjacent ? "monster-melee-hit" : "player-hurt");
      }

      // ── Casts ───────────────────────────────────────────────────────────────
      // A cooldown that went UP is a cast the sim accepted; it only ever falls
      // otherwise. So a bolt refused for mana or still on cooldown is silent, and
      // the ear is never told about a spell that did not happen.
      for (const [skillId, remaining] of Object.entries(snap.player.cooldowns)) {
        if (remaining <= (before.player.cooldowns[skillId] ?? 0)) continue;
        const cue = CAST_SFX[skillId];
        if (cue) play(cue);
      }

      // ── Flask, map device, feet ─────────────────────────────────────────────
      const f = snap.player.flasks;
      const pf = before.player.flasks;
      if (f.lifeCharges < pf.lifeCharges || f.manaCharges < pf.manaCharges) play("flask-drink");
      // The stone going in, heard once: mapOpen only rises on an activation.
      if (snap.mapOpen && !before.mapOpen) play("waystone-activate");

      const moved = Math.hypot(snap.player.x - before.player.x, snap.player.y - before.player.y);
      if (moved > STEP_MIN_MOVE && snap.player.alive) {
        if (snap.tick - lastStepTick >= STEP_TICKS) {
          lastStepTick = snap.tick;
          // Advance by one or two, never by zero: uniform over the OTHER samples,
          // with no loop and no chance of the same one twice running. Strict
          // alternation of a pair — what this used to do — is a rhythm the ear locks
          // onto by the third step, and then every step after it is the same step.
          stepVariant = (stepVariant + 1 + Math.floor(Math.random() * (GROUND_VARIANTS - 1)))
            % GROUND_VARIANTS;
          play(`footstep-${ground}-${stepVariant + 1}`,
            STEP_LEVEL_FLOOR + Math.random() * (1 - STEP_LEVEL_FLOOR));
        }
      } else {
        // Standing still re-arms the next footfall, so the first step off a stop
        // sounds immediately instead of waiting out the rest of a cadence.
        lastStepTick = snap.tick - STEP_TICKS;
      }
    },
  };
}
