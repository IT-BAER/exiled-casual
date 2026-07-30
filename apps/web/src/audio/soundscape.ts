import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { distanceGain, playSfx } from "./sfx";

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
/** Ticks a single monster has to wait before it may grunt again. */
const HURT_COOLDOWN_TICKS = 7;
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

/** Which cue a skill's own cast makes. A skill with no entry casts silently. */
const CAST_SFX: Record<string, string> = {
  "skill.ember_bolt.v1": "skill-ember-bolt-cast",
  "skill.cinder_ground.v1": "skill-cinder-ground-cast",
  "skill.blink.v1": "skill-blink",
};

export interface Soundscape {
  /** Called once per snapshot, in arrival order. */
  observe(snap: Snapshot): void;
  /** New area: the next snapshot is a different world, so nothing carries over. */
  reset(): void;
}

interface Options {
  play?: (name: string, volume?: number) => void;
}

export function createSoundscape(opts: Options = {}): Soundscape {
  const play = opts.play ?? playSfx;
  let prev: Snapshot | null = null;
  /** Last tick each monster was heard taking a hit, so a swarm does not roar. */
  const lastHurt = new Map<number, number>();
  let lastStepTick = 0;
  let stepFoot = 0;

  const reset = (): void => {
    prev = null;
    lastHurt.clear();
    lastStepTick = 0;
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

      const at = (e: SnapshotEntity): number =>
        distanceGain(Math.hypot(e.x - snap.player.x, e.y - snap.player.y));

      // ── Gone ────────────────────────────────────────────────────────────────
      let deaths = 0;
      for (const [id, e] of was) {
        if (now.has(id)) continue;
        if (e.kind === "monster" && deaths < MAX_PER_KIND) {
          deaths++;
          play(cueFor("monster-death", e.species), at(e));
        } else if (e.kind === "telegraph") {
          // A ring only ever leaves the world by landing.
          play("monster-slam-impact", at(e));
        } else if (e.kind === "projectile" && (e.team ?? 0) === 0) {
          // His own bolt, spent: it either hit something or ran out of range, and
          // both are the same burst as far as the ear is concerned.
          play("skill-ember-bolt-impact", at(e));
        }
        lastHurt.delete(id);
      }

      // ── Arrived ─────────────────────────────────────────────────────────────
      for (const [id, e] of now) {
        if (was.has(id)) continue;
        if (e.kind === "telegraph") play("monster-slam-windup", at(e));
        else if (e.kind === "projectile" && (e.team ?? 0) !== 0) play("monster-spit", at(e));
      }

      // ── Hurt ────────────────────────────────────────────────────────────────
      let hurts = 0;
      for (const [id, e] of now) {
        if (e.kind !== "monster" || e.life === undefined) continue;
        const old = was.get(id);
        if (old?.life === undefined || e.life >= old.life) continue;
        if (snap.tick - (lastHurt.get(id) ?? -999) < HURT_COOLDOWN_TICKS) continue;
        if (hurts >= MAX_PER_KIND) continue;
        hurts++;
        lastHurt.set(id, snap.tick);
        play(cueFor("monster-hurt", e.species), at(e));
      }

      // The player taking a hit: something's hands if anything is standing on him,
      // and something's spell otherwise. Two samples for one event reads as variety
      // rather than as a double hit, because only one of them ever plays.
      if (snap.player.life < before.player.life || snap.player.energyShield < before.player.energyShield) {
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
          stepFoot ^= 1;
          play(stepFoot === 0 ? "footstep-dirt-a" : "footstep-dirt-b");
        }
      } else {
        // Standing still re-arms the next footfall, so the first step off a stop
        // sounds immediately instead of waiting out the rest of a cadence.
        lastStepTick = snap.tick - STEP_TICKS;
      }
    },
  };
}
