# Milestone 3: Boss + Arena — Implementation Plan

**Goal (spec §10.3):** indoor mapgen, a two-phase boss with authoritative telegraphs, and
death / checkpoint / boss-reset.

**Boss:** *Cinder Warden* (`monster.cinder_warden.v1`) — the imps' big brother.
Phase 1: chase + melee, plus a telegraphed ground slam (circle, ~1 s wind-up, rooted while
winding up). Phase 2 (≤50% life): the slam leaves burning ground, two imps are summoned, and
the ability cadence speeds up.

**Execution:** ordered tasks, one commit each, all three gates green before every commit
(`npm run typecheck`, `npx vitest run`, `npm run build -w apps/web`). Tests first
(red → green). Committing directly to `main`.

---

## Locked contracts

### `@exiled/content-schema`

```ts
export interface BossSpec {
  phase2AtLifePct: number;                 // 50
  slam: {
    windupTicks: number;                   // 30 = 1 s telegraph
    radiusFixed: Fixed;
    damageFixed: Fixed;
    cooldownTicks: number;
    rangeFixed: Fixed;                     // won't slam beyond this
  };
  phase2: {
    fireGroundDurationTicks: number;       // slam leaves burning ground
    addCount: number;                      // imps summoned on transition
    addDefId: string;                      // "monster.cinder_imp.v1"
    cadenceMulPct: number;                 // 70 = 30% faster
  };
}
// MonsterDef gains:  boss?: BossSpec        (optional — normal monsters omit it)
```

`validateMonsterDef` validates `boss` when present (all counts > 0, pct in 1..100).

### `@exiled/simulation` components

```ts
export interface BossC {                   // key "boss"
  phase: 1 | 2;
  nextAbilityTick: number;
  spawnX: Fixed; spawnY: Fixed;            // reset position
  rootedUntilTick: number;                 // held still during wind-up
}
export interface TelegraphC {              // key "telegraph"  (+ Position)
  ownerId: Entity; team: number;
  radius: Fixed;
  startTick: number; impactTick: number;   // authoritative, per spec §4
  damage: Fixed; damageType: 0 | 1;
  leavesGroundTicks: number;               // 0 = none
}
// CheckpointC — deleted. The session singleton (Phase D) owns respawn and portal budget;
// no system ever read CheckpointC, so it is removed rather than retained.
// MonsterC gains:    summoned: 0 | 1      (adds are removed on boss reset)
// GroundAreaC gains: team: number         (only damages other teams)
```

### System order (canonical, `combat-sim.ts`)

```
resourceRegen, skillCast, playerMovement, monsterAI, bossAI, projectileMove,
groundAreaTick, telegraphResolve, ailmentTick, damageResolve, death, expiry
```

- `monsterAI` skips entities that have `"boss"`.
- `telegraphResolve` runs before `damageResolve` so an impact lands the same tick.
- `expiry` also destroys telegraphs whose `impactTick` has passed (resolve destroys them
  itself; the expiry guard is the safety net).

### `@exiled/protocol`

```ts
SnapshotEntity.kind |= "telegraph"
SnapshotEntity gains:
  boss?: boolean;        // the boss renders as kind "monster" with boss: true
  bossPhase?: 1 | 2;
  progress?: number;     // telegraph wind-up 0..1, for the fill animation
```

No new message type. The HUD finds the boss with `entities.find(e => e.boss)`.

### Arena

`ARENA_RADIUS = fp(14)` in `movement.ts`, plus
`clampToArena(x, y, bodyRadius): { x, y }`. Applied by `playerMovement`, `monsterAI`, and
`bossAI` after every step. Superseded by map collision in Phase C.

---

## Phase A — boss + arena (playable fight)

- [ ] **A1 — content.** `BossSpec` in content-schema + validator; `monster.cinder_warden.v1`
      in content-runtime (life ~fp(900), moveSpeed fp(1.8), radius fp(1.4), melee fp(14),
      slam r=fp(3.5) dmg fp(30) windup 30 cd 150). Tests: validator accepts/rejects, def loads.
- [ ] **A2 — components.** `BossC`, `TelegraphC`, `MonsterC.summoned`,
      `GroundAreaC.team` (`CheckpointC` dropped; see Phase D); `groundAreaTick` becomes faction-aware (damages any entity with
      `health` + `faction` on another team, using a shared `bodyRadiusOf(world, e)` helper).
      Tests: player standing in a hostile ground area burns; own-team areas do not.
- [ ] **A3 — `registerBossAI(sim)`.** Chase to melee range, melee on cooldown, spawn a
      telegraph when `tick >= nextAbilityTick` and the player is inside `slam.rangeFixed`;
      rooted until impact. `monsterAI` guard for boss entities. Tests: chases, telegraphs on
      cadence, does not move while rooted, `monsterAI` leaves the boss alone.
