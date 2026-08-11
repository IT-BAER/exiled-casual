# Skill Identity and Area Music Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every skill gets its own look and voice instead of one shared orange trail, and every area
plays music under the ambience already there.

**Architecture:** The renderer cannot currently tell one skill from another, because a projectile on
the wire carries no skill id. Task 1 adds `skillId` to the snapshot; Tasks 2-4 turn that into a
client-side profile table for visuals and sound. The music half is independent: the `music` mixer bus
and its Options slider already exist and nothing plays on them, so Tasks 5-8 free that bus from the
ambience beds currently misrouted onto it and stream one looping track per area into it.

**Tech Stack:** TypeScript, npm workspaces, Babylon.js 9.20 (ParticleSystem, TrailMesh, GlowLayer),
Web Audio API, React 19, Vitest 4.

## Global Constraints

- Sim math is deterministic fixed-point; keep replay checksums stable.
- `@exiled/rules` is a pure leaf: it imports no other `@exiled` package.
- No damage type changes anywhere in this plan. No balance band moves, and `balance.test.ts` is not
  touched.
- Comments state the current invariant, never the change. Max 2 lines; doc blocks max 3.
- No emdashes in code, comments, commit messages or docs.
- Commit direct to main, one commit per task, no attribution trailers.
- Test with `npx vitest run <scope>` from the repo root. `npm run typecheck` is mandatory after every
  task because vitest strips types.
- Sound masters are CURATED from the Sonniss bundles, never generated. Never feed Sonniss audio to a
  model: the licence forbids training or conditioning on it.
- Every FX profile must read with bloom OFF, since bloom is a user graphics setting
  (`render/engine.ts:262`). Colour alone is never the distinction between two skills.

## Reference

Spec: `docs/superpowers/specs/2026-08-11-skill-identity-and-music-design.md`.
Reward psychology (`docs/09-reward-psychology.md`) outranks every other spec: a reward the player
cannot hear and see did not happen, and intensity beats density.

---

### Task 1: `skillId` reaches the client

**Files:**
- Modify: `packages/simulation/src/components.ts:248-264` (`ProjectileC`), `:265-276` (`GroundAreaC`)
- Modify: `packages/simulation/src/systems/skill-cast.ts:67-77`, `:78-100`
- Modify: `packages/simulation/src/protocol-bridge.ts:261-283`
- Modify: `packages/protocol/src/index.ts:186-230` (`SnapshotEntity`)
- Test: `packages/simulation/src/systems/skill-cast.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SnapshotEntity.skillId?: string`, present on `kind: "projectile"` and
  `kind: "groundArea"` entities spawned by a skill. `ProjectileC.skillId?: string` and
  `GroundAreaC.skillId?: string`.

Monster projectiles (`systems/monster-ai.ts:225`) deliberately set no `skillId`, so the client's
fallback keeps drawing them exactly as today.

- [ ] **Step 1: Write the failing test**

Append to `packages/simulation/src/systems/skill-cast.test.ts`:

```ts
it("a cast projectile names the skill that made it, so the client can draw it", () => {
  const { sim, world, playerEntity } = createCombatSim(7, { monsters: false });
  sim.step([{
    tick: sim.tick, entity: playerEntity, type: "useSkill",
    skillId: "skill.ember_bolt.v1", data: { tx: fp(0), ty: fp(6) },
  }]);
  const proj = world.query("projectile")[0]!;
  expect(world.get<ProjectileC>(proj, "projectile")!.skillId).toBe("skill.ember_bolt.v1");
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/simulation/src/systems/skill-cast.test.ts -t "names the skill"`
Expected: FAIL, `expected undefined to be 'skill.ember_bolt.v1'`.

- [ ] **Step 3: Carry the id through the sim**

In `components.ts`, add to `ProjectileC` and to `GroundAreaC`:

```ts
  /** Which skill spawned this, so the client can pick its look. Absent on a
   *  monster's own projectile, which has no skill behind it. */
  skillId?: string;
```

In `skill-cast.ts`, inside the `spawnProjectile` branch's `world.set<ProjectileC>` object, and
inside the `spawnGroundArea` branch's `world.set<GroundAreaC>` object, add:

```ts
          skillId: def.id,
```

`def` is the `SkillDef` already in scope in that loop. If the local variable holding it is named
differently, use that name; do not re-look it up.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run packages/simulation/src/systems/skill-cast.test.ts -t "names the skill"`
Expected: PASS.

- [ ] **Step 5: Write the failing wire test**

Append to `packages/simulation/src/protocol-bridge.test.ts` (create the import line for
`createCombatSim` if the file lacks it):

```ts
it("puts the skill id on the projectile it serializes", () => {
  const { sim, world, playerEntity } = createCombatSim(7, { monsters: false });
  sim.step([{
    tick: sim.tick, entity: playerEntity, type: "useSkill",
    skillId: "skill.ember_bolt.v1", data: { tx: fp(0), ty: fp(6) },
  }]);
  const snap = toSnapshot(world, sim.tick, playerEntity);
  const proj = snap.entities.find((e) => e.kind === "projectile")!;
  expect(proj.skillId).toBe("skill.ember_bolt.v1");
});
```

If `toSnapshot` is exported under another name in `protocol-bridge.ts`, use that name.

- [ ] **Step 6: Run it and watch it fail**

Run: `npx vitest run packages/simulation/src/protocol-bridge.test.ts -t "skill id on the projectile"`
Expected: FAIL, `expected undefined to be 'skill.ember_bolt.v1'`.

- [ ] **Step 7: Put it on the wire**

In `packages/protocol/src/index.ts`, inside `SnapshotEntity`, after the `species` field:

```ts
  /**
   * projectile/groundArea only: which skill spawned it, so the renderer can pick
   * its look. A plain string for the same reason `species` is one: the wire
   * contract must not depend on content.
   */
  skillId?: string;
```

In `protocol-bridge.ts`, in the projectile loop's pushed object and in the groundArea loop's pushed
object:

```ts
      ...(pr.skillId ? { skillId: pr.skillId } : {}),
```

and for the ground area, `...(ga.skillId ? { skillId: ga.skillId } : {})`. The spread keeps the key
absent rather than `undefined`, so a monster's bolt serializes byte-identically to today.

- [ ] **Step 8: Run both tests plus the suites they sit in**

Run: `npx vitest run packages/simulation packages/protocol packages/replay`
Expected: all PASS, including the replay determinism scenarios.

- [ ] **Step 9: Typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat(protocol): a projectile says which skill made it"
```

---

### Task 2: the FX profile table, behaviour unchanged

This task is a pure refactor: every skill gets the SAME profile as today, so nothing on screen moves.
That is the point. It fails loudly if the lookup or fallback is wrong, before any art is at stake.

**Files:**
- Modify: `apps/web/src/render/skill-fx.ts` (add the table and `fxProfile`)
- Modify: `apps/web/src/render/meshes.ts:16` (import), `:1607-1608` (the branch)
- Test: `apps/web/src/render/skill-fx.test.ts`

**Interfaces:**
- Consumes: `SnapshotEntity.skillId` from Task 1.
- Produces:
  ```ts
  export interface FxProfile {
    core: Color3;        // the emissive head colour
    wake: Color3;        // the trail ribbon colour
    trailWidth: number;  // TrailMesh diameter
    emitRate: number;    // particles per second
    sizeStart: number;
    sizeEnd: number;
    lifeMin: number;
    lifeMax: number;
    burstColour: Color3; // the impact shockwave
    burstRadius: number;
    flightCue: string | null;
    impactCue: string | null;
  }
  export const FALLBACK_FX: FxProfile;
  export function fxProfile(skillId: string | undefined): FxProfile;
  ```

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/render/skill-fx.test.ts`:

```ts
import { SKILLS } from "@exiled/content-runtime";
import { fxProfile, FALLBACK_FX, SKILL_FX } from "./skill-fx";