- [ ] **A4 — `registerTelegraphResolve(sim)`.** At `impactTick`: damage every entity of
      another team within `radius + bodyRadius`, optionally create a team-tagged ground area,
      destroy the telegraph. Tests: hits inside, misses outside, resolves exactly once,
      damage goes through `defenses`.
- [ ] **A5 — arena bound.** `ARENA_RADIUS` + `clampToArena` wired into the three movement
      paths. Tests: player cannot leave, monster cannot leave, inside is untouched.
- [ ] **A6 — protocol + snapshot.** `"telegraph"` kind, `boss`/`bossPhase`/`progress` fields,
      `buildSnapshot` emission. Tests: boss serialises with `boss: true`, telegraph progress
      is 0 at start and ~1 at impact.
- [ ] **A7 — render + HUD.** `MeshKind` gains `"boss"` (scaled Warden build) and
      `"telegraph"` (flat emissive disc, alpha/fill from `progress`); `syncMesh` scales
      telegraph **and** ground-area meshes from `entity.radius` (kills the hardcoded
      diameter-5 M2 debt). HUD boss bar (name + life + phase) at top-centre.
- [ ] **A8 — lab wiring.** `createCombatSim` spawns the Warden at (0, 12), imp pack trimmed
      to 3 + the rare. Devlog screenshot.

## Phase B — phases + rules

- [x] **B1 — phase 2.** Transition at `phase2AtLifePct`: summon `addCount` imps
      (`summoned: 1`) on a ring, slam gains `leavesGroundTicks`, cadence × `cadenceMulPct`.
      Tests: transition fires once at the threshold, adds spawn, slam leaves fire, cadence drops.
- [ ] **B2 — death / checkpoint / boss reset.** _(Superseded and absorbed by Phase D: death,
      respawn, and boss-reset are now owned by `areaTransition` + `SessionC`. `CheckpointC` is
      deleted. `resetBoss` is still exported from `boss-ai.ts` and called by `death.ts`, but the
      transition to the hideout is driven by the session machinery rather than an in-place
      respawn.)_ `CheckpointC` drives the respawn point (default origin). On player death,
      `resetBoss(world, tick)` (exported from `boss-ai.ts`, called by `death.ts`): boss to full
      life, phase 1, back to spawn, all `summoned` monsters and all telegraphs destroyed. Tests:
      respawn at checkpoint, full boss reset, no reset when no boss exists.
- [x] **B3 — golden replay.** `packages/replay/src/scenarios/boss.ts` + tests: phase
      transition, telegraph impact, boss reset, and checksum-equality determinism
      (spec §9 requires exactly this scenario). Recorded against the AREA run loop
      (`createCombatSim(seed, { area: "map" })` + real interact/areaTransition), not
      the legacy path. Two replay-safe fixture tunes: isolate the boss from the imp
      swarm, and seed the warden near its phase-2 threshold (a full-life solo is
      infeasible under caster mana-regen vs. slam damage) so scripted bolts drive the
      real transition. Reset = portal interact → areaTransition teardown. Fixing this
      exposed and fixed two determinism-serializer gaps the legacy path never hit:
      `checksumWorld` now skips the render-only `yaw` and recurses into nested
      objects (`TelegraphC.ground`) instead of throwing.
- [ ] **B4 — devlog screenshot** of the phase-2 fight.

## Phase C — indoor mapgen

- [x] **C1 — `@exiled/mapgen` package.** `generateArea(seed, contentVersion): AreaLayout` —
      room graph → axis-aligned rooms → corridors → boss-arena socket → walkable grid
      (`Uint8Array`, 0.5-unit cells) → spawn sockets → validation
      (`{ algorithmVersion, contentVersion, seed, chosenVariantIds, objectiveAnchors,
      walkableArea, validationChecks, hash }` per spec §5). Deterministic fallback template
      when validation fails. Tests: same seed → same hash, 200 seeds all pass the reachability
      BFS + min-corridor-width + spawn-budget gates, fallback is deterministic.
- [x] **C2 — sim collision.** `registerPlayerMovement/MonsterAI/BossAI(sim, collision?)` +
      `registerSkillCast(sim, skills, collision?)`; axis-separated `slide` against the walkable
      grid (`collision.ts`: `Collision`/`gridCollision`/`slide`); Blink shortens to the nearest
      walkable point; phase-2 summons stay on walkable ground; `clampToArena` retired (movement is
      world-bounded without a map, collision-bounded with one). combat-sim still passes no collision
      (C4 wires it). Goldens unchanged — actors never crossed the old r=14. Tests: wall block +
      slide + door per system, Blink clamp.
- [ ] **C3 — transport + render.** Worker sends the layout once (`FromWorker` `"area"`);
      renderer builds floor + wall meshes from it. Tests: message round-trip, wall mesh count.
- [ ] **C4 — wiring.** `createCombatSim(seed)` generates the area, places the player at the
      start socket and the Warden in the arena socket. Devlog screenshot.

## Phase D — run loop

One `World` for the whole session; areas swap their contents. A persistent session singleton
carries the portal budget and current area. Can be wired before Phase C lands; the `"map"`
area uses the existing arena + Warden + imps until C1-C4 replace it.

- [ ] **D1 — `SessionC` + singleton.** `SessionC { area: "hideout" | "map"; mapSeed: number;
      portalsLeft: number; mapOpen: boolean; pendingArea: string | null }` registered on a
      dedicated session entity created once at startup. This entity is excluded from the
      area-transition cleanup predicate. Tests: session entity survives a round-trip through
      `areaTransition`, component fields serialise correctly.
- [ ] **D2 — `areaTransition` system.** On `SessionC.pendingArea !== null`: destroy every
      entity that is neither the player nor the session singleton, run the target area's factory
      function to rebuild entities, clear `pendingArea`. Player life, mana, and active cooldowns
      are carried forward on the surviving player entity. Tests: non-player, non-session entities
      are absent after transition; player health and cooldowns survive; factory is called with
      the correct area key.
- [ ] **D3 — hideout area factory.** Spawns a map device entity at `(0, 8)` and up to 6 portal
      entities in a ring around it, count equal to `SessionC.portalsLeft`. Portal entities carry
      a component that marks them as interact targets. Tests: portal count matches `portalsLeft`
      after rebuild, map device is present at the correct position.
- [ ] **D4 — click-to-interact.** Client sends an `interact` intent with a `targetId`. The
      player walks toward the target; the simulation re-checks range authoritatively before
      acting. A hideout portal sets `pendingArea = "map"` and transitions. The in-map return
      portal sets `pendingArea = "hideout"` and transitions. The map device sets
      `SessionC.mapOpen = true` (map selection UI, not yet implemented). Out-of-range intents
      are silently ignored. Tests: out-of-range interact is a no-op; in-range portal triggers
      area transition; in-range map device sets `mapOpen`.
- [ ] **D5 — death in the map.** When the `death` system confirms player death and
      `SessionC.area === "map"`: restore player life and mana to full, decrement
      `SessionC.portalsLeft` by 1, call `resetBoss(world, tick)`, then set
      `pendingArea = "hideout"`. If `portalsLeft` reaches 0, also set `mapOpen = false`.
      `MAP_PORTALS = 6` as the starting budget (zero or one map affix, per spec section 8:
      five post-death revives, six total lives including the initial entry). Tests: portals
      decrement on map death, boss resets, transition to hideout fires, map closes and
      `mapOpen` clears when portals reach 0.
- [ ] **D6 — wiring + devlog screenshot.** `MAP_PORTALS = 6` constant in
      `packages/simulation`; hideout is the default start area (`SessionC.area = "hideout"` on
      init); `createCombatSim` selects arena + Warden + imps when `area === "map"` until Phase C
      replaces it. Devlog screenshot showing the hideout with the map device and the portal ring.

---

## Spec deviations (prototype-scoped, adjudicated 2026-07-21)

The run loop deliberately simplifies the PoE2-faithful research spec (`docs/01`–`docs/08`).
These are prototype scope, not spec corrections — the research pack stays the full-game target
and is left unedited:

- **Respawn target.** `docs/03` `DeathPolicy.respawnTarget` still enumerates `"checkpoint"`; the
  prototype only exercises entrance/hideout respawn. `SessionC` owns respawn; there is no
  `CheckpointC` (deleted, Phase D). Checkpoints remain a valid campaign-area policy for later.
- **Intents collapsed.** `docs/08` lists `InteractIntent` / `ReviveIntent` / `PortalIntent` as
  three client→server messages. The prototype uses a single `interact { targetId }` intent for
  every interactable (portal, map device); revive is automatic (death returns to the hideout,
  no channel). The three-intent split stays the full-game protocol design.
- **"Checkpoints" in build-plan checklists** (`docs/06:126`, `:464`) means the game feature
  (restore life/mana, local travel), not the deleted `CheckpointC` component or replay snapshots.

---

## Risks

- **Blink through walls** (Phase C): the teleport skill ignores collision. Clamp the
  destination to the nearest walkable cell in C2.
- **Monster pathing is naive** — chase + slide, no A*. Acceptable for one arena and short
  corridors; revisit if monsters visibly stick on corners.
- **Telegraph readability under the orthographic camera** — the disc must stay visible under
  the boss mesh; check against `poe2-screenshots/` before committing A7.
- **Determinism**: every new system reads only `world`/`tick`/content — no `Math.random`, no
  wall-clock. `resetBoss` mutates inside a system, never from the client.