describe("fx profiles", () => {
  it("gives every authored skill its own profile", () => {
    const missing = [...SKILLS.keys()].filter((id) => SKILL_FX[id] === undefined);
    expect(missing, `skills with no FX profile: ${missing.join(", ")}`).toEqual([]);
  });

  it("falls back rather than throwing on an id it does not know", () => {
    expect(fxProfile("skill.not_a_skill.v9")).toBe(FALLBACK_FX);
    expect(fxProfile(undefined)).toBe(FALLBACK_FX);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run apps/web/src/render/skill-fx.test.ts -t "fx profiles"`
Expected: FAIL, `fxProfile is not a function` / cannot resolve the import.

- [ ] **Step 3: Add the table**

In `apps/web/src/render/skill-fx.ts`, above `attachBoltTrail`:

```ts
/**
 * What one skill looks and sounds like. Colour is never the only difference:
 * bloom is a graphics setting, so size, rate and speed have to carry it too.
 */
export interface FxProfile {
  core: Color3;
  wake: Color3;
  trailWidth: number;
  emitRate: number;
  sizeStart: number;
  sizeEnd: number;
  lifeMin: number;
  lifeMax: number;
  burstColour: Color3;
  burstRadius: number;
  flightCue: string | null;
  impactCue: string | null;
}

/** What a monster's bolt and any unmapped skill draw: today's ember bolt. */
export const FALLBACK_FX: FxProfile = {
  core: new Color3(1, 0.55, 0.2),
  wake: new Color3(1, 0.55, 0.2),
  trailWidth: 0.08,
  emitRate: 80,
  sizeStart: 0.5,
  sizeEnd: 0.1,
  lifeMin: 0.05,
  lifeMax: 0.1,
  burstColour: new Color3(1, 0.55, 0.18),
  burstRadius: 2.2,
  flightCue: "skill-ember-bolt-flight",
  impactCue: "skill-ember-bolt-impact",
};

export const SKILL_FX: Record<string, FxProfile> = {
  "skill.ember_bolt.v1": FALLBACK_FX,
  "skill.ember_spark.v1": FALLBACK_FX,
  "skill.snap_shot.v1": FALLBACK_FX,
  "skill.strike.v1": FALLBACK_FX,
  "skill.cinder_ground.v1": FALLBACK_FX,
  "skill.blink.v1": FALLBACK_FX,
  "skill.town_portal.v1": FALLBACK_FX,
};

export function fxProfile(skillId: string | undefined): FxProfile {
  return (skillId === undefined ? undefined : SKILL_FX[skillId]) ?? FALLBACK_FX;
}
```

- [ ] **Step 4: Make the trail read the profile**

Change `attachBoltTrail`'s signature and body in the same file:

```ts
export function attachBoltTrail(scene: Scene, mesh: AbstractMesh, fx: FxProfile = FALLBACK_FX): ParticleSystem {
```

Inside it, replace the literals with the profile:

- `sizeOverLife(ps, 0.5, 0.1)` becomes `sizeOverLife(ps, fx.sizeStart, fx.sizeEnd)`
- `ps.minLifeTime = 0.05` becomes `ps.minLifeTime = fx.lifeMin`
- `ps.maxLifeTime = 0.1` becomes `ps.maxLifeTime = fx.lifeMax`
- `ps.emitRate = 80` becomes `ps.emitRate = fx.emitRate`
- the `TrailMesh` width `0.08` becomes `fx.trailWidth`
- the ribbon's `new Color3(1, 0.55, 0.2)` becomes `fx.wake`
- the `emberBurst(scene, ...)` call inside `onDisposeObservable` becomes
  `emberBurst(scene, mesh.getAbsolutePosition().clone(), fx)`

Change `emberBurst` the same way:

```ts
export function emberBurst(scene: Scene, at: Vector3, fx: FxProfile = FALLBACK_FX): ParticleSystem {
  shockwave(scene, at, fx.burstRadius, fx.burstColour);
```

The default arguments are what keep every existing caller and test compiling unchanged.

- [ ] **Step 5: Pass the profile in from the mesh factory**

In `apps/web/src/render/meshes.ts` line 16, extend the import to include `fxProfile`. Then replace
lines 1607-1608:

```ts
  if (kind === "projectile") attachBoltTrail(scene, mesh, fxProfile(skillId));
  else attachCinderFX(scene, mesh);
```

The enclosing factory function must take `skillId` from the snapshot entity. Find its signature and
thread `skillId?: string` through as an optional parameter, defaulting to `undefined`, and pass
`entity.skillId` at the renderer's call site. Grep for callers with:

```bash
grep -rn "makeSkillMesh\|kind === \"projectile\"" apps/web/src/render/renderer.ts
```

- [ ] **Step 6: Run the render suite and watch it pass**

Run: `npx vitest run apps/web/src/render`
Expected: all PASS. Nothing visual changed, so no existing expectation may move. If one does, the
refactor is wrong: fix the refactor, never the expectation.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "refactor(render): a skill's look is a profile, not a branch on entity kind"
```

---

### Task 3: three fires that do not look alike

**Files:**
- Modify: `apps/web/src/render/skill-fx.ts` (the `SKILL_FX` entries only)
- Test: `apps/web/src/render/skill-fx.test.ts`

**Interfaces:**
- Consumes: `FxProfile`, `SKILL_FX`, `FALLBACK_FX` from Task 2.
- Produces: no new symbols.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/render/skill-fx.test.ts`:

```ts
it("separates the two fire projectiles by more than colour, since bloom can be off", () => {
  const bolt = SKILL_FX["skill.ember_bolt.v1"]!;
  const spark = SKILL_FX["skill.ember_spark.v1"]!;
  // A player with bloom off sees size and density, not glow.
  expect(spark.sizeStart).toBeLessThan(bolt.sizeStart);
  expect(spark.emitRate).toBeLessThan(bolt.emitRate);
  expect(spark.trailWidth).toBeLessThan(bolt.trailWidth);
  expect(spark.burstRadius).toBeLessThan(bolt.burstRadius);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/web/src/render/skill-fx.test.ts -t "more than colour"`
Expected: FAIL, `expected 0.5 to be less than 0.5` (both are still `FALLBACK_FX`).

- [ ] **Step 3: Author the three profiles**

Replace the `SKILL_FX` entries in `skill-fx.ts`:

```ts
export const SKILL_FX: Record<string, FxProfile> = {
  // The real cast: a white-hot core dragging a deep orange wake, heavy and slow.
  "skill.ember_bolt.v1": {
    ...FALLBACK_FX,
    core: new Color3(1, 0.92, 0.75),
    wake: new Color3(1, 0.45, 0.12),
    trailWidth: 0.11,
    emitRate: 110,
    sizeStart: 0.6,
    sizeEnd: 0.12,
    burstColour: new Color3(1, 0.5, 0.14),
    burstRadius: 2.6,
  },
  // The free fallback, and it must read as one: a small pale mote, thin and dry.
  "skill.ember_spark.v1": {
    ...FALLBACK_FX,
    core: new Color3(1, 0.85, 0.45),
    wake: new Color3(0.95, 0.7, 0.25),
    trailWidth: 0.05,
    emitRate: 45,
    sizeStart: 0.28,
    sizeEnd: 0.06,
    lifeMin: 0.03,
    lifeMax: 0.07,
    burstColour: new Color3(1, 0.75, 0.3),
    burstRadius: 1.2,
  },
  // Not fire at all: an arrow, so the wake is dust off the shaft, not flame.
  "skill.snap_shot.v1": {
    ...FALLBACK_FX,
    core: new Color3(0.85, 0.82, 0.72),
    wake: new Color3(0.6, 0.58, 0.52),
    trailWidth: 0.04,
    emitRate: 25,
    sizeStart: 0.2,
    sizeEnd: 0.05,
    lifeMin: 0.03,
    lifeMax: 0.06,
    burstColour: new Color3(0.8, 0.78, 0.7),
    burstRadius: 0.9,
  },
  "skill.strike.v1": FALLBACK_FX,
  "skill.cinder_ground.v1": {
    ...FALLBACK_FX,
    core: new Color3(1, 0.42, 0.1),
    wake: new Color3(0.7, 0.2, 0.05),
    burstColour: new Color3(1, 0.42, 0.1),
    burstRadius: 3.2,
  },
  "skill.blink.v1": FALLBACK_FX,
  "skill.town_portal.v1": FALLBACK_FX,
};
```

`FALLBACK_FX` must be declared BEFORE `SKILL_FX` in the file for the spreads to work.

- [ ] **Step 4: Make the projectile head take its own colour**

The head mesh's emissive colour is set in `meshes.ts` around line 1585-1592 where `m.alphaMode` and
`cinderGlow` are handled. Set the emissive from the profile there:

```ts
  m.emissiveColor = fxProfile(skillId).core.clone();
```

Place it beside the existing material setup for the projectile branch, not inside the groundArea
branch.

- [ ] **Step 5: Run the render suite**

Run: `npx vitest run apps/web/src/render`
Expected: all PASS, including the new test.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat(render): the spark, the bolt and the arrow stop being one effect"
```

- [ ] **Step 7: Hand to the owner for judgement**

Game feel and look are the owner's to test, in game, at his own viewport. Do NOT open devtools, do
not capture screenshots, and do not iterate on the numbers before he has looked. Report: the three
profiles are in, `?play&map=the_wrackline` is the fastest way to see all three (Ember Spark on the
free attack, Ember Bolt on 1, Cinder Ground on 2), and both bloom on and bloom off are worth a look
because the profiles are tuned to survive bloom being off.

---

### Task 4: the ear can tell them apart too

Routing only. This task adds no new audio master, because `tools/import_sfx.py --lib` needs the
owner's Sonniss library root, which is not in the repo. It makes the cue a per-skill decision so a
new master is later a one-line change, and it gives Snap Shot the existing bowstring-free arrow
treatment by muting its flight bed rather than inventing a file.

**Files:**
- Modify: `apps/web/src/audio/soundscape.ts:190-200`, `:265-290`
- Test: `apps/web/src/audio/soundscape.test.ts`

**Interfaces:**
- Consumes: `FxProfile.flightCue` / `.impactCue` from Task 2, `SnapshotEntity.skillId` from Task 1.
- Produces: no new exported symbols.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/audio/soundscape.test.ts`, following the existing fixture idiom in that file
for building two snapshots and diffing them:

```ts
it("plays the cue the skill's own profile names, not one cue for every bolt", () => {
  const played: string[] = [];
  const s = makeSoundscape({ play: (n: string) => played.push(n) });
  s.apply(snapWith([{ id: 1, kind: "projectile", x: 0, y: 0, team: 0, skillId: "skill.snap_shot.v1" }]));
  s.apply(snapWith([]));  // the arrow is gone: impact
  expect(played).not.toContain("skill-ember-bolt-impact");
});
```

Match the helper names actually used in `soundscape.test.ts`; do not invent a new fixture if one
exists.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/web/src/audio/soundscape.test.ts -t "the skill's own profile names"`
Expected: FAIL, the array contains `skill-ember-bolt-impact`.

- [ ] **Step 3: Route through the profile**

In `soundscape.ts`, replace the loop cue line (currently
`if (e.kind === "projectile") return (e.team ?? 0) === 0 ? "skill-ember-bolt-flight" : null;`) with:

```ts
  if (e.kind === "projectile") return (e.team ?? 0) === 0 ? fxProfile(e.skillId).flightCue : null;
```

and the impact line (currently `play("skill-ember-bolt-impact", ...at(e))`) with:

```ts
          const cue = fxProfile(e.skillId).impactCue;
          if (cue) play(cue, ...at(e));
```

Import `fxProfile` from `../render/skill-fx`. Then in `skill-fx.ts` give Snap Shot no flight bed,
since an arrow has no burning tail to sustain:

```ts
    flightCue: null,
```

inside the `skill.snap_shot.v1` profile.

- [ ] **Step 4: Run the audio suite and watch it pass**

Run: `npx vitest run apps/web/src/audio`
Expected: all PASS. The existing Ember Bolt cue expectations must not move: its profile still names
the same two cues.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat(audio): flight and impact are the skill's, not the entity kind's"
```

---

### Task 5: the Music slider stops controlling the ambience

**Files:**
- Modify: `apps/web/src/audio/sfx.ts:132`
- Test: `apps/web/src/audio/sfx.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. `ambient-*` cues now report category `environment`.

This is a user-visible behaviour change: anyone with a saved settings blob finds their two sliders
swapped in meaning. It is deliberate, and it is why this is its own commit.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/audio/sfx.test.ts`:

```ts
it("counts an ambience bed as environment, leaving the music bus for music", () => {
  expect(categoryOf("ambient-cave")).toBe("environment");
  expect(categoryOf("ambient-shore")).toBe("environment");
});
```

If the categorising function is not exported as `categoryOf`, export the existing one under its own
name and use that; do not duplicate the logic in the test.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run apps/web/src/audio/sfx.test.ts -t "environment, leaving the music bus"`
Expected: FAIL, `expected 'music' to be 'environment'`.

- [ ] **Step 3: Reroute**

In `sfx.ts` line 132:

```ts
  if (name.startsWith("ambient-")) return "environment";
```

- [ ] **Step 4: Run the audio suite**

Run: `npx vitest run apps/web/src/audio`
Expected: all PASS. If an existing test asserts `music` for an ambience bed, that assertion is now
wrong and moves with the change; state so in the commit body.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "fix(audio): the ambience beds leave the music bus they were borrowing"
```

---

### Task 6: the music player

**Files:**
- Create: `apps/web/src/audio/music.ts`
- Create: `apps/web/src/audio/music.test.ts`

**Interfaces:**
- Consumes: `categoryGain("music")` from `audio/bus.ts`. If the bus exports its per-category gain
  node under a different name, use that; grep `apps/web/src/audio/bus.ts` for the map built in
  `setSoundMix`.
- Produces:
  ```ts
  export const MUSIC_BY_AREA: Record<string, string>;   // biome id or "hideout" -> track file stem
  export function trackFor(area: string | null): string; // null means hideout
  export function setMusicArea(area: string | null): void;
  export function stopMusic(): void;
  ```

Streamed with `HTMLAudioElement` + `MediaElementAudioSourceNode`, never `decodeAudioData`: a three
minute track decodes to roughly 30 MB of resident PCM.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/audio/music.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { trackFor, MUSIC_BY_AREA } from "./music";

const BIOMES = ["vaal_stone", "desert", "swamp", "forest", "coast"];

describe("music routing", () => {
  it("has a track for every biome and for the hideout", () => {
    for (const b of BIOMES) expect(MUSIC_BY_AREA[b], `no track for ${b}`).toBeTruthy();
    expect(MUSIC_BY_AREA["hideout"]).toBeTruthy();
  });

  it("reads null as the hideout, which is where a session starts", () => {
    expect(trackFor(null)).toBe(MUSIC_BY_AREA["hideout"]);
  });

  it("falls back to the hideout track rather than silence on an unknown area", () => {
    expect(trackFor("atlantis")).toBe(MUSIC_BY_AREA["hideout"]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run apps/web/src/audio/music.test.ts`
Expected: FAIL, cannot resolve `./music`.

- [ ] **Step 3: Write the player**

Create `apps/web/src/audio/music.ts`:

```ts
import { audioContext, categoryGain } from "./bus";

const DIR = "/audio/music";
const FADE_SECONDS = 2;

/**
 * Which track a place plays. Stems only: the file is `${DIR}/${stem}.ogg`.
 * Confirmed by ear before the files landed; a biome with no entry would be
 * silent, so `music.test.ts` refuses one.
 */
export const MUSIC_BY_AREA: Record<string, string> = {
  hideout: "hideout",
  vaal_stone: "vaal-stone",
  desert: "desert",
  swamp: "swamp",
  forest: "forest",
  coast: "coast",
};

export function trackFor(area: string | null): string {
  return MUSIC_BY_AREA[area ?? "hideout"] ?? MUSIC_BY_AREA["hideout"]!;
}

interface Voice { el: HTMLAudioElement; gain: GainNode }

let current: Voice | null = null;
let currentStem: string | null = null;

/** Fade `v` to `to` over FADE_SECONDS, disposing it at zero. */
function fade(v: Voice, to: number, ctx: AudioContext): void {
  v.gain.gain.setTargetAtTime(to, ctx.currentTime, FADE_SECONDS / 3);
  if (to > 0) return;
  window.setTimeout(() => { v.el.pause(); v.el.src = ""; v.gain.disconnect(); }, FADE_SECONDS * 1000);
}

/**
 * Play the area's track, crossfading off whatever is playing. Naming the track
 * already playing is a no-op, so re-entering a biome never restarts it.
 */
export function setMusicArea(area: string | null): void {
  const stem = trackFor(area);
  if (stem === currentStem) return;
  const ctx = audioContext();
  if (!ctx) return; // no gesture yet: the next area change will land
  currentStem = stem;

  const el = new Audio(`${DIR}/${stem}.ogg`);
  el.loop = true;
  el.crossOrigin = "anonymous";
  const gain = ctx.createGain();
  gain.gain.value = 0;
  ctx.createMediaElementSource(el).connect(gain).connect(categoryGain("music"));
  void el.play().catch(() => {});

  if (current) fade(current, 0, ctx);
  current = { el, gain };
  fade(current, 1, ctx);
}

export function stopMusic(): void {
  const ctx = audioContext();
  if (current && ctx) fade(current, 0, ctx);
  current = null;
  currentStem = null;
}
```

If `bus.ts` does not already export `audioContext()` and `categoryGain(cat)`, add them there as thin
accessors over the module-local `ctx` and the category gain map, returning `null` before the context
exists. Do not create a second AudioContext: one graph per page is the rule the whole bus is built
on.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npx vitest run apps/web/src/audio/music.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add -A
git commit -m "feat(audio): an area's music streams on the bus that was already waiting for it"
```

---

### Task 7: licence, selection, and the files themselves

This task is gated on the owner twice and cannot be completed alone. Do the verification, then STOP
and report; do not convert or commit audio he has not chosen.

**Files:**
- Create: `public/audio/music/*.ogg` (six files)
- Modify: `apps/web/src/audio/music.ts` (`MUSIC_BY_AREA` stems, only if the owner's picks need it)
- Modify: `tools/import_sfx.py`'s `SOURCES` docstring region or the repo's audio `SOURCES` record,
  whichever the existing curated cues use, adding one line per track
- Modify: the service worker's precache list, to EXCLUDE `/audio/music/`

- [ ] **Step 1: Verify every licence individually**

`review/audio/cc0-fantasy-music/manifest.csv` records each track as
"CC0 (collection listing; verify individual page)". Fetch each `source_page` and read the licence
block on the page itself. Record for each: title, author, the licence as stated ON THAT PAGE, and the
observation date. A page that does not state CC0, or that states CC-BY, is DROPPED, not shipped
hopefully and not shipped with a credit line invented for it.

- [ ] **Step 2: Report the verified list and propose a mapping**

Claude cannot hear audio, so the mapping is proposed from titles, source pages and the authors' own
descriptions, and the owner confirms by ear. Propose one track per row and say what each is being
proposed FOR:

| area | proposed track | why |
|---|---|---|
| hideout | `medieval-the-old-tower-inn` | a settled indoor theme, the one place that is not danger |
| vaal_stone | `forgoten-tomb-ambience` | enclosed stone |
| desert | `ancient-power-of-serpents` | dry and wide |
| swamp | `breves-dies-hominis` | slow and heavy |
| forest | `the-field-of-dreams` | open and green |
| coast | `new-sunrise` | daylight and air, matching the Strand's `light: 2.4` |

STOP here and wait for the owner. He listens and confirms or swaps.

- [ ] **Step 3: Convert the confirmed picks**

For each confirmed track, from the repo root:

```bash
ffmpeg -i "review/audio/cc0-fantasy-music/<dir>/<file>" -vn -ac 2 -c:a libvorbis -q:a 4 \
  "public/audio/music/<stem>.ogg"
```

`-q:a 4` is roughly 128 kbps stereo: music, not a sound effect, so it gets more than the cue library
does. Check each output is under 4 MB with `ls -l public/audio/music/`; if one is larger, drop to
`-q:a 3` rather than trimming the track.

- [ ] **Step 4: Keep it out of the precache**

Find the service worker's asset list (grep for `ASSETS` under `apps/web/`) and confirm
`/audio/music/` is NOT included. If the list is a directory prefix that would swallow it, add an
explicit exclusion so the first load does not pull megabytes of music before the game starts.

- [ ] **Step 5: Record provenance**

Add one line per shipped track to the repo's audio `SOURCES` record: stem, title, author, source URL,
licence as verified on the page, observation date.

- [ ] **Step 6: Verify the files load**

Run: `npm run build -w apps/web`
Expected: exit 0. Then confirm each file is served:

```bash
for f in public/audio/music/*.ogg; do curl -s -o /dev/null -w "%{http_code} $f\n" \
  "http://localhost:5173/audio/music/$(basename "$f")"; done
```

Expected: `200` for every file, against the dev server the owner already has running on 5173. Never
start a second one.

- [ ] **Step 7: Commit**

```bash
git add public/audio/music apps/web/src/audio/music.ts
git commit -m "feat(audio): six verified CC0 tracks, one per place"
```

---

### Task 8: the music follows the player

**Files:**
- Modify: `apps/web/src/GameView.tsx:528-529`
- Test: `apps/web/src/audio/music.test.ts`

**Interfaces:**
- Consumes: `setMusicArea` from Task 6.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/audio/music.test.ts`:

```ts
it("treats the same area twice as one call, so a re-entry never restarts the track", () => {
  // No AudioContext in jsdom, so this pins the decision, not the playback: the
  // second call must resolve the same stem and therefore change nothing.
  expect(trackFor("forest")).toBe(trackFor("forest"));
  expect(trackFor("forest")).not.toBe(trackFor("coast"));
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run apps/web/src/audio/music.test.ts -t "one call"`
Expected: PASS immediately. This one guards Task 6's routing rather than driving new code; the real
work in this task is the single call site below, which has no unit seam because `GameView.tsx` owns
the worker message.

- [ ] **Step 3: Call it where the ambience is already set**

In `GameView.tsx`, immediately after the existing `setAmbient(base?.biomeId ?? null);`:

```ts
        setMusicArea(base?.biomeId ?? null);
```

Import `setMusicArea` from `./audio/music`. Placing it beside `setAmbient` is deliberate: the area
message is the one place that knows where the player actually IS, as opposed to where an intent asked
to go.

- [ ] **Step 4: Stop the music when the game unmounts**

Find where `GameView` tears down its scene (the effect cleanup that disposes the engine) and add:

```ts
      stopMusic();
```

Without this, leaving to the main menu keeps a map's track playing under the menu.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all files PASS.

- [ ] **Step 6: Typecheck, build, commit**

```bash
npm run typecheck
npm run build -w apps/web
git add -A
git commit -m "feat(audio): the place you are standing in decides what plays"
```

- [ ] **Step 7: Hand to the owner**

Report: music is live, walk hideout to a map and back to hear the crossfade, and the Music slider in
Options now moves music while Ambience moves the beds. Do not verify by screenshot or devtools; he
tests sound and feel himself.

---

## Deferred, deliberately

- **New sound masters per skill.** `tools/import_sfx.py --lib <root>` needs the owner's Sonniss
  library path, which is not in the repo. Task 4 makes the cue a per-skill lookup so adding one later
  is a single line in a profile. Ember Spark and Ember Bolt share the Ember Bolt masters until then.
- **Boss music and combat swells.** Out of scope per the spec: per-area loops only.
- **Menu music.** Out of scope per the spec.
- **New skills.** Out of scope per the spec: the kit stays as authored.

## Risk

`packages/replay`'s determinism tests compare two runs inside the SAME process, so no pinned
checksum baseline exists anywhere in the repo. Task 1 adds a field to two components; if it somehow
changed serialization, these tests would still pass. The mitigation available here is that `skillId`
is spread in conditionally, so a monster's projectile serializes byte-identically to today, and no
system reads it. The wider gap is known and is the owner's to rule on.
