# Milestone 2: Combat Lab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the deterministic kernel into a playable greybox combat arena: an authoritative sim in a Web Worker, a real intent/command/snapshot protocol, a pure `rules` combat engine, a data-driven content pipeline, the three elemental-caster skills, a normal monster pack plus a rare — and a Babylon.js render host with input and a combat HUD you can fight in.

**Architecture:** Approach A (spec §2). The client (`apps/web`, main thread) sends **intents**; a Web Worker owns the authoritative deterministic sim (`@pact/simulation`, built on the M1 kernel) and returns **snapshots**. The boundary shapes live in `@pact/protocol` and are transport-agnostic (`postMessage` now, WebSocket later). All combat math is pure and framework-free in `@pact/rules`; all skills and monsters are data in `@pact/content-schema` (definitions/validators) compiled into `@pact/content-runtime`. Fixed-point integers everywhere in the sim; IEEE floats only after the snapshot crosses into rendering.

**Tech Stack:** TypeScript (strict, ESM), npm workspaces, Vitest, Node 20+. New for this milestone: **Vite** (bundles `apps/web` and the worker for the browser), **React 18** (shell + HUD), **@babylonjs/core** (3D greybox render; `NullEngine` for headless render tests), **jsdom** + **@testing-library/react** (HUD tests). The pure packages keep the M1 no-build-step convention (Vitest transpiles TS via `exports` → `./src/index.ts`).

## Global Constraints

Every task's requirements implicitly include these (from the spec §2, §3, §6). Values are our clean-room tuning targets, not extracted.

- **Determinism is load-bearing (spec §3).** All authoritative spatial/time/resource/percent values are **fixed-point scaled integers** (`@pact/fixed-point`, `FP_SCALE = 1000`). Resistances and integer percents are plain integers `0..100`. IEEE floats are forbidden in `@pact/simulation`, `@pact/rules`, `@pact/protocol` command handling, and content data; floats appear only in `Snapshot` render values and `apps/web` rendering.
- **Named RNG only.** Every random outcome draws from a named `@pact/simulation` RNG stream with a recorded ordinal. Never `Math.random`/`Date`/`performance.now`/`crypto` in sim, rules, or worker command paths. (Client input and wall-clock loop pacing may use `performance.now` — never fed into the sim.)
- **One documented system order per tick.** Execution order equals registration order (Task 15 fixes it) and is the canonical order in this contract. Changing it is a simulation migration.
- **Canonical checksum extends to combat.** New components are flat records of `number | string | boolean` (M1 `serializeWorld` already sorts and hashes them). No new state may live outside a component or the world's `alive`/`nextId` (both already hashed).
- **Stable namespaced IDs (spec §6).** Content is addressed by string IDs like `skill.ember_bolt.v1`, `monster.cinder_imp.v1` — never array indices or display names. Renaming a display label never changes identity.
- **The authority boundary is real (spec §2).** The client never mutates sim state; it sends `Intent`s. The worker is authoritative for movement, collision, damage, death, and resources. Messages use `@pact/protocol` shapes.
- Node floor **20+**, TypeScript **strict**, module type **ESM**. Clean-room: original identifiers only; no PoE asset/data/protocol references.

---

## Shared Interface Contract

**Every task below implements against these exact signatures and values.** Do not invent names or numbers; if a task needs something not here, it is a contract gap — stop and flag it, don't guess.

### Tick & units

- Simulation runs at **30 Hz** (`TICK_HZ = 30`, `MS_PER_TICK = 1000/30`). "Per second" tuning divides by 30 to get per-tick, truncated: `perTick = Math.trunc(perSecondFixed / 30)` unless stated otherwise.
- World arena is the M1 `[WORLD_MIN, WORLD_MAX] = [fp(-100), fp(100)]` square on x and y (top-down; no z in sim — render lifts to 3D).

### `@pact/fixed-point` additions (Task 1)

```ts
// Deterministic integer square root (Newton, pure integer ops — NOT Math.sqrt,
// whose last ulp can differ across engines). Input must be a non-negative
// safe integer; returns floor(sqrt(n)).
export function isqrt(n: number): number;

// Squared distance between two Fixed points, in "fixed²" units (NOT a Fixed).
// For radius comparisons only: compare against (radiusFixed² ). Safe while all
// coords stay within the arena (|dx| ≤ 200000 → dx² ≤ 4e10 ≪ 2^53).
export function fpDist2(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed): number;

// Unit-step vector: the integer (Fixed) step to move `speedFixed` per tick from
// (ax,ay) toward (bx,by). If the remaining distance is ≤ speed, returns the exact
// remaining delta (snaps to target, no overshoot). Deterministic via isqrt.
// Returns { dx: Fixed, dy: Fixed }.
export function fpStepToward(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed, speedFixed: Fixed): { dx: Fixed; dy: Fixed };
```

`fpStepToward` algorithm (exact, deterministic):
```
dx = bx - ax; dy = by - ay
d2 = dx*dx + dy*dy
if d2 === 0 return {dx:0, dy:0}
len = isqrt(d2)                         // Fixed-scale length (since dx,dy are Fixed, len is Fixed)
if len <= speedFixed return {dx, dy}    // within one step: snap exactly
return { dx: Math.trunc(dx * speedFixed / len), dy: Math.trunc(dy * speedFixed / len) }
```

### `@pact/protocol` (Task 2)

Coordinates in `Intent` are **Fixed** integers (client converts its float pick via `fp()`); coordinates in `Snapshot` are **render floats** (worker converts via `toNumber()`).

```ts
export type Intent =
  | { kind: "moveTo"; x: Fixed; y: Fixed }              // click-to-move target
  | { kind: "moveDir"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 } // WASD held direction
  | { kind: "useSkill"; skillId: string; tx: Fixed; ty: Fixed } // aim point
  | { kind: "stop" };

// Deterministic per-tick sim input. Extends the M1 Command. `entity` is the
// player entity the worker owns; `data` carries typed fields per `type`.
export type CommandType = "moveTo" | "moveDir" | "useSkill" | "stop";

export interface ToWorker_Init   { type: "init"; seed: number }
export interface ToWorker_Intent { type: "intent"; intent: Intent }
export interface ToWorker_Reset  { type: "reset" }
export type ToWorker = ToWorker_Init | ToWorker_Intent | ToWorker_Reset;

export interface SnapshotEntity {
  id: number;
  kind: "monster" | "projectile" | "groundArea";
  x: number; y: number;                 // render floats
  radius?: number;                      // projectile & groundArea (render)
  life?: number; maxLife?: number;      // monster
  rare?: boolean;                       // monster
  remainingSeconds?: number;            // groundArea
  ailmentStacks?: number;               // monster (burning stacks)
}
export interface Snapshot {
  tick: number;
  player: {
    id: number; x: number; y: number;
    life: number; maxLife: number; mana: number; maxMana: number;
    cooldowns: Record<string, number>;  // skillId -> remaining seconds (render)
    alive: boolean;
  };
  entities: SnapshotEntity[];           // sorted by id (deterministic)
}
export interface FromWorker_Snapshot { type: "snapshot"; snapshot: Snapshot }
export interface FromWorker_Ready    { type: "ready" }
export type FromWorker = FromWorker_Snapshot | FromWorker_Ready;

// Codecs are structural + validating (postMessage structured-clones; binary later).
export function validateIntent(v: unknown): Intent;           // throws on malformed
export function isToWorker(v: unknown): v is ToWorker;
```

### `@pact/rules` (Tasks 4–6)

`rules` owns combat **behavior** and `StatBlock`; it imports all data types
(`DamageType`, `DamageSpec`, `Defenses`, `MonsterDef`, `RareModifier`, …) from
`@pact/content-schema`. Dependency direction is one-way: `fixed-point ← content-schema ← rules ← simulation`. No `rules ↔ content-schema` cycle.

```ts
import type { DamageType, DamageSpec, Defenses, MonsterDef, RareModifier } from "@pact/content-schema";

export interface StatBlock {
  maxLifeFixed: Fixed; maxManaFixed: Fixed;
  manaRegenPerSecFixed: Fixed;
  moveSpeedFixed: Fixed;          // units per SECOND (systems derive per-tick)
  fireResPct: number;            // integer 0..100, capped at RES_CAP on use
  armourFixed: Fixed;
}
export const RES_CAP = 75;
export const ARMOUR_K: Fixed;    // = fp(10); armour == K halves a physical hit

export function baseCasterStats(): StatBlock;

// Final damage after the one resistance channel (fire) OR one mitigation
// channel (armour, physical). Takes a DamageSpec ({type, amountFixed}) from
// content-schema. Deterministic integer math. Never negative.
//   fire:     final = trunc(raw * (100 - min(res, RES_CAP)) / 100)
//   physical: final = trunc(raw * ARMOUR_K / (armourFixed + ARMOUR_K))
export function applyDamage(pkt: DamageSpec, def: Defenses): Fixed;

export interface AilmentState { kind: "burning"; stacks: number; dpsFixed: Fixed; expiryTick: number }
export const AILMENT_TICK_INTERVAL = 6;   // ticks between DoT applications (5/sec)

// Add one application: bump stacks (cap), set dps, refresh expiry to now+duration.
export function refreshBurning(prev: AilmentState | undefined, addStacks: number, dpsFixed: Fixed, nowTick: number, durationTicks: number, maxStacks: number): AilmentState;

// Damage for one DoT application: trunc(stacks * dpsFixed * AILMENT_TICK_INTERVAL / 30).
export function burningTickDamage(a: AilmentState): Fixed;

// Apply the rare multipliers `mods` (RARE_TEMPLATE, passed in by the caller —
// rules must NOT import content-runtime) to a normal MonsterDef, returning a new
// def. Fixed multipliers truncate: e.g. maxLifeFixed = trunc(maxLifeFixed*lifeMulPct/100).
export function makeRare(def: MonsterDef, mods: RareModifier): MonsterDef;
```

### `@pact/content-schema` (Task 3)

Owns **all data types** (imported by `rules`, `content-runtime`, `simulation`) plus validators. Only dependency is `@pact/fixed-point` (for `Fixed`).

```ts
export type DamageType = "fire" | "physical";
export interface Defenses    { fireResPct: number; armourFixed: Fixed }
export interface DamageSpec  { type: DamageType; amountFixed: Fixed }
export interface AilmentSpec { kind: "burning"; stacksPerApply: number; dpsFixed: Fixed; durationTicks: number; maxStacks: number }

export type EffectNode =
  | { type: "spawnProjectile"; speedPerSecFixed: Fixed; radiusFixed: Fixed; maxRangeFixed: Fixed; damage: DamageSpec }
  | { type: "spawnGroundArea"; radiusFixed: Fixed; durationTicks: number; ailment: AilmentSpec }
  | { type: "teleport"; distanceFixed: Fixed };

export interface SkillDef  { id: string; name: string; manaCostFixed: Fixed; cooldownTicks: number; effects: EffectNode[] }
export interface RareModifier { lifeMulPct: number; moveSpeedMulPct: number; damageMulPct: number; addedFireResPct: number }
export interface MonsterDef {
  id: string; name: string;
  maxLifeFixed: Fixed; moveSpeedFixed: Fixed;   // moveSpeed = units/SEC
  attackRangeFixed: Fixed; attackDamage: DamageSpec; attackCooldownTicks: number;
  radiusFixed: Fixed;                            // body radius (collision)
  defenses: Defenses;
}

export interface ValidationResult { ok: boolean; errors: string[] }
export function validateSkillDef(v: unknown): ValidationResult;
export function validateMonsterDef(v: unknown): ValidationResult;
export const ID_PATTERN: RegExp;   // /^(skill|monster)\.[a-z0-9_]+\.v\d+$/
```

### `@pact/content-runtime` (Task 7) — authored slice content (our clean-room numbers)

```ts
export const CONTENT_VERSION = "slice1.v1";
export const SKILLS: ReadonlyMap<string, SkillDef>;
export const MONSTERS: ReadonlyMap<string, MonsterDef>;
export const RARE_TEMPLATE: RareModifier;
```

Authored values (Fixed via `fp()`; `perSec` where noted):

| Skill `id` | name | manaCost | cooldownTicks | effects |
|---|---|---|---|---|
| `skill.ember_bolt.v1` | Ember Bolt | fp(8) | 6 | spawnProjectile: speed fp(12)/s, radius fp(0.4), maxRange fp(20), damage fire fp(25) |
| `skill.cinder_ground.v1` | Cinder Ground | fp(20) | 30 | spawnGroundArea: radius fp(2.5), duration 90, ailment burning {stacksPerApply 1, dps fp(8), durationTicks 60, maxStacks 5} |
| `skill.blink.v1` | Blink | fp(15) | 90 | teleport: distance fp(5) |

| Monster `id` | name | maxLife | moveSpeed/s | attackRange | attackDamage | atkCooldown | radius | defenses |
|---|---|---|---|---|---|---|---|---|
| `monster.cinder_imp.v1` | Cinder Imp | fp(40) | fp(2.4) | fp(1.2) | physical fp(6) | 45 | fp(0.5) | {fireResPct 0, armourFixed fp(0.5)} |

`RARE_TEMPLATE = { lifeMulPct: 250, moveSpeedMulPct: 120, damageMulPct: 150, addedFireResPct: 30 }` (life ×2.5, move ×1.2, damage ×1.5, +30 fire res). `makeRare` applies: `maxLifeFixed = trunc(maxLifeFixed*250/100)`, `moveSpeedFixed = trunc(*120/100)`, `attackDamage.amountFixed = trunc(*150/100)`, `defenses.fireResPct += 30`.

Player base (`baseCasterStats`): maxLife fp(100), maxMana fp(60), manaRegen fp(6)/s, moveSpeed fp(3.5)/s, fireResPct 0, armourFixed fp(0). Player body radius fp(0.5). Pack: 5 × Cinder Imp; the lab also spawns 1 rare Cinder Imp.

### `@pact/simulation` combat additions (Tasks 8–16)

**Components** (component name → flat record). Fixed unless noted.

| Component | Fields |
|---|---|
| `position` | `x, y` (M1, reused) |
| `health` | `life, maxLife` |
| `mana` | `mana, maxMana, regen` (regen is per-tick Fixed) |
| `faction` | `team` (number: `0`=player, `1`=monster) |
| `player` | `moveSpeed` (per-tick, derived), `bodyRadius` |
| `moveTarget` | `x, y, active` (active: `1`/`0`) |
| `moveDir` | `dx, dy` (each -1/0/1; overrides target when nonzero) |
| `cooldowns` | `[skillId]: readyTick` (flat number record; keys sorted in checksum) |
| `monster` | `defId` (string), `moveSpeed` (per-tick), `bodyRadius`, `attackRange`, `attackCooldownTicks`, `attackDamage`, `attackType` (`0`=fire/`1`=physical), `attackReadyTick`, `state` (string: `"idle"|"chase"|"attack"`), `rare` (`1`/`0`) |
| `defenses` | `fireResPct` (int), `armour` (Fixed) |
| `projectile` | `dirx, diry` (per-tick step Fixed), `remainingRange`, `radius`, `damageType`(0/1), `damageAmount`, `ownerId`, `team` |
| `groundArea` | `radius, expiryTick, nextTick, ailmentKind`(string), `stacksPerApply, dps, ailmentDuration, maxStacks` |
| `ailment` | `kind`(string), `stacks, dps, expiryTick` |

**Damage queue.** The `Simulation` gains a per-tick `damageQueue: DamageEvent[]`, cleared at the start of each tick, drained by `damageResolve`:
```ts
interface DamageEvent { target: Entity; source: Entity; amountFixed: Fixed; type: 0 | 1 } // type: 0 fire, 1 physical
sim.enqueueDamage(e: DamageEvent): void;   // systems call this; order-independent (resolve sorts)
```

**System registration order (Task 15) — canonical, do not reorder:**
1. `resourceRegen` — mana += trunc(regenPerSec/30), clamp to max.
2. `skillCast` — consume `useSkill` commands: gate on cooldown+mana; spend mana; set cooldown; execute effect nodes (spawn projectile entity / spawn ground-area entity / teleport the caster).
3. `playerMovement` — consume `moveTo`/`moveDir`/`stop` commands → set `moveTarget`/`moveDir`; integrate player via `fpStepToward` (target) or `moveDir`×speed; clamp to arena.
4. `monsterAI` — per monster (ascending id): acquire nearest player (`fpDist2`), set `state`; chase via `fpStepToward`; if in `attackRange` and `tick >= attackReadyTick`, enqueue attack damage and set `attackReadyTick = tick + cooldown`.
5. `projectileMove` — integrate each projectile by its per-tick step; decrement `remainingRange`; on first monster within `radius+bodyRadius` (ascending id) enqueue damage and mark for despawn; despawn when range ≤ 0.
6. `groundAreaTick` — when `tick >= nextTick`: for each monster within `radius+bodyRadius`, refresh burning ailment; advance `nextTick += AILMENT_TICK_INTERVAL`.
7. `ailmentTick` — for each entity with `ailment`, when `(tick - startPhase) % AILMENT_TICK_INTERVAL === 0` enqueue `burningTickDamage`; remove ailment when `tick >= expiryTick`.
8. `damageResolve` — sort `damageQueue` by `(target, source, type)`; apply each via `rules.applyDamage` against the target's `defenses`; subtract from `health.life` (floor 0).
9. `death` — remove monsters with `life <= 0` (despawn). If the player's `life <= 0`, set player `alive=0`, respawn at origin with full life/mana next tick (`respawn` folded here for the lab; boss-reset is M3).
10. `expiry` — despawn projectiles flagged/out of range and ground areas past `expiryTick`.

**Helpers (Task 16):**
```ts
export function intentToCommand(intent: Intent, player: Entity, tick: number): Command;   // pure
export function buildSnapshot(world: World, sim: Simulation, tick: number, contentVersion: string): Snapshot;  // pure read
```

### apps/web (Tasks 18–23)

- `sim-worker.ts` owns a `Simulation` + the combat systems + content; a fixed-step accumulator advances at `MS_PER_TICK`; buffers `Intent`s into the next tick's commands; posts a `Snapshot` after each tick (or every Nth tick).
- Render reads snapshots, interpolates positions between the last two, draws greybox meshes (player = capsule, monster = box, rare = taller box, projectile = sphere, groundArea = flat disc).
- HUD (React) shows life/mana globes and three skill slots with cooldown fill, from the latest snapshot.

---

## Tasks

### Task 1: `@pact/fixed-point` geometry (`isqrt`, `fpDist2`, `fpStepToward`)

**Files:**
- Modify: `packages/fixed-point/src/index.ts`
- Test: `packages/fixed-point/src/geometry.test.ts`

**Interfaces:**
- Consumes: `Fixed`, `FP_SCALE`, `fp` (all already exported from `packages/fixed-point/src/index.ts`)
- Produces: `isqrt(n: number): number`, `fpDist2(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed): number`, `fpStepToward(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed, speedFixed: Fixed): { dx: Fixed; dy: Fixed }` — consumed by Task 8+ simulation systems

---

- [ ] **Step 1: Write the failing test**

`packages/fixed-point/src/geometry.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { isqrt, fpDist2, fpStepToward, fp } from "./index.js";

describe("isqrt", () => {
  test("isqrt(0) === 0", () => {
    expect(isqrt(0)).toBe(0);
  });
  test("isqrt(1) === 1", () => {
    expect(isqrt(1)).toBe(1);
  });
  test("isqrt(4) === 2", () => {
    expect(isqrt(4)).toBe(2);
  });
  test("isqrt(15) === 3 (floor)", () => {
    expect(isqrt(15)).toBe(3);
  });
  test("isqrt(16) === 4", () => {
    expect(isqrt(16)).toBe(4);
  });
  test("isqrt(25000000) === 5000", () => {
    expect(isqrt(25000000)).toBe(5000);
  });
  test("isqrt is deterministic (same input → same output twice)", () => {
    expect(isqrt(123456789)).toBe(isqrt(123456789));
  });
});

describe("fpDist2", () => {
  test("(0,0)→(3,4) === 25000000", () => {
    // fp(3)=3000, fp(4)=4000; 3000²+4000²=9000000+16000000=25000000
    expect(fpDist2(fp(0), fp(0), fp(3), fp(4))).toBe(25000000);
  });
  test("same point → 0", () => {
    expect(fpDist2(fp(5), fp(7), fp(5), fp(7))).toBe(0);
  });
});

describe("fpStepToward", () => {
  test("zero distance returns {dx:0, dy:0}", () => {
    expect(fpStepToward(fp(0), fp(0), fp(0), fp(0), fp(0.4))).toEqual({ dx: 0, dy: 0 });
  });

  test("snaps when remaining ≤ speed: (0,0)→(0,0.05) speed 0.1 → {dx:0, dy:fp(0.05)}", () => {
    // dx=0, dy=fp(0.05)=50; d2=2500; len=isqrt(2500)=50; 50<=100 → snap
    expect(fpStepToward(fp(0), fp(0), fp(0), fp(0.05), fp(0.1))).toEqual({
      dx: 0,
      dy: fp(0.05), // 50
    });
  });

  test("long axis: (0,0)→(10,0) speed 0.4 → {dx:400, dy:0}", () => {
    // dx=10000, dy=0; d2=100000000; len=10000; 10000>400 → trunc(10000*400/10000)=400
    expect(fpStepToward(fp(0), fp(0), fp(10), fp(0), fp(0.4))).toEqual({
      dx: 400,
      dy: 0,
    });
  });

  test("diagonal: (0,0)→(10,10) speed 0.4 → {dx:282, dy:282}", () => {
    // dx=10000, dy=10000; d2=200000000; len=isqrt(200000000)=14142
    // trunc(10000*400/14142) = trunc(282.84...) = 282
    expect(fpStepToward(fp(0), fp(0), fp(10), fp(10), fp(0.4))).toEqual({
      dx: 282,
      dy: 282,
    });
  });

  test("isqrt(200000000) === 14142 (diagonal magnitude pre-check)", () => {
    expect(isqrt(200000000)).toBe(14142);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/fixed-point/src/geometry.test.ts`

Expected: FAIL with "isqrt is not a function" (or similar — the exports don't exist yet)

---

- [ ] **Step 3: Write minimal implementation**

Append to `packages/fixed-point/src/index.ts` (after the existing `fpSign` export):

```ts
// Deterministic integer square root via Newton's method (pure integer ops).
// Returns floor(sqrt(n)). NOT Math.sqrt — guaranteed identical across JS engines.
// Uses Math.floor(_/2), NOT >>1: `>>` truncates to 32 bits, and arena squared
// distances reach ~8e10 (dx,dy up to 200000 → dx²+dy² well above 2^31), which
// >>1 would corrupt. Math.floor keeps full 2^53 integer precision.
export function isqrt(n: number): number {
  if (n < 2) return n;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

// Squared distance between two Fixed points (in fixed² units, not Fixed).
// Safe to compare against radiusFixed² while coords stay within the arena.
export function fpDist2(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

// Integer step vector: moves speedFixed (Fixed) per tick from (ax,ay) toward (bx,by).
// Snaps exactly when remaining distance ≤ speed (no overshoot). Deterministic via isqrt.
export function fpStepToward(
  ax: Fixed,
  ay: Fixed,
  bx: Fixed,
  by: Fixed,
  speedFixed: Fixed,
): { dx: Fixed; dy: Fixed } {
  const dx = bx - ax;
  const dy = by - ay;
  const d2 = dx * dx + dy * dy;
  if (d2 === 0) return { dx: 0, dy: 0 };
  const len = isqrt(d2);
  if (len <= speedFixed) return { dx, dy };
  return {
    dx: Math.trunc((dx * speedFixed) / len),
    dy: Math.trunc((dy * speedFixed) / len),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/fixed-point/src/geometry.test.ts`

Expected: PASS (all 10 assertions green)

- [ ] **Step 5: Commit**

`git add packages/fixed-point/src/index.ts packages/fixed-point/src/geometry.test.ts && git commit -m "feat(fixed-point): add isqrt, fpDist2, fpStepToward geometry helpers"`

---

### Task 2: `@pact/protocol` package

**Files:**
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/protocol.test.ts`

**Interfaces:**
- Consumes: `Fixed` type from `@pact/fixed-point`
- Produces: `Intent`, `CommandType`, `ToWorker_Init`, `ToWorker_Intent`, `ToWorker_Reset`, `ToWorker`, `SnapshotEntity`, `Snapshot`, `FromWorker_Snapshot`, `FromWorker_Ready`, `FromWorker`, `validateIntent(v: unknown): Intent`, `isToWorker(v: unknown): v is ToWorker` — consumed by Tasks 8–16 (simulation worker bridge) and Tasks 18–23 (apps/web)

---

- [ ] **Step 1: Write the failing test**

`packages/protocol/src/protocol.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { validateIntent, isToWorker } from "./index.js";
import { fp } from "@pact/fixed-point";

describe("validateIntent — valid intents pass through", () => {
  test("moveTo with integer coords", () => {
    const intent = { kind: "moveTo", x: fp(3), y: fp(4) };
    expect(validateIntent(intent)).toEqual(intent);
  });

  test("moveDir with valid direction", () => {
    const intent = { kind: "moveDir", dx: 1 as const, dy: -1 as const };
    expect(validateIntent(intent)).toEqual(intent);
  });

  test("moveDir with all zeros", () => {
    const intent = { kind: "moveDir", dx: 0 as const, dy: 0 as const };
    expect(validateIntent(intent)).toEqual(intent);
  });

  test("useSkill with nonempty skillId and integer coords", () => {
    const intent = { kind: "useSkill", skillId: "skill.ember_bolt.v1", tx: fp(5), ty: fp(6) };
    expect(validateIntent(intent)).toEqual(intent);
  });

  test("stop", () => {
    expect(validateIntent({ kind: "stop" })).toEqual({ kind: "stop" });
  });
});

describe("validateIntent — malformed inputs throw", () => {
  test("unknown kind throws", () => {
    expect(() => validateIntent({ kind: "dash" })).toThrow();
  });

  test("moveTo missing x throws", () => {
    expect(() => validateIntent({ kind: "moveTo", y: fp(4) })).toThrow();
  });

  test("moveTo non-integer x (1.5) throws", () => {
    expect(() => validateIntent({ kind: "moveTo", x: 1.5, y: fp(4) })).toThrow();
  });

  test("moveDir dx=2 throws", () => {
    expect(() => validateIntent({ kind: "moveDir", dx: 2, dy: 0 })).toThrow();
  });

  test("useSkill empty skillId throws", () => {
    expect(() =>
      validateIntent({ kind: "useSkill", skillId: "", tx: fp(1), ty: fp(2) }),
    ).toThrow();
  });

  test("non-object throws", () => {
    expect(() => validateIntent(42)).toThrow();
  });

  test("null throws", () => {
    expect(() => validateIntent(null)).toThrow();
  });
});

describe("isToWorker", () => {
  test("valid init message", () => {
    expect(isToWorker({ type: "init", seed: 12345 })).toBe(true);
  });

  test("valid intent message", () => {
    expect(
      isToWorker({ type: "intent", intent: { kind: "stop" } }),
    ).toBe(true);
  });

  test("valid reset message", () => {
    expect(isToWorker({ type: "reset" })).toBe(true);
  });

  test("null → false", () => {
    expect(isToWorker(null)).toBe(false);
  });

  test("{type:'nope'} → false", () => {
    expect(isToWorker({ type: "nope" })).toBe(false);
  });

  test("non-object (string) → false", () => {
    expect(isToWorker("intent")).toBe(false);
  });

  test("init without seed → false", () => {
    expect(isToWorker({ type: "init" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/protocol/src/protocol.test.ts`

Expected: FAIL with "Cannot find module '@pact/protocol'" (package doesn't exist yet)

---

- [ ] **Step 3: Create package scaffolding and implementation**

`packages/protocol/package.json`:

```json
{
  "name": "@pact/protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@pact/fixed-point": "*"
  }
}
```

`packages/protocol/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/protocol/src/index.ts`:

```ts
import type { Fixed } from "@pact/fixed-point";

// ---------------------------------------------------------------------------
// Intent — client-side input, coords are Fixed integers (client calls fp())
// ---------------------------------------------------------------------------

export type Intent =
  | { kind: "moveTo"; x: Fixed; y: Fixed }
  | { kind: "moveDir"; dx: -1 | 0 | 1; dy: -1 | 0 | 1 }
  | { kind: "useSkill"; skillId: string; tx: Fixed; ty: Fixed }
  | { kind: "stop" };

export type CommandType = "moveTo" | "moveDir" | "useSkill" | "stop";

// ---------------------------------------------------------------------------
// Worker message types (client → worker)
// ---------------------------------------------------------------------------

export interface ToWorker_Init   { type: "init"; seed: number }
export interface ToWorker_Intent { type: "intent"; intent: Intent }
export interface ToWorker_Reset  { type: "reset" }
export type ToWorker = ToWorker_Init | ToWorker_Intent | ToWorker_Reset;

// ---------------------------------------------------------------------------
// Snapshot types (worker → client); coords are render floats (worker calls toNumber())
// ---------------------------------------------------------------------------

export interface SnapshotEntity {
  id: number;
  kind: "monster" | "projectile" | "groundArea";
  x: number; y: number;
  radius?: number;
  life?: number; maxLife?: number;
  rare?: boolean;
  remainingSeconds?: number;
  ailmentStacks?: number;
}

export interface Snapshot {
  tick: number;
  player: {
    id: number; x: number; y: number;
    life: number; maxLife: number; mana: number; maxMana: number;
    cooldowns: Record<string, number>;
    alive: boolean;
  };
  entities: SnapshotEntity[];
}

export interface FromWorker_Snapshot { type: "snapshot"; snapshot: Snapshot }
export interface FromWorker_Ready    { type: "ready" }
export type FromWorker = FromWorker_Snapshot | FromWorker_Ready;

// ---------------------------------------------------------------------------
// Codecs
// ---------------------------------------------------------------------------

// Validates and returns the Intent, or throws a descriptive Error.
export function validateIntent(v: unknown): Intent {
  if (typeof v !== "object" || v === null) {
    throw new Error("validateIntent: expected an object");
  }
  const obj = v as Record<string, unknown>;
  switch (obj["kind"]) {
    case "moveTo": {
      if (!Number.isInteger(obj["x"])) throw new Error("validateIntent moveTo: x must be an integer");
      if (!Number.isInteger(obj["y"])) throw new Error("validateIntent moveTo: y must be an integer");
      return { kind: "moveTo", x: obj["x"] as Fixed, y: obj["y"] as Fixed };
    }
    case "moveDir": {
      const dx = obj["dx"];
      const dy = obj["dy"];
      if (dx !== -1 && dx !== 0 && dx !== 1)
        throw new Error("validateIntent moveDir: dx must be -1, 0, or 1");
      if (dy !== -1 && dy !== 0 && dy !== 1)
        throw new Error("validateIntent moveDir: dy must be -1, 0, or 1");
      return { kind: "moveDir", dx: dx as -1 | 0 | 1, dy: dy as -1 | 0 | 1 };
    }
    case "useSkill": {
      if (typeof obj["skillId"] !== "string" || obj["skillId"].length === 0)
        throw new Error("validateIntent useSkill: skillId must be a non-empty string");
      if (!Number.isInteger(obj["tx"])) throw new Error("validateIntent useSkill: tx must be an integer");
      if (!Number.isInteger(obj["ty"])) throw new Error("validateIntent useSkill: ty must be an integer");
      return {
        kind: "useSkill",
        skillId: obj["skillId"] as string,
        tx: obj["tx"] as Fixed,
        ty: obj["ty"] as Fixed,
      };
    }
    case "stop":
      return { kind: "stop" };
    default:
      throw new Error(`validateIntent: unknown kind: ${String(obj["kind"])}`);
  }
}

const TO_WORKER_TYPES = new Set(["init", "intent", "reset"]);

// Structural type guard for ToWorker messages.
export function isToWorker(v: unknown): v is ToWorker {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  if (!TO_WORKER_TYPES.has(obj["type"] as string)) return false;
  switch (obj["type"]) {
    case "init":   return typeof obj["seed"] === "number";
    case "intent": return typeof obj["intent"] === "object" && obj["intent"] !== null;
    case "reset":  return true;
    default:       return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/protocol/src/protocol.test.ts`

Expected: PASS (all 18 assertions green)

- [ ] **Step 5: Commit**

`git add packages/protocol/package.json packages/protocol/tsconfig.json packages/protocol/src/index.ts packages/protocol/src/protocol.test.ts && git commit -m "feat(protocol): add @pact/protocol package with Intent types, validateIntent, isToWorker"`

### Task 3: `@pact/content-schema` — all data types + validators

**Files:**
- Create: `packages/content-schema/package.json`
- Create: `packages/content-schema/tsconfig.json`
- Create: `packages/content-schema/src/index.ts`
- Create: `packages/content-schema/src/schema.test.ts`

**Interfaces:**
- Consumes: `@pact/fixed-point` (`Fixed`, `fp`).
- Produces: `DamageType`, `Defenses`, `DamageSpec`, `AilmentSpec`, `EffectNode`, `SkillDef`, `RareModifier`, `MonsterDef`, `ValidationResult`, `validateSkillDef(v)`, `validateMonsterDef(v)`, `ID_PATTERN`.

---

- [ ] **Step 1: Write failing test**

`packages/content-schema/src/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import {
  ID_PATTERN,
  validateSkillDef,
  validateMonsterDef,
  type SkillDef,
  type MonsterDef,
} from "./index.js";

const validSkill: SkillDef = {
  id: "skill.ember_bolt.v1",
  name: "Ember Bolt",
  manaCostFixed: fp(8),
  cooldownTicks: 6,
  effects: [
    {
      type: "spawnProjectile",
      speedPerSecFixed: fp(12),
      radiusFixed: fp(0.4),
      maxRangeFixed: fp(20),
      damage: { type: "fire", amountFixed: fp(25) },
    },
  ],
};

const validMonster: MonsterDef = {
  id: "monster.cinder_imp.v1",
  name: "Cinder Imp",
  maxLifeFixed: fp(40),
  moveSpeedFixed: fp(2.4),
  attackRangeFixed: fp(1.2),
  attackDamage: { type: "physical", amountFixed: fp(6) },
  attackCooldownTicks: 45,
  radiusFixed: fp(0.5),
  defenses: { fireResPct: 0, armourFixed: fp(0.5) },
};

describe("ID_PATTERN", () => {
  it("matches valid skill id", () => {
    expect(ID_PATTERN.test("skill.ember_bolt.v1")).toBe(true);
  });
  it("matches valid monster id", () => {
    expect(ID_PATTERN.test("monster.cinder_imp.v1")).toBe(true);
  });
  it("rejects PascalCase", () => {
    expect(ID_PATTERN.test("EmberBolt")).toBe(false);
  });
  it("rejects too-short path", () => {
    expect(ID_PATTERN.test("skill.x")).toBe(false);
  });
  it("rejects unknown prefix", () => {
    expect(ID_PATTERN.test("item.sword.v1")).toBe(false);
  });
});

describe("validateSkillDef", () => {
  it("accepts a valid SkillDef", () => {
    const r = validateSkillDef(validSkill);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("rejects bad id", () => {
    const r = validateSkillDef({ ...validSkill, id: "EmberBolt" });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("id"))).toBe(true);
  });

  it("rejects negative manaCost", () => {
    const r = validateSkillDef({ ...validSkill, manaCostFixed: -1 });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("manaCostFixed"))).toBe(true);
  });

  it("rejects fractional manaCost (non-integer)", () => {
    const r = validateSkillDef({ ...validSkill, manaCostFixed: 1.5 });
    expect(r.ok).toBe(false);
  });

  it("rejects negative cooldownTicks", () => {
    const r = validateSkillDef({ ...validSkill, cooldownTicks: -1 });
    expect(r.ok).toBe(false);
  });

  it("rejects empty effects array", () => {
    const r = validateSkillDef({ ...validSkill, effects: [] });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("effects"))).toBe(true);
  });

  it("rejects unknown effect type", () => {
    const r = validateSkillDef({
      ...validSkill,
      effects: [{ type: "summonMinion" } as never],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects spawnProjectile missing damage field", () => {
    const r = validateSkillDef({
      ...validSkill,
      effects: [
        {
          type: "spawnProjectile",
          speedPerSecFixed: fp(12),
          radiusFixed: fp(0.4),
          maxRangeFixed: fp(20),
          // damage omitted
        } as never,
      ],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects non-object input", () => {
    const r = validateSkillDef(null);
    expect(r.ok).toBe(false);
  });
});

describe("validateMonsterDef", () => {
  it("accepts a valid MonsterDef", () => {
    const r = validateMonsterDef(validMonster);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("rejects bad id", () => {
    const r = validateMonsterDef({ ...validMonster, id: "CinderImp" });
    expect(r.ok).toBe(false);
  });

  it("rejects negative maxLifeFixed", () => {
    const r = validateMonsterDef({ ...validMonster, maxLifeFixed: -1 });
    expect(r.ok).toBe(false);
  });

  it("rejects fractional attackCooldownTicks", () => {
    const r = validateMonsterDef({ ...validMonster, attackCooldownTicks: 1.5 });
    expect(r.ok).toBe(false);
  });

  it("rejects missing defenses", () => {
    const { defenses: _d, ...noDefenses } = validMonster;
    const r = validateMonsterDef(noDefenses);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("defenses"))).toBe(true);
  });

  it("rejects invalid attackDamage type", () => {
    const r = validateMonsterDef({
      ...validMonster,
      attackDamage: { type: "lightning", amountFixed: fp(6) },
    });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test (expected FAIL)**

```bash
npx vitest run packages/content-schema/src/schema.test.ts
```

Expected FAIL: `Cannot find module './index.js'` — package does not exist yet.

---

- [ ] **Step 3: Create `packages/content-schema/package.json`**

```json
{
  "name": "@pact/content-schema",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@pact/fixed-point": "*"
  }
}
```

- [ ] **Step 4: Create `packages/content-schema/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 5: Implement `packages/content-schema/src/index.ts`**

```ts
import type { Fixed } from "@pact/fixed-point";

// ── Types ────────────────────────────────────────────────────────────────────

export type DamageType = "fire" | "physical";

export interface Defenses {
  fireResPct: number;
  armourFixed: Fixed;
}

export interface DamageSpec {
  type: DamageType;
  amountFixed: Fixed;
}

export interface AilmentSpec {
  kind: "burning";
  stacksPerApply: number;
  dpsFixed: Fixed;
  durationTicks: number;
  maxStacks: number;
}

export type EffectNode =
  | {
      type: "spawnProjectile";
      speedPerSecFixed: Fixed;
      radiusFixed: Fixed;
      maxRangeFixed: Fixed;
      damage: DamageSpec;
    }
  | {
      type: "spawnGroundArea";
      radiusFixed: Fixed;
      durationTicks: number;
      ailment: AilmentSpec;
    }
  | { type: "teleport"; distanceFixed: Fixed };

export interface SkillDef {
  id: string;
  name: string;
  manaCostFixed: Fixed;
  cooldownTicks: number;
  effects: EffectNode[];
}

export interface RareModifier {
  lifeMulPct: number;
  moveSpeedMulPct: number;
  damageMulPct: number;
  addedFireResPct: number;
}

export interface MonsterDef {
  id: string;
  name: string;
  maxLifeFixed: Fixed;
  moveSpeedFixed: Fixed;
  attackRangeFixed: Fixed;
  attackDamage: DamageSpec;
  attackCooldownTicks: number;
  radiusFixed: Fixed;
  defenses: Defenses;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// ── Validators ────────────────────────────────────────────────────────────────

export const ID_PATTERN: RegExp = /^(skill|monster)\.[a-z0-9_]+\.v\d+$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonNegInt(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function validateDamageSpec(v: unknown, path: string, errors: string[]): boolean {
  if (!isObj(v)) {
    errors.push(`${path}: must be an object`);
    return false;
  }
  let ok = true;
  if (v["type"] !== "fire" && v["type"] !== "physical") {
    errors.push(`${path}.type: must be "fire" or "physical"`);
    ok = false;
  }
  if (!isNonNegInt(v["amountFixed"])) {
    errors.push(`${path}.amountFixed: must be a non-negative integer`);
    ok = false;
  }
  return ok;
}

function validateEffectNode(v: unknown, idx: number, errors: string[]): boolean {
  const path = `effects[${idx}]`;
  if (!isObj(v)) {
    errors.push(`${path}: must be an object`);
    return false;
  }
  let ok = true;
  const type = v["type"];
  if (type === "spawnProjectile") {
    if (typeof v["speedPerSecFixed"] !== "number") {
      errors.push(`${path}.speedPerSecFixed: required number`);
      ok = false;
    }
    if (typeof v["radiusFixed"] !== "number") {
      errors.push(`${path}.radiusFixed: required number`);
      ok = false;
    }
    if (typeof v["maxRangeFixed"] !== "number") {
      errors.push(`${path}.maxRangeFixed: required number`);
      ok = false;
    }
    if (!validateDamageSpec(v["damage"], `${path}.damage`, errors)) ok = false;
  } else if (type === "spawnGroundArea") {
    if (typeof v["radiusFixed"] !== "number") {
      errors.push(`${path}.radiusFixed: required number`);
      ok = false;
    }
    if (!isNonNegInt(v["durationTicks"])) {
      errors.push(`${path}.durationTicks: must be a non-negative integer`);
      ok = false;
    }
    const a = v["ailment"];
    if (!isObj(a)) {
      errors.push(`${path}.ailment: required object`);
      ok = false;
    } else {
      if (a["kind"] !== "burning") {
        errors.push(`${path}.ailment.kind: must be "burning"`);
        ok = false;
      }
      if (!isNonNegInt(a["stacksPerApply"])) {
        errors.push(`${path}.ailment.stacksPerApply: must be non-negative integer`);
        ok = false;
      }
      if (typeof a["dpsFixed"] !== "number") {
        errors.push(`${path}.ailment.dpsFixed: required number`);
        ok = false;
      }
      if (!isNonNegInt(a["durationTicks"])) {
        errors.push(`${path}.ailment.durationTicks: must be non-negative integer`);
        ok = false;
      }
      if (!isNonNegInt(a["maxStacks"])) {
        errors.push(`${path}.ailment.maxStacks: must be non-negative integer`);
        ok = false;
      }
    }
  } else if (type === "teleport") {
    if (typeof v["distanceFixed"] !== "number") {
      errors.push(`${path}.distanceFixed: required number`);
      ok = false;
    }
  } else {
    errors.push(`${path}.type: unknown effect type "${String(type)}"`);
    ok = false;
  }
  return ok;
}

export function validateSkillDef(v: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(v)) {
    return { ok: false, errors: ["input: must be an object"] };
  }
  if (typeof v["id"] !== "string" || !ID_PATTERN.test(v["id"])) {
    errors.push(`id: must match ID_PATTERN, got "${String(v["id"])}"`);
  }
  if (typeof v["name"] !== "string" || v["name"].length === 0) {
    errors.push("name: must be a non-empty string");
  }
  if (!isNonNegInt(v["manaCostFixed"])) {
    errors.push("manaCostFixed: must be a non-negative integer");
  }
  if (!isNonNegInt(v["cooldownTicks"])) {
    errors.push("cooldownTicks: must be a non-negative integer");
  }
  const effects = v["effects"];
  if (!Array.isArray(effects) || effects.length === 0) {
    errors.push("effects: must be a non-empty array");
  } else {
    for (let i = 0; i < effects.length; i++) {
      validateEffectNode(effects[i], i, errors);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateMonsterDef(v: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(v)) {
    return { ok: false, errors: ["input: must be an object"] };
  }
  if (typeof v["id"] !== "string" || !ID_PATTERN.test(v["id"])) {
    errors.push(`id: must match ID_PATTERN, got "${String(v["id"])}"`);
  }
  if (typeof v["name"] !== "string" || v["name"].length === 0) {
    errors.push("name: must be a non-empty string");
  }
  for (const field of [
    "maxLifeFixed",
    "moveSpeedFixed",
    "attackRangeFixed",
    "attackCooldownTicks",
    "radiusFixed",
  ] as const) {
    if (!isNonNegInt(v[field])) {
      errors.push(`${field}: must be a non-negative integer`);
    }
  }
  if (!isObj(v["defenses"])) {
    errors.push("defenses: required object");
  } else {
    const def = v["defenses"] as Record<string, unknown>;
    if (
      typeof def["fireResPct"] !== "number" ||
      !Number.isInteger(def["fireResPct"]) ||
      def["fireResPct"] < 0
    ) {
      errors.push("defenses.fireResPct: must be a non-negative integer");
    }
    if (typeof def["armourFixed"] !== "number") {
      errors.push("defenses.armourFixed: required number");
    }
  }
  validateDamageSpec(v["attackDamage"], "attackDamage", errors);
  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 6: Run test (expected PASS)**

```bash
npx vitest run packages/content-schema/src/schema.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/content-schema && git commit -m "feat(content-schema): add data types, validators, and ID_PATTERN"
```

---

### Task 4: `@pact/rules` — StatBlock + baseCasterStats

**Files:**
- Create: `packages/rules/package.json`
- Create: `packages/rules/tsconfig.json`
- Create: `packages/rules/src/index.ts`
- Create: `packages/rules/src/stats.ts`
- Create: `packages/rules/src/stats.test.ts`

**Interfaces:**
- Consumes: `@pact/fixed-point` (`fp`, `Fixed`), `@pact/content-schema` (type imports for `Defenses`).
- Produces: `StatBlock`, `RES_CAP = 75`, `ARMOUR_K = fp(10)`, `baseCasterStats(): StatBlock`.

---

- [ ] **Step 1: Write failing test**

`packages/rules/src/stats.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { StatBlock, baseCasterStats, RES_CAP, ARMOUR_K } from "./stats.js";

describe("constants", () => {
  it("RES_CAP === 75", () => {
    expect(RES_CAP).toBe(75);
  });

  it("ARMOUR_K === fp(10) === 10000", () => {
    expect(ARMOUR_K).toBe(10000);
    expect(ARMOUR_K).toBe(fp(10));
  });
});

describe("baseCasterStats", () => {
  it("returns exact contract values", () => {
    const s: StatBlock = baseCasterStats();
    expect(s.maxLifeFixed).toBe(fp(100));        // 100000
    expect(s.maxManaFixed).toBe(fp(60));          // 60000
    expect(s.manaRegenPerSecFixed).toBe(fp(6));   // 6000
    expect(s.moveSpeedFixed).toBe(fp(3.5));       // 3500
    expect(s.fireResPct).toBe(0);
    expect(s.armourFixed).toBe(fp(0));            // 0
  });

  it("returns a fresh object each call (no shared reference)", () => {
    const a = baseCasterStats();
    const b = baseCasterStats();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test (expected FAIL)**

```bash
npx vitest run packages/rules/src/stats.test.ts
```

Expected FAIL: `Cannot find module './stats.js'` — package does not exist yet.

---

- [ ] **Step 3: Create `packages/rules/package.json`**

```json
{
  "name": "@pact/rules",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@pact/fixed-point": "*",
    "@pact/content-schema": "*"
  }
}
```

- [ ] **Step 4: Create `packages/rules/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 5: Implement `packages/rules/src/stats.ts`**

```ts
import { fp, type Fixed } from "@pact/fixed-point";

export interface StatBlock {
  maxLifeFixed: Fixed;
  maxManaFixed: Fixed;
  manaRegenPerSecFixed: Fixed;
  moveSpeedFixed: Fixed;   // units per second; systems derive per-tick
  fireResPct: number;      // integer 0..100, capped at RES_CAP on use
  armourFixed: Fixed;
}

export const RES_CAP = 75;
export const ARMOUR_K: Fixed = fp(10); // = 10000; armour == K halves a physical hit

export function baseCasterStats(): StatBlock {
  return {
    maxLifeFixed: fp(100),
    maxManaFixed: fp(60),
    manaRegenPerSecFixed: fp(6),
    moveSpeedFixed: fp(3.5),
    fireResPct: 0,
    armourFixed: fp(0),
  };
}
```

- [ ] **Step 6: Create `packages/rules/src/index.ts`**

```ts
export * from "./stats.js";
```

- [ ] **Step 7: Run test (expected PASS)**

```bash
npx vitest run packages/rules/src/stats.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add packages/rules && git commit -m "feat(rules): add StatBlock, RES_CAP, ARMOUR_K, and baseCasterStats"
```

---

### Task 5: `@pact/rules` — damage pipeline

**Files:**
- Create: `packages/rules/src/damage.ts`
- Create: `packages/rules/src/damage.test.ts`
- Edit: `packages/rules/src/index.ts` (add `export * from "./damage.js"`)

**Interfaces:**
- Consumes: `@pact/content-schema` (`DamageSpec`, `Defenses`), `./stats.js` (`RES_CAP`, `ARMOUR_K`).
- Produces: `applyDamage(pkt: DamageSpec, def: Defenses): Fixed`.

---

- [ ] **Step 1: Write failing test**

`packages/rules/src/damage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import type { DamageSpec, Defenses } from "@pact/content-schema";
import { applyDamage } from "./damage.js";
import { ARMOUR_K } from "./stats.js";

// helpers
const firePkt = (amount: number): DamageSpec => ({ type: "fire", amountFixed: fp(amount) });
const physPkt = (amount: number): DamageSpec => ({ type: "physical", amountFixed: fp(amount) });
const fireDefenses = (res: number): Defenses => ({ fireResPct: res, armourFixed: 0 });
const physDefenses = (armour: number): Defenses => ({ fireResPct: 0, armourFixed: fp(armour) });

describe("applyDamage — fire", () => {
  it("0 res: result === amountFixed", () => {
    const amt = fp(100);
    expect(applyDamage(firePkt(100), fireDefenses(0))).toBe(amt);
  });

  it("50 res: result === trunc(amountFixed / 2)", () => {
    const amt = fp(100);
    expect(applyDamage(firePkt(100), fireDefenses(50))).toBe(Math.trunc(amt / 2));
  });

  it("90 res: capped at RES_CAP=75, result === trunc(amountFixed * 25 / 100)", () => {
    const amt = fp(100);
    const expected = Math.trunc(amt * 25 / 100);
    expect(applyDamage(firePkt(100), fireDefenses(90))).toBe(expected);
  });

  it("result never negative (extreme res)", () => {
    expect(applyDamage(firePkt(1), fireDefenses(100))).toBeGreaterThanOrEqual(0);
  });
});

describe("applyDamage — physical", () => {
  it("armour 0: result === amountFixed", () => {
    const amt = fp(100);
    expect(applyDamage(physPkt(100), physDefenses(0))).toBe(amt);
  });

  it("armour === ARMOUR_K: result === trunc(amountFixed / 2)", () => {
    const amt = fp(100);
    // armourFixed = 10000 = ARMOUR_K; expected = trunc(100000 * 10000 / 20000) = trunc(50000) = 50000
    const def: Defenses = { fireResPct: 0, armourFixed: ARMOUR_K };
    expect(applyDamage(physPkt(100), def)).toBe(Math.trunc(amt / 2));
  });

  it("armour fp(0.5) = 500: small reduction (< amt and > amt*0.9)", () => {
    const amt = fp(100);
    const def: Defenses = { fireResPct: 0, armourFixed: fp(0.5) };
    const result = applyDamage(physPkt(100), def);
    // trunc(100000 * 10000 / (500 + 10000)) = trunc(1000000000 / 10500) = trunc(95238.09...) = 95238
    expect(result).toBeLessThan(amt);
    expect(result).toBeGreaterThan(Math.trunc(amt * 0.9));
  });

  it("identical inputs produce identical output (determinism)", () => {
    const pkt = physPkt(50);
    const def: Defenses = { fireResPct: 0, armourFixed: fp(5) };
    expect(applyDamage(pkt, def)).toBe(applyDamage(pkt, def));
  });

  it("result never negative", () => {
    expect(applyDamage(physPkt(0), physDefenses(1000))).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test (expected FAIL)**

```bash
npx vitest run packages/rules/src/damage.test.ts
```

Expected FAIL: `Cannot find module './damage.js'`.

---

- [ ] **Step 3: Implement `packages/rules/src/damage.ts`**

```ts
import type { Fixed } from "@pact/fixed-point";
import type { DamageSpec, Defenses } from "@pact/content-schema";
import { RES_CAP, ARMOUR_K } from "./stats.js";

/**
 * Final damage after one resistance/mitigation channel. Deterministic integer
 * math. Never returns a negative value.
 *   fire:     trunc(raw * (100 - min(res, RES_CAP)) / 100)
 *   physical: trunc(raw * ARMOUR_K / (armourFixed + ARMOUR_K))
 */
export function applyDamage(pkt: DamageSpec, def: Defenses): Fixed {
  let result: number;
  if (pkt.type === "fire") {
    const res = Math.min(def.fireResPct, RES_CAP);
    result = Math.trunc(pkt.amountFixed * (100 - res) / 100);
  } else {
    result = Math.trunc(pkt.amountFixed * ARMOUR_K / (def.armourFixed + ARMOUR_K));
  }
  return result < 0 ? 0 : result;
}
```

- [ ] **Step 4: Add export to `packages/rules/src/index.ts`**

```ts
export * from "./stats.js";
export * from "./damage.js";
```

- [ ] **Step 5: Run test (expected PASS)**

```bash
npx vitest run packages/rules/src/damage.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/rules/src/damage.ts packages/rules/src/damage.test.ts packages/rules/src/index.ts && git commit -m "feat(rules): add applyDamage — fire and physical channels"
```

---

### Task 6: `@pact/rules` — ailments + rare modifier

**Files:**
- Create: `packages/rules/src/ailment.ts`
- Create: `packages/rules/src/ailment.test.ts`
- Create: `packages/rules/src/rare.ts`
- Create: `packages/rules/src/rare.test.ts`
- Edit: `packages/rules/src/index.ts` (add ailment + rare exports)

**Interfaces:**
- Consumes: `@pact/fixed-point` (`Fixed`), `@pact/content-schema` (`MonsterDef`, `RareModifier`).
- Produces: `AilmentState`, `AILMENT_TICK_INTERVAL`, `refreshBurning(...)`, `burningTickDamage(a)`, `makeRare(def, mods)`.

---

- [ ] **Step 1: Write failing ailment test**

`packages/rules/src/ailment.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { AILMENT_TICK_INTERVAL, refreshBurning, burningTickDamage, type AilmentState } from "./ailment.js";

describe("AILMENT_TICK_INTERVAL", () => {
  it("=== 6", () => {
    expect(AILMENT_TICK_INTERVAL).toBe(6);
  });
});

describe("refreshBurning", () => {
  it("from undefined: stacks === addStacks, expiryTick === nowTick + durationTicks", () => {
    const result = refreshBurning(undefined, 2, fp(8), 10, 60, 5);
    expect(result.kind).toBe("burning");
    expect(result.stacks).toBe(2);
    expect(result.dpsFixed).toBe(fp(8));
    expect(result.expiryTick).toBe(70); // 10 + 60
  });

  it("caps stacks at maxStacks", () => {
    const result = refreshBurning(undefined, 10, fp(8), 0, 60, 5);
    expect(result.stacks).toBe(5);
  });

  it("accumulates stacks on second refresh", () => {
    const first = refreshBurning(undefined, 3, fp(8), 0, 60, 5);
    const second = refreshBurning(first, 2, fp(8), 30, 60, 5);
    expect(second.stacks).toBe(5); // 3 + 2 = 5, below cap
    expect(second.expiryTick).toBe(90); // 30 + 60
  });

  it("second refresh updates expiryTick and caps stacks", () => {
    const first = refreshBurning(undefined, 4, fp(8), 0, 60, 5);
    const second = refreshBurning(first, 3, fp(8), 50, 60, 5); // 4 + 3 = 7, capped at 5
    expect(second.stacks).toBe(5);
    expect(second.expiryTick).toBe(110); // 50 + 60
  });

  it("does not mutate prev AilmentState", () => {
    const prev: AilmentState = { kind: "burning", stacks: 2, dpsFixed: fp(8), expiryTick: 60 };
    const prevStacks = prev.stacks;
    refreshBurning(prev, 1, fp(8), 0, 60, 5);
    expect(prev.stacks).toBe(prevStacks);
  });
});

describe("burningTickDamage", () => {
  it("stacks=3, dps=fp(8): trunc(3 * 8000 * 6 / 30) === 4800", () => {
    const a: AilmentState = { kind: "burning", stacks: 3, dpsFixed: fp(8), expiryTick: 999 };
    // 3 * 8000 * 6 / 30 = 144000 / 30 = 4800
    expect(burningTickDamage(a)).toBe(4800);
  });

  it("stacks=1, dps=fp(30): trunc(1 * 30000 * 6 / 30) === 6000", () => {
    const a: AilmentState = { kind: "burning", stacks: 1, dpsFixed: fp(30), expiryTick: 999 };
    expect(burningTickDamage(a)).toBe(6000);
  });
});
```

- [ ] **Step 2: Write failing rare test**

`packages/rules/src/rare.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import type { MonsterDef, RareModifier } from "@pact/content-schema";
import { makeRare } from "./rare.js";

const cinderImp: MonsterDef = {
  id: "monster.cinder_imp.v1",
  name: "Cinder Imp",
  maxLifeFixed: fp(40),        // 40000
  moveSpeedFixed: fp(2.4),     // 2400
  attackRangeFixed: fp(1.2),   // 1200
  attackDamage: { type: "physical", amountFixed: fp(6) }, // 6000
  attackCooldownTicks: 45,
  radiusFixed: fp(0.5),        // 500
  defenses: { fireResPct: 0, armourFixed: fp(0.5) }, // armour 500
};

const RARE_TEMPLATE: RareModifier = {
  lifeMulPct: 250,
  moveSpeedMulPct: 120,
  damageMulPct: 150,
  addedFireResPct: 30,
};

describe("makeRare", () => {
  it("applies life multiplier: trunc(40000 * 250 / 100) === 100000", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.maxLifeFixed).toBe(100000);
  });

  it("applies moveSpeed multiplier: trunc(2400 * 120 / 100) === 2880", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.moveSpeedFixed).toBe(2880);
  });

  it("applies damage multiplier: trunc(6000 * 150 / 100) === 9000", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.attackDamage.amountFixed).toBe(9000);
  });

  it("adds fire res: 0 + 30 === 30", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.defenses.fireResPct).toBe(30);
  });

  it("preserves id and name unchanged", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.id).toBe(cinderImp.id);
    expect(rare.name).toBe(cinderImp.name);
  });

  it("preserves attackDamage.type unchanged", () => {
    const rare = makeRare(cinderImp, RARE_TEMPLATE);
    expect(rare.attackDamage.type).toBe("physical");
  });

  it("does not mutate original def", () => {
    const originalLife = cinderImp.maxLifeFixed;
    const originalFireRes = cinderImp.defenses.fireResPct;
    makeRare(cinderImp, RARE_TEMPLATE);
    expect(cinderImp.maxLifeFixed).toBe(originalLife);
    expect(cinderImp.defenses.fireResPct).toBe(originalFireRes);
  });

  it("returns a new object (not same reference)", () => {
    expect(makeRare(cinderImp, RARE_TEMPLATE)).not.toBe(cinderImp);
  });
});
```

- [ ] **Step 3: Run tests (expected FAIL)**

```bash
npx vitest run packages/rules/src/ailment.test.ts packages/rules/src/rare.test.ts
```

Expected FAIL: `Cannot find module './ailment.js'` and `Cannot find module './rare.js'`.

---

- [ ] **Step 4: Implement `packages/rules/src/ailment.ts`**

```ts
import type { Fixed } from "@pact/fixed-point";

export interface AilmentState {
  kind: "burning";
  stacks: number;
  dpsFixed: Fixed;
  expiryTick: number;
}

/** Ticks between DoT applications (5 applications per second at 30 Hz). */
export const AILMENT_TICK_INTERVAL = 6;

/**
 * Add one burning application. Stacks are capped at maxStacks and expiry
 * is always refreshed to nowTick + durationTicks. Returns a NEW object.
 */
export function refreshBurning(
  prev: AilmentState | undefined,
  addStacks: number,
  dpsFixed: Fixed,
  nowTick: number,
  durationTicks: number,
  maxStacks: number,
): AilmentState {
  const stacks = Math.min((prev?.stacks ?? 0) + addStacks, maxStacks);
  return { kind: "burning", stacks, dpsFixed, expiryTick: nowTick + durationTicks };
}

/**
 * Damage dealt by one DoT tick (every AILMENT_TICK_INTERVAL ticks).
 * = trunc(stacks * dpsFixed * AILMENT_TICK_INTERVAL / 30)
 */
export function burningTickDamage(a: AilmentState): Fixed {
  return Math.trunc(a.stacks * a.dpsFixed * AILMENT_TICK_INTERVAL / 30);
}
```

- [ ] **Step 5: Implement `packages/rules/src/rare.ts`**

```ts
import type { MonsterDef, RareModifier } from "@pact/content-schema";

/**
 * Apply rare-tier multipliers to a normal MonsterDef. Returns a new object;
 * never mutates the original.
 */
export function makeRare(def: MonsterDef, mods: RareModifier): MonsterDef {
  return {
    ...def,
    maxLifeFixed: Math.trunc(def.maxLifeFixed * mods.lifeMulPct / 100),
    moveSpeedFixed: Math.trunc(def.moveSpeedFixed * mods.moveSpeedMulPct / 100),
    attackDamage: {
      ...def.attackDamage,
      amountFixed: Math.trunc(def.attackDamage.amountFixed * mods.damageMulPct / 100),
    },
    defenses: {
      ...def.defenses,
      fireResPct: def.defenses.fireResPct + mods.addedFireResPct,
    },
  };
}
```

- [ ] **Step 6: Update `packages/rules/src/index.ts`**

```ts
export * from "./stats.js";
export * from "./damage.js";
export * from "./ailment.js";
export * from "./rare.js";
```

- [ ] **Step 7: Run tests (expected PASS)**

```bash
npx vitest run packages/rules/src/ailment.test.ts packages/rules/src/rare.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add packages/rules/src/ailment.ts packages/rules/src/ailment.test.ts packages/rules/src/rare.ts packages/rules/src/rare.test.ts packages/rules/src/index.ts && git commit -m "feat(rules): add ailment refreshBurning, burningTickDamage, and makeRare"
```

---

### Task 7: `@pact/content-runtime` — authored slice content

**Files:**
- Create: `packages/content-runtime/package.json`
- Create: `packages/content-runtime/tsconfig.json`
- Create: `packages/content-runtime/src/skills.ts`
- Create: `packages/content-runtime/src/monsters.ts`
- Create: `packages/content-runtime/src/index.ts`
- Create: `packages/content-runtime/src/content.test.ts`

**Interfaces:**
- Consumes: `@pact/fixed-point` (`fp`), `@pact/content-schema` (`SkillDef`, `MonsterDef`, `RareModifier`, `validateSkillDef`, `validateMonsterDef`, `ID_PATTERN`).
- Produces: `CONTENT_VERSION`, `SKILLS: ReadonlyMap<string, SkillDef>`, `MONSTERS: ReadonlyMap<string, MonsterDef>`, `RARE_TEMPLATE: RareModifier`.

---

- [ ] **Step 1: Write failing test**

`packages/content-runtime/src/content.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { validateSkillDef, validateMonsterDef, ID_PATTERN } from "@pact/content-schema";
import { CONTENT_VERSION, SKILLS, MONSTERS, RARE_TEMPLATE } from "./index.js";

describe("CONTENT_VERSION", () => {
  it('=== "slice1.v1"', () => {
    expect(CONTENT_VERSION).toBe("slice1.v1");
  });
});

describe("RARE_TEMPLATE", () => {
  it("has exact contract values", () => {
    expect(RARE_TEMPLATE).toEqual({
      lifeMulPct: 250,
      moveSpeedMulPct: 120,
      damageMulPct: 150,
      addedFireResPct: 30,
    });
  });
});

describe("SKILLS", () => {
  it("every entry passes validateSkillDef", () => {
    for (const [id, def] of SKILLS) {
      const r = validateSkillDef(def);
      expect(r.ok, `${id}: ${r.errors.join(", ")}`).toBe(true);
    }
  });

  it("every id matches ID_PATTERN", () => {
    for (const id of SKILLS.keys()) {
      expect(ID_PATTERN.test(id), `"${id}" should match ID_PATTERN`).toBe(true);
    }
  });

  it("contains the 3 authored skills", () => {
    expect(SKILLS.has("skill.ember_bolt.v1")).toBe(true);
    expect(SKILLS.has("skill.cinder_ground.v1")).toBe(true);
    expect(SKILLS.has("skill.blink.v1")).toBe(true);
  });

  it("ember_bolt has a spawnProjectile effect with damage.amountFixed === fp(25)", () => {
    const def = SKILLS.get("skill.ember_bolt.v1")!;
    const effect = def.effects.find((e) => e.type === "spawnProjectile");
    expect(effect).toBeDefined();
    if (effect?.type === "spawnProjectile") {
      expect(effect.damage.amountFixed).toBe(fp(25));       // 25000
      expect(effect.maxRangeFixed).toBe(fp(20));             // 20000
    }
  });

  it("ember_bolt manaCostFixed === fp(8) and cooldownTicks === 6", () => {
    const def = SKILLS.get("skill.ember_bolt.v1")!;
    expect(def.manaCostFixed).toBe(fp(8));
    expect(def.cooldownTicks).toBe(6);
  });

  it("cinder_ground has a spawnGroundArea effect with burning ailment maxStacks=5 dpsFixed=fp(8)", () => {
    const def = SKILLS.get("skill.cinder_ground.v1")!;
    const effect = def.effects.find((e) => e.type === "spawnGroundArea");
    expect(effect).toBeDefined();
    if (effect?.type === "spawnGroundArea") {
      expect(effect.ailment.kind).toBe("burning");
      expect(effect.ailment.maxStacks).toBe(5);
      expect(effect.ailment.dpsFixed).toBe(fp(8));           // 8000
    }
  });

  it("blink has a teleport effect with distanceFixed === fp(5)", () => {
    const def = SKILLS.get("skill.blink.v1")!;
    const effect = def.effects.find((e) => e.type === "teleport");
    expect(effect).toBeDefined();
    if (effect?.type === "teleport") {
      expect(effect.distanceFixed).toBe(fp(5));              // 5000
    }
  });
});

describe("MONSTERS", () => {
  it("every entry passes validateMonsterDef", () => {
    for (const [id, def] of MONSTERS) {
      const r = validateMonsterDef(def);
      expect(r.ok, `${id}: ${r.errors.join(", ")}`).toBe(true);
    }
  });

  it("every id matches ID_PATTERN", () => {
    for (const id of MONSTERS.keys()) {
      expect(ID_PATTERN.test(id), `"${id}" should match ID_PATTERN`).toBe(true);
    }
  });

  it("contains the authored monster", () => {
    expect(MONSTERS.has("monster.cinder_imp.v1")).toBe(true);
  });

  it("cinder_imp maxLifeFixed === fp(40)", () => {
    const def = MONSTERS.get("monster.cinder_imp.v1")!;
    expect(def.maxLifeFixed).toBe(fp(40));                   // 40000
  });

  it("cinder_imp moveSpeedFixed === fp(2.4)", () => {
    const def = MONSTERS.get("monster.cinder_imp.v1")!;
    expect(def.moveSpeedFixed).toBe(fp(2.4));                // 2400
  });

  it("cinder_imp attackDamage is physical fp(6)", () => {
    const def = MONSTERS.get("monster.cinder_imp.v1")!;
    expect(def.attackDamage.type).toBe("physical");
    expect(def.attackDamage.amountFixed).toBe(fp(6));        // 6000
  });

  it("cinder_imp defenses.fireResPct === 0 and armourFixed === fp(0.5)", () => {
    const def = MONSTERS.get("monster.cinder_imp.v1")!;
    expect(def.defenses.fireResPct).toBe(0);
    expect(def.defenses.armourFixed).toBe(fp(0.5));          // 500
  });
});
```

- [ ] **Step 2: Run test (expected FAIL)**

```bash
npx vitest run packages/content-runtime/src/content.test.ts
```

Expected FAIL: `Cannot find module './index.js'` — package does not exist yet.

---

- [ ] **Step 3: Create `packages/content-runtime/package.json`**

```json
{
  "name": "@pact/content-runtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@pact/fixed-point": "*",
    "@pact/content-schema": "*"
  }
}
```

- [ ] **Step 4: Create `packages/content-runtime/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 5: Implement `packages/content-runtime/src/skills.ts`**

```ts
import { fp } from "@pact/fixed-point";
import { validateSkillDef, type SkillDef } from "@pact/content-schema";

const SKILL_DEFS: SkillDef[] = [
  {
    id: "skill.ember_bolt.v1",
    name: "Ember Bolt",
    manaCostFixed: fp(8),
    cooldownTicks: 6,
    effects: [
      {
        type: "spawnProjectile",
        speedPerSecFixed: fp(12),
        radiusFixed: fp(0.4),
        maxRangeFixed: fp(20),
        damage: { type: "fire", amountFixed: fp(25) },
      },
    ],
  },
  {
    id: "skill.cinder_ground.v1",
    name: "Cinder Ground",
    manaCostFixed: fp(20),
    cooldownTicks: 30,
    effects: [
      {
        type: "spawnGroundArea",
        radiusFixed: fp(2.5),
        durationTicks: 90,
        ailment: {
          kind: "burning",
          stacksPerApply: 1,
          dpsFixed: fp(8),
          durationTicks: 60,
          maxStacks: 5,
        },
      },
    ],
  },
  {
    id: "skill.blink.v1",
    name: "Blink",
    manaCostFixed: fp(15),
    cooldownTicks: 90,
    effects: [{ type: "teleport", distanceFixed: fp(5) }],
  },
];

// Validate at module load — bad content is a programmer error, fail fast.
for (const def of SKILL_DEFS) {
  const r = validateSkillDef(def);
  if (!r.ok) {
    throw new Error(`[content-runtime] Invalid skill def "${def.id}": ${r.errors.join("; ")}`);
  }
}

export const SKILLS: ReadonlyMap<string, SkillDef> = new Map(
  SKILL_DEFS.map((d) => [d.id, d]),
);
```

- [ ] **Step 6: Implement `packages/content-runtime/src/monsters.ts`**

```ts
import { fp } from "@pact/fixed-point";
import { validateMonsterDef, type MonsterDef, type RareModifier } from "@pact/content-schema";

const MONSTER_DEFS: MonsterDef[] = [
  {
    id: "monster.cinder_imp.v1",
    name: "Cinder Imp",
    maxLifeFixed: fp(40),
    moveSpeedFixed: fp(2.4),
    attackRangeFixed: fp(1.2),
    attackDamage: { type: "physical", amountFixed: fp(6) },
    attackCooldownTicks: 45,
    radiusFixed: fp(0.5),
    defenses: { fireResPct: 0, armourFixed: fp(0.5) },
  },
];

// Validate at module load — bad content is a programmer error, fail fast.
for (const def of MONSTER_DEFS) {
  const r = validateMonsterDef(def);
  if (!r.ok) {
    throw new Error(
      `[content-runtime] Invalid monster def "${def.id}": ${r.errors.join("; ")}`,
    );
  }
}

export const MONSTERS: ReadonlyMap<string, MonsterDef> = new Map(
  MONSTER_DEFS.map((d) => [d.id, d]),
);

export const RARE_TEMPLATE: RareModifier = {
  lifeMulPct: 250,
  moveSpeedMulPct: 120,
  damageMulPct: 150,
  addedFireResPct: 30,
};
```

- [ ] **Step 7: Implement `packages/content-runtime/src/index.ts`**

```ts
export const CONTENT_VERSION = "slice1.v1";
export { SKILLS } from "./skills.js";
export { MONSTERS, RARE_TEMPLATE } from "./monsters.js";
```

- [ ] **Step 8: Run test (expected PASS)**

```bash
npx vitest run packages/content-runtime/src/content.test.ts
```

- [ ] **Step 9: Commit**

```bash
git add packages/content-runtime && git commit -m "feat(content-runtime): author slice1 skills, monsters, and rare template"
```

### Task 8: combat components + damage queue on `Simulation`

**Files:**
- Modify: `packages/simulation/src/loop.ts`
- Create: `packages/simulation/src/components.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/src/damage-queue.test.ts`

**Interfaces:**
- Consumes: `World`, `Entity` from `./ecs`; `Fixed` from `@pact/fixed-point`
- Produces: `DamageEvent`, `Position`, `Health`, `Mana`, `Faction`, `PlayerC`, `MoveTarget`, `MoveDir`, `Cooldowns`, `MonsterC`, `DefensesC`, `ProjectileC`, `GroundAreaC`, `AilmentC` (exported from `src/index.ts`); `sim.damageQueue: DamageEvent[]`; `sim.enqueueDamage(e: DamageEvent): void`; `Command.skillId?: string`

- [ ] **Step 1: Write failing test `packages/simulation/src/damage-queue.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { Simulation } from "./loop";
import type { DamageEvent } from "./components";

describe("damage queue", () => {
  it("enqueueDamage pushes to damageQueue", () => {
    const sim = new Simulation();
    const evt: DamageEvent = { target: 1, source: 2, amountFixed: fp(10), type: 0 };
    sim.enqueueDamage(evt);
    expect(sim.damageQueue).toHaveLength(1);
    expect(sim.damageQueue[0]).toEqual(evt);
  });

  it("queue is cleared at the start of each step", () => {
    const sim = new Simulation();
    sim.enqueueDamage({ target: 1, source: 2, amountFixed: fp(5), type: 1 });
    expect(sim.damageQueue).toHaveLength(1);
    sim.step();
    // no system re-enqueued, so queue is empty after step
    expect(sim.damageQueue).toHaveLength(0);
  });

  it("a system enqueuing during its tick survives until the next step clears it", () => {
    const sim = new Simulation();
    const e = sim.world.create();
    sim.register("enqueuer", () => {
      sim.enqueueDamage({ target: e, source: e, amountFixed: fp(3), type: 0 });
    });
    sim.step(); // clears (empty), then system pushes one event
    expect(sim.damageQueue).toHaveLength(1);
    sim.step(); // clears that one, system pushes again
    expect(sim.damageQueue).toHaveLength(1);
  });

  it("DamageEvent stores exact fields", () => {
    const sim = new Simulation();
    const evt: DamageEvent = { target: 42, source: 7, amountFixed: fp(100), type: 1 };
    sim.enqueueDamage(evt);
    const stored = sim.damageQueue[0]!;
    expect(stored.target).toBe(42);
    expect(stored.source).toBe(7);
    expect(stored.amountFixed).toBe(fp(100));
    expect(stored.type).toBe(1);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```
npx vitest run packages/simulation/src/damage-queue.test.ts
```

Expected: type errors — `DamageEvent` and `enqueueDamage` do not exist yet.

- [ ] **Step 3: Create `packages/simulation/src/components.ts`**

```ts
import type { Entity } from "./ecs";
import type { Fixed } from "@pact/fixed-point";

export interface Position   { x: Fixed; y: Fixed }
export interface Health     { life: Fixed; maxLife: Fixed }
/** regen is per-tick Fixed; derived from perSec via Math.trunc(perSecFixed / 30) */
export interface Mana       { mana: Fixed; maxMana: Fixed; regen: Fixed }
export interface Faction    { team: number }
/** moveSpeed is per-tick Fixed; bodyRadius in Fixed units */
export interface PlayerC    { moveSpeed: Fixed; bodyRadius: Fixed }
export interface MoveTarget { x: Fixed; y: Fixed; active: 0 | 1 }
/** dx/dy are each -1 | 0 | 1 (WASD direction) */
export interface MoveDir    { dx: number; dy: number }
/** keys are skillId strings; values are the tick at which the skill becomes ready */
export interface Cooldowns  { [skillId: string]: number }
export interface MonsterC {
  defId: string;
  moveSpeed: Fixed;
  bodyRadius: Fixed;
  attackRange: Fixed;
  attackCooldownTicks: number;
  /** amountFixed of the attack damage */
  attackDamage: Fixed;
  /** 0 = fire, 1 = physical */
  attackType: 0 | 1;
  attackReadyTick: number;
  state: "idle" | "chase" | "attack";
  /** 1 = rare, 0 = normal */
  rare: 0 | 1;
}
export interface DefensesC  { fireResPct: number; armour: Fixed }
export interface ProjectileC {
  dirx: Fixed;
  diry: Fixed;
  remainingRange: Fixed;
  radius: Fixed;
  /** 0 = fire, 1 = physical */
  damageType: 0 | 1;
  damageAmount: Fixed;
  ownerId: Entity;
  team: number;
}
export interface GroundAreaC {
  radius: Fixed;
  expiryTick: number;
  nextTick: number;
  ailmentKind: string;
  stacksPerApply: number;
  dps: Fixed;
  ailmentDuration: number;
  maxStacks: number;
}
export interface AilmentC {
  kind: string;
  stacks: number;
  dps: Fixed;
  expiryTick: number;
}
export interface DamageEvent {
  target: Entity;
  source: Entity;
  amountFixed: Fixed;
  /** 0 = fire, 1 = physical */
  type: 0 | 1;
}
```

- [ ] **Step 4: Modify `packages/simulation/src/loop.ts`** — add `skillId` to `Command`, `damageQueue`, `enqueueDamage`, and clear at start of `step`

```ts
import { World, type Entity } from "./ecs";
import type { DamageEvent } from "./components";

export interface Command {
  tick: number;
  entity?: Entity;
  type: string;
  /** Set when type === "useSkill" */
  skillId?: string;
  data?: Record<string, number>;
}

export type System = (
  world: World,
  tick: number,
  commands: readonly Command[],
) => void;

// Fixed-step authoritative loop. System execution order equals registration
// order and is inspectable via systemOrder(). Changing the order is a
// simulation migration (see spec §3).
export class Simulation {
  readonly world = new World();
  tick = 0;
  /** Per-tick damage queue. Cleared at the start of each step; drained by damageResolve. */
  damageQueue: DamageEvent[] = [];
  private readonly systems: { name: string; fn: System }[] = [];

  register(name: string, fn: System): void {
    this.systems.push({ name, fn });
  }

  systemOrder(): string[] {
    return this.systems.map((s) => s.name);
  }

  enqueueDamage(e: DamageEvent): void {
    this.damageQueue.push(e);
  }

  step(commands: readonly Command[] = []): void {
    this.damageQueue = [];
    for (const s of this.systems) s.fn(this.world, this.tick, commands);
    this.tick++;
  }
}
```

- [ ] **Step 5: Modify `packages/simulation/src/index.ts`** — re-export component types

```ts
export { createStream, fnv1a32 } from "./rng";
export type { RandomStream } from "./rng";
export { World } from "./ecs";
export type { Entity } from "./ecs";
export { serializeWorld, checksumWorld } from "./checksum";
export { Simulation } from "./loop";
export type { Command, System } from "./loop";
export { WORLD_MIN, WORLD_MAX, registerMovement } from "./movement";
export type {
  Position, Health, Mana, Faction, PlayerC, MoveTarget, MoveDir,
  Cooldowns, MonsterC, DefensesC, ProjectileC, GroundAreaC, AilmentC,
  DamageEvent,
} from "./components";
```

- [ ] **Step 6: Run test — expect pass**

```
npx vitest run packages/simulation/src/damage-queue.test.ts
```

- [ ] **Step 7: Commit**

```
feat(simulation): add combat components and damage queue
```

---

### Task 9: `registerResourceRegen` + `registerPlayerMovement`

**Files:**
- Create: `packages/simulation/src/systems/resource.ts`
- Create: `packages/simulation/src/systems/player-movement.ts`
- Create: `packages/simulation/src/systems/resource.test.ts`
- Create: `packages/simulation/src/systems/player-movement.test.ts`
- Modify: `packages/simulation/src/index.ts`

**Interfaces:**
- Consumes: `Simulation`, `Command`, `World`, `Entity`; `fp`, `fpClamp`, `fpStepToward` from `@pact/fixed-point`; `Mana`, `PlayerC`, `MoveTarget`, `MoveDir`, `Position` from `./components`; `WORLD_MIN`, `WORLD_MAX` from `./movement`
- Produces: `registerResourceRegen(sim)`, `registerPlayerMovement(sim)` exported from `src/index.ts`

- [ ] **Step 1: Write failing test `packages/simulation/src/systems/resource.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { Simulation } from "../loop";
import { registerResourceRegen } from "./resource";
import type { Mana } from "../components";

describe("registerResourceRegen", () => {
  function makeSimWithMana(mana: number, maxMana: number, regen: number): {
    sim: Simulation; entity: number;
  } {
    const sim = new Simulation();
    registerResourceRegen(sim);
    const e = sim.world.create();
    sim.world.set<Mana>(e, "mana", { mana, maxMana, regen });
    return { sim, entity: e };
  }

  it("adds regen to mana each tick", () => {
    const { sim, entity } = makeSimWithMana(fp(50), fp(60), fp(1));
    sim.step();
    const m = sim.world.get<Mana>(entity, "mana")!;
    expect(m.mana).toBe(fp(51));
  });

  it("clamps mana to maxMana", () => {
    const { sim, entity } = makeSimWithMana(fp(59), fp(60), fp(5));
    sim.step();
    const m = sim.world.get<Mana>(entity, "mana")!;
    expect(m.mana).toBe(fp(60));
  });

  it("does not affect entities without mana", () => {
    const sim = new Simulation();
    registerResourceRegen(sim);
    const e = sim.world.create();
    // no mana component
    sim.step();
    expect(sim.world.get(e, "mana")).toBeUndefined();
  });

  it("processes multiple mana entities in ascending id order", () => {
    const sim = new Simulation();
    registerResourceRegen(sim);
    const e1 = sim.world.create();
    const e2 = sim.world.create();
    sim.world.set<Mana>(e1, "mana", { mana: fp(10), maxMana: fp(20), regen: fp(2) });
    sim.world.set<Mana>(e2, "mana", { mana: fp(5), maxMana: fp(10), regen: fp(3) });
    sim.step();
    expect(sim.world.get<Mana>(e1, "mana")!.mana).toBe(fp(12));
    expect(sim.world.get<Mana>(e2, "mana")!.mana).toBe(fp(8));
  });
});
```

- [ ] **Step 2: Write failing test `packages/simulation/src/systems/player-movement.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fp, fpClamp } from "@pact/fixed-point";
import { Simulation } from "../loop";
import { registerPlayerMovement } from "./player-movement";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import type { Position, PlayerC, MoveTarget, MoveDir, Faction } from "../components";

function makePlayer(sim: Simulation, x = 0, y = 0, moveSpeed = fp(3)) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x, y });
  sim.world.set<PlayerC>(e, "player", { moveSpeed, bodyRadius: fp(0.5) });
  sim.world.set<Faction>(e, "faction", { team: 0 });
  return e;
}

describe("registerPlayerMovement", () => {
  it("moveTo command sets moveTarget and player moves toward it", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const p = makePlayer(sim, 0, 0, fp(3));
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: fp(10), y: 0 } }]);
    const pos = sim.world.get<Position>(p, "position")!;
    // player should have moved fp(3) in x direction
    expect(pos.x).toBe(fp(3));
    expect(pos.y).toBe(0);
    const mt = sim.world.get<MoveTarget>(p, "moveTarget")!;
    expect(mt.active).toBe(1);
  });

  it("snaps to target and deactivates moveTarget on arrival", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const speed = fp(3);
    const p = makePlayer(sim, 0, 0, speed);
    // set target to exactly fp(2) away — less than speed, should snap in one step
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: fp(2), y: 0 } }]);
    const pos = sim.world.get<Position>(p, "position")!;
    expect(pos.x).toBe(fp(2));
    expect(pos.y).toBe(0);
    const mt = sim.world.get<MoveTarget>(p, "moveTarget")!;
    expect(mt.active).toBe(0);
  });

  it("moveDir command moves one step per axis (cardinal)", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const speed = fp(3);
    const p = makePlayer(sim, 0, 0, speed);
    sim.step([{ tick: 0, entity: p, type: "moveDir", data: { dx: 1, dy: 0 } }]);
    const pos = sim.world.get<Position>(p, "position")!;
    expect(pos.x).toBe(speed); // 1 * speed
    expect(pos.y).toBe(0);
  });

  it("diagonal moveDir scales each axis by trunc(speed*707/1000)", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const speed = fp(3); // 3000
    const p = makePlayer(sim, 0, 0, speed);
    sim.step([{ tick: 0, entity: p, type: "moveDir", data: { dx: 1, dy: 1 } }]);
    const pos = sim.world.get<Position>(p, "position")!;
    const diagStep = Math.trunc(speed * 707 / 1000); // trunc(3000*707/1000) = trunc(2121) = 2121
    expect(pos.x).toBe(diagStep);
    expect(pos.y).toBe(diagStep);
  });

  it("stop command halts movement", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const p = makePlayer(sim, 0, 0, fp(3));
    // first give a moveTo, then stop
    sim.step([{ tick: 0, entity: p, type: "moveTo", data: { x: fp(50), y: 0 } }]);
    sim.step([{ tick: 1, entity: p, type: "stop" }]);
    const mt = sim.world.get<MoveTarget>(p, "moveTarget")!;
    const md = sim.world.get<MoveDir>(p, "moveDir")!;
    expect(mt.active).toBe(0);
    expect(md.dx).toBe(0);
    expect(md.dy).toBe(0);
    // position should not advance further after stop
    const posBefore = sim.world.get<Position>(p, "position")!.x;
    sim.step();
    const posAfter = sim.world.get<Position>(p, "position")!.x;
    expect(posAfter).toBe(posBefore);
  });

  it("clamps position to arena bounds", () => {
    const sim = new Simulation();
    registerPlayerMovement(sim);
    const p = makePlayer(sim, WORLD_MAX, 0, fp(10));
    // moveDir +x pushes past WORLD_MAX
    sim.step([{ tick: 0, entity: p, type: "moveDir", data: { dx: 1, dy: 0 } }]);
    const pos = sim.world.get<Position>(p, "position")!;
    expect(pos.x).toBe(WORLD_MAX);
  });
});
```

- [ ] **Step 3: Run tests — expect failure**

```
npx vitest run packages/simulation/src/systems/resource.test.ts packages/simulation/src/systems/player-movement.test.ts
```

Expected: module-not-found errors.

- [ ] **Step 4: Create `packages/simulation/src/systems/resource.ts`**

```ts
import { Simulation } from "../loop";
import type { Mana } from "../components";

export function registerResourceRegen(sim: Simulation): void {
  sim.register("resourceRegen", (world) => {
    for (const e of world.entitiesWith("mana")) {
      const m = world.get<Mana>(e, "mana")!;
      const next = Math.min(m.mana + m.regen, m.maxMana);
      world.set<Mana>(e, "mana", { mana: next, maxMana: m.maxMana, regen: m.regen });
    }
  });
}
```

- [ ] **Step 5: Create `packages/simulation/src/systems/player-movement.ts`**

```ts
import { fp, fpClamp, fpStepToward } from "@pact/fixed-point";
import { Simulation } from "../loop";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import type { Position, PlayerC, MoveTarget, MoveDir } from "../components";

export function registerPlayerMovement(sim: Simulation): void {
  sim.register("playerMovement", (world, _tick, commands) => {
    // 1. Apply commands to moveTarget / moveDir components.
    for (const cmd of commands) {
      if (cmd.entity === undefined) continue;
      if (!world.has(cmd.entity, "player")) continue;
      const e = cmd.entity;
      if (cmd.type === "moveTo") {
        const x = cmd.data?.["x"] ?? 0;
        const y = cmd.data?.["y"] ?? 0;
        world.set<MoveTarget>(e, "moveTarget", { x, y, active: 1 });
      } else if (cmd.type === "moveDir") {
        const dx = cmd.data?.["dx"] ?? 0;
        const dy = cmd.data?.["dy"] ?? 0;
        world.set<MoveDir>(e, "moveDir", { dx, dy });
      } else if (cmd.type === "stop") {
        const mt = world.get<MoveTarget>(e, "moveTarget");
        if (mt) world.set<MoveTarget>(e, "moveTarget", { x: mt.x, y: mt.y, active: 0 });
        world.set<MoveDir>(e, "moveDir", { dx: 0, dy: 0 });
      }
    }

    // 2. Integrate all player entities.
    for (const e of world.query("position", "player")) {
      const pos = world.get<Position>(e, "position")!;
      const player = world.get<PlayerC>(e, "player")!;
      const moveDir = world.get<MoveDir>(e, "moveDir");
      const moveTarget = world.get<MoveTarget>(e, "moveTarget");

      let nx = pos.x;
      let ny = pos.y;

      const dirActive = moveDir && (moveDir.dx !== 0 || moveDir.dy !== 0);
      if (dirActive && moveDir) {
        if (moveDir.dx !== 0 && moveDir.dy !== 0) {
          // ponytail: 707/1000 approximates 1/sqrt(2) in integer math
          const diagSpeed = Math.trunc(player.moveSpeed * 707 / 1000);
          nx += moveDir.dx * diagSpeed;
          ny += moveDir.dy * diagSpeed;
        } else {
          nx += moveDir.dx * player.moveSpeed;
          ny += moveDir.dy * player.moveSpeed;
        }
      } else if (moveTarget?.active === 1) {
        const step = fpStepToward(pos.x, pos.y, moveTarget.x, moveTarget.y, player.moveSpeed);
        nx += step.dx;
        ny += step.dy;
        // snap: if new position equals target, deactivate
        const cnx = fpClamp(nx, WORLD_MIN, WORLD_MAX);
        const cny = fpClamp(ny, WORLD_MIN, WORLD_MAX);
        if (cnx === moveTarget.x && cny === moveTarget.y) {
          world.set<MoveTarget>(e, "moveTarget", { x: moveTarget.x, y: moveTarget.y, active: 0 });
        }
      }

      world.set<Position>(e, "position", {
        x: fpClamp(nx, WORLD_MIN, WORLD_MAX),
        y: fpClamp(ny, WORLD_MIN, WORLD_MAX),
      });
    }
  });
}
```

- [ ] **Step 6: Modify `packages/simulation/src/index.ts`** — add exports

```ts
export { createStream, fnv1a32 } from "./rng";
export type { RandomStream } from "./rng";
export { World } from "./ecs";
export type { Entity } from "./ecs";
export { serializeWorld, checksumWorld } from "./checksum";
export { Simulation } from "./loop";
export type { Command, System } from "./loop";
export { WORLD_MIN, WORLD_MAX, registerMovement } from "./movement";
export type {
  Position, Health, Mana, Faction, PlayerC, MoveTarget, MoveDir,
  Cooldowns, MonsterC, DefensesC, ProjectileC, GroundAreaC, AilmentC,
  DamageEvent,
} from "./components";
export { registerResourceRegen } from "./systems/resource";
export { registerPlayerMovement } from "./systems/player-movement";
```

- [ ] **Step 7: Run tests — expect pass**

```
npx vitest run packages/simulation/src/systems/resource.test.ts packages/simulation/src/systems/player-movement.test.ts
```

- [ ] **Step 8: Commit**

```
feat(simulation): add resourceRegen and playerMovement systems
```

---

### Task 10: `registerSkillCast(sim, skills)`

**Files:**
- Create: `packages/simulation/src/systems/skill-cast.ts`
- Create: `packages/simulation/src/systems/skill-cast.test.ts`
- Modify: `packages/simulation/src/index.ts`

**Interfaces:**
- Consumes: `Simulation`, `Command`; `fp`, `fpClamp`, `fpStepToward` from `@pact/fixed-point`; `SkillDef`, `EffectNode` from `@pact/content-schema`; `Position`, `Mana`, `Faction`, `Cooldowns`, `ProjectileC`, `GroundAreaC` from `./components`; `WORLD_MIN`, `WORLD_MAX`
- Produces: `registerSkillCast(sim, skills)` exported from `src/index.ts`

- [ ] **Step 1: Write failing test `packages/simulation/src/systems/skill-cast.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { Simulation } from "../loop";
import { registerSkillCast } from "./skill-cast";
import type { SkillDef } from "@pact/content-schema";
import type { Position, Mana, Faction, Cooldowns, ProjectileC, GroundAreaC } from "../components";

// Authored skill defs matching the contract tables exactly.
const EMBER_BOLT: SkillDef = {
  id: "skill.ember_bolt.v1",
  name: "Ember Bolt",
  manaCostFixed: fp(8),   // 8000
  cooldownTicks: 6,
  effects: [{
    type: "spawnProjectile",
    speedPerSecFixed: fp(12),  // 12000
    radiusFixed: fp(0.4),      // 400
    maxRangeFixed: fp(20),     // 20000
    damage: { type: "fire", amountFixed: fp(25) },
  }],
};

const CINDER_GROUND: SkillDef = {
  id: "skill.cinder_ground.v1",
  name: "Cinder Ground",
  manaCostFixed: fp(20),
  cooldownTicks: 30,
  effects: [{
    type: "spawnGroundArea",
    radiusFixed: fp(2.5),
    durationTicks: 90,
    ailment: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(8), durationTicks: 60, maxStacks: 5 },
  }],
};

const BLINK: SkillDef = {
  id: "skill.blink.v1",
  name: "Blink",
  manaCostFixed: fp(15),
  cooldownTicks: 90,
  effects: [{ type: "teleport", distanceFixed: fp(5) }],
};

const ALL_SKILLS = new Map<string, SkillDef>([
  [EMBER_BOLT.id, EMBER_BOLT],
  [CINDER_GROUND.id, CINDER_GROUND],
  [BLINK.id, BLINK],
]);

function makeCaster(sim: Simulation, mana = fp(60)) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x: 0, y: 0 });
  sim.world.set<Mana>(e, "mana", { mana, maxMana: fp(60), regen: 0 });
  sim.world.set<Faction>(e, "faction", { team: 0 });
  sim.world.set<Cooldowns>(e, "cooldowns", {});
  return e;
}

describe("registerSkillCast", () => {
  it("useSkill ember_bolt spawns exactly one projectile entity and deducts mana", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(60));
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: "skill.ember_bolt.v1",
      data: { tx: fp(10), ty: 0 },
    }]);

    const mana = sim.world.get<Mana>(caster, "mana")!;
    expect(mana.mana).toBe(fp(60) - fp(8)); // mana deducted

    const cds = sim.world.get<Cooldowns>(caster, "cooldowns")!;
    expect(cds["skill.ember_bolt.v1"]).toBe(6); // tick 0 + cooldownTicks 6

    // exactly one projectile entity (not the caster)
    const projectiles = sim.world.query("projectile").filter(e => e !== caster);
    expect(projectiles).toHaveLength(1);

    const proj = sim.world.get<ProjectileC>(projectiles[0]!, "projectile")!;
    expect(proj.damageType).toBe(0); // fire
    expect(proj.damageAmount).toBe(fp(25));
    expect(proj.remainingRange).toBe(fp(20));
    expect(proj.radius).toBe(fp(0.4));
    expect(proj.team).toBe(0);
    expect(proj.ownerId).toBe(caster);

    const projPos = sim.world.get<Position>(projectiles[0]!, "position")!;
    // starts at caster position
    expect(projPos.x).toBe(0);
    expect(projPos.y).toBe(0);
  });

  it("second cast while on cooldown spawns nothing and spends no mana", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(60));
    const cmd = { tick: 0, entity: caster, type: "useSkill", skillId: "skill.ember_bolt.v1", data: { tx: fp(10), ty: 0 } };
    sim.step([cmd]); // first cast succeeds
    const manaAfterFirst = sim.world.get<Mana>(caster, "mana")!.mana;
    // tick is now 1, cooldown readyTick is 6 — still on cooldown
    sim.step([{ ...cmd, tick: 1 }]);
    const manaAfterSecond = sim.world.get<Mana>(caster, "mana")!.mana;
    expect(manaAfterSecond).toBe(manaAfterFirst); // no additional spend
    const projectiles = sim.world.query("projectile").filter(e => e !== caster);
    expect(projectiles).toHaveLength(1); // still only one projectile
  });

  it("insufficient mana spawns nothing", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(5)); // less than fp(8) cost
    sim.step([{ tick: 0, entity: caster, type: "useSkill", skillId: "skill.ember_bolt.v1", data: { tx: fp(10), ty: 0 } }]);
    expect(sim.world.query("projectile")).toHaveLength(0);
    expect(sim.world.get<Mana>(caster, "mana")!.mana).toBe(fp(5)); // unchanged
  });

  it("cinder_ground spawns one groundArea entity", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(60));
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: "skill.cinder_ground.v1",
      data: { tx: fp(5), ty: fp(5) },
    }]);
    const areas = sim.world.query("groundArea");
    expect(areas).toHaveLength(1);
    const ga = sim.world.get<GroundAreaC>(areas[0]!, "groundArea")!;
    expect(ga.radius).toBe(fp(2.5));
    expect(ga.expiryTick).toBe(90); // tick 0 + durationTicks 90
    expect(ga.ailmentKind).toBe("burning");
    expect(ga.stacksPerApply).toBe(1);
    expect(ga.maxStacks).toBe(5);
  });

  it("blink moves caster toward aim by at most fp(5)", () => {
    const sim = new Simulation();
    registerSkillCast(sim, ALL_SKILLS);
    const caster = makeCaster(sim, fp(60));
    sim.step([{
      tick: 0, entity: caster, type: "useSkill",
      skillId: "skill.blink.v1",
      data: { tx: fp(10), ty: 0 },
    }]);
    const pos = sim.world.get<Position>(caster, "position")!;
    // aim is fp(10) away; blink distance is fp(5) — should land at fp(5), y=0
    expect(pos.x).toBe(fp(5));
    expect(pos.y).toBe(0);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```
npx vitest run packages/simulation/src/systems/skill-cast.test.ts
```

Expected: module-not-found for `./skill-cast`.

- [ ] **Step 3: Create `packages/simulation/src/systems/skill-cast.ts`**

```ts
import { fp, fpClamp, fpStepToward } from "@pact/fixed-point";
import type { SkillDef } from "@pact/content-schema";
import { Simulation } from "../loop";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import type { Position, Mana, Faction, Cooldowns, ProjectileC, GroundAreaC } from "../components";

export function registerSkillCast(sim: Simulation, skills: ReadonlyMap<string, SkillDef>): void {
  sim.register("skillCast", (world, tick, commands) => {
    for (const cmd of commands) {
      if (cmd.type !== "useSkill" || cmd.entity === undefined || !cmd.skillId) continue;
      const caster = cmd.entity;
      const skill = skills.get(cmd.skillId);
      if (!skill) continue;

      const cds = world.get<Cooldowns>(caster, "cooldowns") ?? {};
      if ((cds[cmd.skillId] ?? 0) > tick) continue; // on cooldown

      const manaComp = world.get<Mana>(caster, "mana");
      if (!manaComp || manaComp.mana < skill.manaCostFixed) continue; // insufficient mana

      // Spend mana and set cooldown.
      world.set<Mana>(caster, "mana", {
        mana: manaComp.mana - skill.manaCostFixed,
        maxMana: manaComp.maxMana,
        regen: manaComp.regen,
      });
      world.set<Cooldowns>(caster, "cooldowns", {
        ...cds,
        [cmd.skillId]: tick + skill.cooldownTicks,
      });

      const pos = world.get<Position>(caster, "position");
      if (!pos) continue;
      const faction = world.get<Faction>(caster, "faction");
      const casterTeam = faction?.team ?? 0;

      const tx = cmd.data?.["tx"] ?? 0;
      const ty = cmd.data?.["ty"] ?? 0;

      for (const effect of skill.effects) {
        if (effect.type === "spawnProjectile") {
          const speedPerTick = Math.trunc(effect.speedPerSecFixed / 30);
          const step = fpStepToward(pos.x, pos.y, tx, ty, speedPerTick);
          if (step.dx === 0 && step.dy === 0) continue; // aim on top of caster

          const proj = world.create();
          world.set<Position>(proj, "position", { x: pos.x, y: pos.y });
          world.set<ProjectileC>(proj, "projectile", {
            dirx: step.dx,
            diry: step.dy,
            remainingRange: effect.maxRangeFixed,
            radius: effect.radiusFixed,
            damageType: effect.damage.type === "fire" ? 0 : 1,
            damageAmount: effect.damage.amountFixed,
            ownerId: caster,
            team: casterTeam,
          });
        } else if (effect.type === "spawnGroundArea") {
          const gx = fpClamp(tx, WORLD_MIN, WORLD_MAX);
          const gy = fpClamp(ty, WORLD_MIN, WORLD_MAX);
          const area = world.create();
          world.set<Position>(area, "position", { x: gx, y: gy });
          world.set<GroundAreaC>(area, "groundArea", {
            radius: effect.radiusFixed,
            expiryTick: tick + effect.durationTicks,
            nextTick: tick,
            ailmentKind: effect.ailment.kind,
            stacksPerApply: effect.ailment.stacksPerApply,
            dps: effect.ailment.dpsFixed,
            ailmentDuration: effect.ailment.durationTicks,
            maxStacks: effect.ailment.maxStacks,
          });
        } else if (effect.type === "teleport") {
          const step = fpStepToward(pos.x, pos.y, tx, ty, effect.distanceFixed);
          world.set<Position>(caster, "position", {
            x: fpClamp(pos.x + step.dx, WORLD_MIN, WORLD_MAX),
            y: fpClamp(pos.y + step.dy, WORLD_MIN, WORLD_MAX),
          });
        }
      }
    }
  });
}
```

- [ ] **Step 4: Modify `packages/simulation/src/index.ts`** — add export

```ts
export { createStream, fnv1a32 } from "./rng";
export type { RandomStream } from "./rng";
export { World } from "./ecs";
export type { Entity } from "./ecs";
export { serializeWorld, checksumWorld } from "./checksum";
export { Simulation } from "./loop";
export type { Command, System } from "./loop";
export { WORLD_MIN, WORLD_MAX, registerMovement } from "./movement";
export type {
  Position, Health, Mana, Faction, PlayerC, MoveTarget, MoveDir,
  Cooldowns, MonsterC, DefensesC, ProjectileC, GroundAreaC, AilmentC,
  DamageEvent,
} from "./components";
export { registerResourceRegen } from "./systems/resource";
export { registerPlayerMovement } from "./systems/player-movement";
export { registerSkillCast } from "./systems/skill-cast";
```

- [ ] **Step 5: Run test — expect pass**

```
npx vitest run packages/simulation/src/systems/skill-cast.test.ts
```

- [ ] **Step 6: Commit**

```
feat(simulation): add skillCast system
```

---

### Task 11: `registerProjectileMove(sim)`

**Files:**
- Create: `packages/simulation/src/systems/projectile.ts`
- Create: `packages/simulation/src/systems/projectile.test.ts`
- Modify: `packages/simulation/src/index.ts`

**Interfaces:**
- Consumes: `Simulation`; `isqrt`, `fpDist2` from `@pact/fixed-point`; `Position`, `ProjectileC`, `MonsterC`, `Faction`, `DamageEvent` from `./components`
- Produces: `registerProjectileMove(sim)` exported from `src/index.ts`

- [ ] **Step 1: Write failing test `packages/simulation/src/systems/projectile.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { Simulation } from "../loop";
import { registerProjectileMove } from "./projectile";
import type { Position, ProjectileC, MonsterC, Faction, DamageEvent } from "../components";

function makeProjectile(sim: Simulation, px: number, py: number, dirx: number, diry: number, range = fp(20)) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x: px, y: py });
  sim.world.set<ProjectileC>(e, "projectile", {
    dirx, diry,
    remainingRange: range,
    radius: fp(0.4),
    damageType: 0,
    damageAmount: fp(25),
    ownerId: e,
    team: 0,
  });
  return e;
}

function makeMonster(sim: Simulation, mx: number, my: number) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x: mx, y: my });
  sim.world.set<MonsterC>(e, "monster", {
    defId: "monster.cinder_imp.v1",
    moveSpeed: 0, bodyRadius: fp(0.5),
    attackRange: fp(1.2), attackCooldownTicks: 45,
    attackDamage: fp(6), attackType: 1,
    attackReadyTick: 0, state: "idle", rare: 0,
  });
  sim.world.set<Faction>(e, "faction", { team: 1 });
  return e;
}

describe("registerProjectileMove", () => {
  it("projectile advances by (dirx, diry) each tick", () => {
    const sim = new Simulation();
    registerProjectileMove(sim);
    const proj = makeProjectile(sim, 0, 0, fp(1), 0);
    sim.step();
    const pos = sim.world.get<Position>(proj, "position")!;
    expect(pos.x).toBe(fp(1));
    expect(pos.y).toBe(0);
  });

  it("remainingRange decreases by isqrt(dirx^2 + diry^2) per tick", () => {
    const sim = new Simulation();
    registerProjectileMove(sim);
    const dirx = fp(1); // 1000
    const proj = makeProjectile(sim, 0, 0, dirx, 0, fp(20));
    sim.step();
    const p = sim.world.get<ProjectileC>(proj, "projectile")!;
    // isqrt(1000^2 + 0) = 1000
    expect(p.remainingRange).toBe(fp(20) - 1000);
  });

  it("monster within (radius + bodyRadius) gets damage enqueued and remainingRange set to 0", () => {
    const sim = new Simulation();
    registerProjectileMove(sim);
    // projectile at (0,0) moving right by fp(1)=1000 per tick; radius fp(0.4)=400
    const proj = makeProjectile(sim, 0, 0, fp(1), 0, fp(20));
    // monster at fp(1)=1000, y=0; bodyRadius fp(0.5)=500
    // after step: proj at (1000,0), dist2 to monster = 0; (400+500)^2 = 810000 >= 0 -> HIT
    const monster = makeMonster(sim, fp(1), 0);
    sim.step();
    // damage enqueued
    expect(sim.damageQueue).toHaveLength(1);
    const evt: DamageEvent = sim.damageQueue[0]!;
    expect(evt.target).toBe(monster);
    expect(evt.amountFixed).toBe(fp(25));
    expect(evt.type).toBe(0);
    // remainingRange set to 0 (spent)
    const p = sim.world.get<ProjectileC>(proj, "projectile")!;
    expect(p.remainingRange).toBeLessThanOrEqual(0);
  });

  it("miss: no damage when monster is out of range", () => {
    const sim = new Simulation();
    registerProjectileMove(sim);
    const proj = makeProjectile(sim, 0, 0, fp(1), 0, fp(20));
    // monster far away at fp(50)
    makeMonster(sim, fp(50), 0);
    sim.step();
    expect(sim.damageQueue).toHaveLength(0);
    const p = sim.world.get<ProjectileC>(proj, "projectile")!;
    expect(p.remainingRange).toBeGreaterThan(0);
  });

  it("range depletes to 0 after enough ticks with no hit", () => {
    const sim = new Simulation();
    registerProjectileMove(sim);
    // dirx = fp(1) = 1000; each tick remainingRange -= 1000; starts at fp(3) = 3000
    const proj = makeProjectile(sim, 0, 0, fp(1), 0, fp(3));
    sim.step(); // range 2000
    sim.step(); // range 1000
    sim.step(); // range 0
    const p = sim.world.get<ProjectileC>(proj, "projectile")!;
    expect(p.remainingRange).toBeLessThanOrEqual(0);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```
npx vitest run packages/simulation/src/systems/projectile.test.ts
```

- [ ] **Step 3: Create `packages/simulation/src/systems/projectile.ts`**

```ts
import { isqrt, fpDist2 } from "@pact/fixed-point";
import { Simulation } from "../loop";
import type { Position, ProjectileC, MonsterC, Faction } from "../components";

export function registerProjectileMove(sim: Simulation): void {
  sim.register("projectileMove", (world) => {
    for (const e of world.query("projectile", "position")) {
      const pos = world.get<Position>(e, "position")!;
      const proj = world.get<ProjectileC>(e, "projectile")!;

      // Advance.
      const nx = pos.x + proj.dirx;
      const ny = pos.y + proj.diry;
      const traveled = isqrt(proj.dirx * proj.dirx + proj.diry * proj.diry);
      let newRange = proj.remainingRange - traveled;

      // Collision: find first monster (ascending id) within combined radius.
      let hit = false;
      const combinedR2Fn = (bodyRadius: number) => {
        const r = proj.radius + bodyRadius;
        return r * r;
      };
      for (const m of world.query("position", "monster", "faction")) {
        const mFaction = world.get<Faction>(m, "faction")!;
        if (mFaction.team === proj.team) continue; // same team
        const mPos = world.get<Position>(m, "position")!;
        const mMon = world.get<MonsterC>(m, "monster")!;
        const dist2 = fpDist2(nx, ny, mPos.x, mPos.y);
        if (dist2 <= combinedR2Fn(mMon.bodyRadius)) {
          sim.enqueueDamage({
            target: m,
            source: proj.ownerId,
            amountFixed: proj.damageAmount,
            type: proj.damageType,
          });
          newRange = 0; // spent
          hit = true;
          break; // first monster only
        }
      }

      world.set<Position>(e, "position", { x: nx, y: ny });
      world.set<ProjectileC>(e, "projectile", { ...proj, remainingRange: newRange });

      void hit; // hit flag used to break; consumed above
    }
  });
}
```

- [ ] **Step 4: Modify `packages/simulation/src/index.ts`** — add export

```ts
export { createStream, fnv1a32 } from "./rng";
export type { RandomStream } from "./rng";
export { World } from "./ecs";
export type { Entity } from "./ecs";
export { serializeWorld, checksumWorld } from "./checksum";
export { Simulation } from "./loop";
export type { Command, System } from "./loop";
export { WORLD_MIN, WORLD_MAX, registerMovement } from "./movement";
export type {
  Position, Health, Mana, Faction, PlayerC, MoveTarget, MoveDir,
  Cooldowns, MonsterC, DefensesC, ProjectileC, GroundAreaC, AilmentC,
  DamageEvent,
} from "./components";
export { registerResourceRegen } from "./systems/resource";
export { registerPlayerMovement } from "./systems/player-movement";
export { registerSkillCast } from "./systems/skill-cast";
export { registerProjectileMove } from "./systems/projectile";
```

- [ ] **Step 5: Run test — expect pass**

```
npx vitest run packages/simulation/src/systems/projectile.test.ts
```

- [ ] **Step 6: Commit**

```
feat(simulation): add projectileMove system
```

---

### Task 12: `registerGroundAreaTick(sim)` + `registerAilmentTick(sim)`

**Files:**
- Create: `packages/simulation/src/systems/ground-area.ts`
- Create: `packages/simulation/src/systems/ailment.ts`
- Create: `packages/simulation/src/systems/ground-area.test.ts`
- Create: `packages/simulation/src/systems/ailment.test.ts`
- Modify: `packages/simulation/src/index.ts`

**Interfaces:**
- Consumes: `Simulation`; `fpDist2` from `@pact/fixed-point`; `refreshBurning`, `burningTickDamage`, `AILMENT_TICK_INTERVAL` from `@pact/rules`; `Position`, `MonsterC`, `Faction`, `GroundAreaC`, `AilmentC` from `./components`
- Produces: `registerGroundAreaTick(sim)`, `registerAilmentTick(sim)` exported from `src/index.ts`

- [ ] **Step 1: Write failing test `packages/simulation/src/systems/ground-area.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { AILMENT_TICK_INTERVAL } from "@pact/rules";
import { Simulation } from "../loop";
import { registerGroundAreaTick } from "./ground-area";
import type { Position, MonsterC, Faction, GroundAreaC, AilmentC } from "../components";

function makeArea(sim: Simulation, tick = 0) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x: 0, y: 0 });
  sim.world.set<GroundAreaC>(e, "groundArea", {
    radius: fp(2.5),
    expiryTick: tick + 90,
    nextTick: tick,
    ailmentKind: "burning",
    stacksPerApply: 1,
    dps: fp(8),
    ailmentDuration: 60,
    maxStacks: 5,
  });
  return e;
}

function makeMonster(sim: Simulation, x = fp(1), y = 0) {
  const e = sim.world.create();
  sim.world.set<Position>(e, "position", { x, y });
  sim.world.set<MonsterC>(e, "monster", {
    defId: "monster.cinder_imp.v1",
    moveSpeed: 0, bodyRadius: fp(0.5),
    attackRange: fp(1.2), attackCooldownTicks: 45,
    attackDamage: fp(6), attackType: 1,
    attackReadyTick: 0, state: "idle", rare: 0,
  });
  sim.world.set<Faction>(e, "faction", { team: 1 });
  return e;
}

describe("registerGroundAreaTick", () => {
  it("monster inside area gains ailment on first tick", () => {
    const sim = new Simulation();
    registerGroundAreaTick(sim);
    makeArea(sim, 0);   // nextTick = 0, area at (0,0), radius fp(2.5)
    const monster = makeMonster(sim, fp(1), 0);
    // monster at fp(1)=1000, dist2 = 1000^2 = 1e6; (fp(2.5)+fp(0.5))^2 = 3000^2 = 9e6; 1e6 <= 9e6 -> IN RANGE
    sim.step();
    const ailment = sim.world.get<AilmentC>(monster, "ailment")!;
    expect(ailment).toBeDefined();
    expect(ailment.stacks).toBe(1);
    expect(ailment.kind).toBe("burning");
    expect(ailment.expiryTick).toBe(60); // tick 0 + durationTicks 60
  });

  it("nextTick advances by AILMENT_TICK_INTERVAL after application", () => {
    const sim = new Simulation();
    registerGroundAreaTick(sim);
    const area = makeArea(sim, 0);
    makeMonster(sim, fp(1), 0);
    sim.step();
    const ga = sim.world.get<GroundAreaC>(area, "groundArea")!;
    expect(ga.nextTick).toBe(AILMENT_TICK_INTERVAL);
  });

  it("repeated applications refresh and cap stacks at maxStacks", () => {
    const sim = new Simulation();
    registerGroundAreaTick(sim);
    const area = makeArea(sim, 0);
    const monster = makeMonster(sim, fp(1), 0);
    // each step at tick%6===0 applies one stack; step through 6 intervals
    for (let i = 0; i < 6; i++) {
      // advance sim.tick to nextTick manually by stepping AILMENT_TICK_INTERVAL times
      for (let j = 0; j < AILMENT_TICK_INTERVAL; j++) {
        sim.step();
      }
    }
    const ailment = sim.world.get<AilmentC>(monster, "ailment")!;
    // maxStacks is 5; applied 6 times but capped
    expect(ailment.stacks).toBe(5);
  });

  it("monster outside area does not gain ailment", () => {
    const sim = new Simulation();
    registerGroundAreaTick(sim);
    makeArea(sim, 0);
    // monster at fp(10), far outside radius fp(2.5)+fp(0.5)=fp(3)
    const monster = makeMonster(sim, fp(10), 0);
    sim.step();
    expect(sim.world.get(monster, "ailment")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write failing test `packages/simulation/src/systems/ailment.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fp } from "@pact/fixed-point";
import { AILMENT_TICK_INTERVAL, burningTickDamage } from "@pact/rules";
import { Simulation } from "../loop";
import { registerAilmentTick } from "./ailment";
import type { AilmentC, DamageEvent } from "../components";

function makeEntityWithAilment(sim: Simulation, stacks: number, expiryTick: number) {
  const e = sim.world.create();
  sim.world.set<AilmentC>(e, "ailment", {
    kind: "burning",
    stacks,
    dps: fp(8),
    expiryTick,
  });
  return e;
}

describe("registerAilmentTick", () => {
  it("enqueues fire damage equal to burningTickDamage on interval ticks", () => {
    const sim = new Simulation();
    registerAilmentTick(sim);
    const stacks = 2;
    const dps = fp(8);
    const expiryTick = 120;
    const e = makeEntityWithAilment(sim, stacks, expiryTick);
    // sim.tick is 0; AILMENT_TICK_INTERVAL = 6; 0 % 6 === 0 -> should enqueue
    sim.step(); // tick 0 runs, then tick increments to 1
    expect(sim.damageQueue).toHaveLength(1);
    const evt: DamageEvent = sim.damageQueue[0]!;
    expect(evt.target).toBe(e);
    expect(evt.type).toBe(0); // fire
    const expected = burningTickDamage({ kind: "burning", stacks, dpsFixed: dps, expiryTick });
    expect(evt.amountFixed).toBe(expected);
  });

  it("does not enqueue on non-interval ticks", () => {
    const sim = new Simulation();
    registerAilmentTick(sim);
    makeEntityWithAilment(sim, 1, 120);
    sim.step(); // tick 0 -> enqueues (0 % 6 === 0)
    sim.step(); // tick 1 -> no enqueue (1 % 6 !== 0)
    // damage queue cleared at start of each step; after step() at tick=1, queue should be empty
    expect(sim.damageQueue).toHaveLength(0);
  });

  it("removes ailment when tick >= expiryTick", () => {
    const sim = new Simulation();
    registerAilmentTick(sim);
    const e = makeEntityWithAilment(sim, 1, 3); // expires at tick 3
    // advance to tick 3
    sim.step(); // tick 0
    sim.step(); // tick 1
    sim.step(); // tick 2
    // ailment still present
    expect(sim.world.get(e, "ailment")).toBeDefined();
    sim.step(); // tick 3 -> tick >= expiryTick (3 >= 3) -> remove
    expect(sim.world.get(e, "ailment")).toBeUndefined();
  });

  it("enqueues again every AILMENT_TICK_INTERVAL ticks", () => {
    const sim = new Simulation();
    registerAilmentTick(sim);
    makeEntityWithAilment(sim, 1, 300);
    // step through two full intervals; damage should be enqueued at tick 0 and tick 6
    let enqueuedCount = 0;
    for (let i = 0; i < AILMENT_TICK_INTERVAL * 2; i++) {
      sim.step();
      // damageQueue is cleared at start of each step, then systems run
      if (sim.damageQueue.length > 0) enqueuedCount++;
    }
    expect(enqueuedCount).toBe(2); // ticks 0 and 6
  });
});
```

- [ ] **Step 3: Run tests — expect failure**

```
npx vitest run packages/simulation/src/systems/ground-area.test.ts packages/simulation/src/systems/ailment.test.ts
```

- [ ] **Step 4: Create `packages/simulation/src/systems/ground-area.ts`**

```ts
import { fpDist2 } from "@pact/fixed-point";
import { refreshBurning, AILMENT_TICK_INTERVAL } from "@pact/rules";
import { Simulation } from "../loop";
import type { Position, MonsterC, GroundAreaC, AilmentC } from "../components";

export function registerGroundAreaTick(sim: Simulation): void {
  sim.register("groundAreaTick", (world, tick) => {
    for (const ae of world.query("groundArea", "position")) {
      const ga = world.get<GroundAreaC>(ae, "groundArea")!;
      if (tick < ga.nextTick) continue;

      const aPos = world.get<Position>(ae, "position")!;

      for (const m of world.query("position", "monster")) {
        const mPos = world.get<Position>(m, "position")!;
        const mMon = world.get<MonsterC>(m, "monster")!;
        const threshold = ga.radius + mMon.bodyRadius;
        if (fpDist2(aPos.x, aPos.y, mPos.x, mPos.y) > threshold * threshold) continue;

        const prev = world.get<AilmentC>(m, "ailment");
        const prevState = prev
          ? { kind: "burning" as const, stacks: prev.stacks, dpsFixed: prev.dps, expiryTick: prev.expiryTick }
          : undefined;
        const next = refreshBurning(prevState, ga.stacksPerApply, ga.dps, tick, ga.ailmentDuration, ga.maxStacks);
        world.set<AilmentC>(m, "ailment", {
          kind: next.kind,
          stacks: next.stacks,
          dps: next.dpsFixed,
          expiryTick: next.expiryTick,
        });
      }

      world.set<GroundAreaC>(ae, "groundArea", { ...ga, nextTick: ga.nextTick + AILMENT_TICK_INTERVAL });
    }
  });
}
```

- [ ] **Step 5: Create `packages/simulation/src/systems/ailment.ts`**

```ts
import { burningTickDamage, AILMENT_TICK_INTERVAL } from "@pact/rules";
import { Simulation } from "../loop";
import type { AilmentC } from "../components";

export function registerAilmentTick(sim: Simulation): void {
  sim.register("ailmentTick", (world, tick) => {
    for (const e of world.entitiesWith("ailment")) {
      const a = world.get<AilmentC>(e, "ailment")!;
      if (tick >= a.expiryTick) {
        world.remove(e, "ailment");
        continue;
      }
      if (tick % AILMENT_TICK_INTERVAL === 0) {
        sim.enqueueDamage({
          target: e,
          source: e,
          amountFixed: burningTickDamage({ kind: "burning", stacks: a.stacks, dpsFixed: a.dps, expiryTick: a.expiryTick }),
          type: 0,
        });
      }
    }
  });
}
```

- [ ] **Step 6: Modify `packages/simulation/src/index.ts`** — add exports (final state for Phase C1)

```ts
export { createStream, fnv1a32 } from "./rng";
export type { RandomStream } from "./rng";
export { World } from "./ecs";
export type { Entity } from "./ecs";
export { serializeWorld, checksumWorld } from "./checksum";
export { Simulation } from "./loop";
export type { Command, System } from "./loop";
export { WORLD_MIN, WORLD_MAX, registerMovement } from "./movement";
export type {
  Position, Health, Mana, Faction, PlayerC, MoveTarget, MoveDir,
  Cooldowns, MonsterC, DefensesC, ProjectileC, GroundAreaC, AilmentC,
  DamageEvent,
} from "./components";
export { registerResourceRegen } from "./systems/resource";
export { registerPlayerMovement } from "./systems/player-movement";
export { registerSkillCast } from "./systems/skill-cast";
export { registerProjectileMove } from "./systems/projectile";
export { registerGroundAreaTick } from "./systems/ground-area";
export { registerAilmentTick } from "./systems/ailment";
```

- [ ] **Step 7: Run tests — expect pass**

```
npx vitest run packages/simulation/src/systems/ground-area.test.ts packages/simulation/src/systems/ailment.test.ts
```

- [ ] **Step 8: Run full simulation test suite**

```
npx vitest run packages/simulation
```

- [ ] **Step 9: Commit**

```
feat(simulation): add groundAreaTick and ailmentTick systems
```

### Task 13: `registerMonsterAI(sim)`

**Files:**
- Create `packages/simulation/src/systems/monster-ai.ts`
- Create `packages/simulation/src/systems/monster-ai.test.ts`
- Modify `packages/simulation/src/index.ts`: add `export { registerMonsterAI } from "./systems/monster-ai";`

**Interfaces:**
- Consumes: `Simulation` (with `enqueueDamage` added by Task 8), `World`; `fpDist2`, `fpStepToward`, `fpClamp` from `@pact/fixed-point`; `WORLD_MIN`, `WORLD_MAX` from `@pact/simulation`; components `monster`, `position`, `faction`
- Produces: `registerMonsterAI(sim: Simulation): void`

- [ ] **Step 1: Write the failing test**

`packages/simulation/src/systems/monster-ai.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Simulation } from "@pact/simulation";
import { fp, fpDist2 } from "@pact/fixed-point";
import { registerMonsterAI } from "./monster-ai";

interface DamageEvent { target: number; source: number; amountFixed: number; type: 0 | 1 }
interface CS extends Simulation { damageQueue: DamageEvent[]; enqueueDamage(e: DamageEvent): void }

function makeSim(): CS {
  const sim = new Simulation() as CS;
  sim.damageQueue = [];
  sim.enqueueDamage = (e) => sim.damageQueue.push(e);
  return sim;
}

describe("registerMonsterAI", () => {
  it("monster far from player chases — squared distance strictly decreases", () => {
    const sim = makeSim();
    registerMonsterAI(sim);
    const { world } = sim;

    const player = world.create();
    world.set(player, "position", { x: fp(0), y: fp(0) });
    world.set(player, "faction", { team: 0 });
    world.set(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });

    const m = world.create();
    world.set(m, "position", { x: fp(10), y: fp(0) });
    world.set(m, "faction", { team: 1 });
    world.set(m, "monster", {
      defId: "test", moveSpeed: fp(2), bodyRadius: fp(0.5),
      attackRange: fp(1.2), attackCooldownTicks: 45,
      attackDamage: fp(6), attackType: 1 as const,
      attackReadyTick: 0, state: "idle", rare: 0 as const,
    });

    const before = fpDist2(fp(10), fp(0), fp(0), fp(0));
    sim.step();
    const mpos = world.get<{ x: number; y: number }>(m, "position")!;
    expect(fpDist2(mpos.x, mpos.y, fp(0), fp(0))).toBeLessThan(before);
    expect(world.get<{ state: string }>(m, "monster")!.state).toBe("chase");
  });

  it("within attackRange → attack state; damage enqueued once per cooldown window", () => {
    const sim = makeSim();
    registerMonsterAI(sim);
    const { world } = sim;

    const player = world.create();
    world.set(player, "position", { x: fp(0), y: fp(0) });
    world.set(player, "faction", { team: 0 });
    world.set(player, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });

    const m = world.create();
    // fp(1) = 1000 < attackRange fp(1.2) = 1200 → in range
    world.set(m, "position", { x: fp(1), y: fp(0) });
    world.set(m, "faction", { team: 1 });
    world.set(m, "monster", {
      defId: "test", moveSpeed: fp(2), bodyRadius: fp(0.5),
      attackRange: fp(1.2), attackCooldownTicks: 45,
      attackDamage: fp(6), attackType: 1 as const,
      attackReadyTick: 0, state: "idle", rare: 0 as const,
    });

    // tick=0, attackReadyTick=0 → enqueue
    sim.step();
    expect(sim.damageQueue).toHaveLength(1);
    expect(world.get<{ state: string }>(m, "monster")!.state).toBe("attack");
    // attackReadyTick is now 0+45=45; tick 1 < 45 → no re-enqueue
    sim.damageQueue.length = 0;
    sim.step();
    expect(sim.damageQueue).toHaveLength(0);
  });

  it("no players → idle, position unchanged", () => {
    const sim = makeSim();
    registerMonsterAI(sim);
    const { world } = sim;

    const m = world.create();
    world.set(m, "position", { x: fp(5), y: fp(3) });
    world.set(m, "faction", { team: 1 });
    world.set(m, "monster", {
      defId: "test", moveSpeed: fp(2), bodyRadius: fp(0.5),
      attackRange: fp(1.2), attackCooldownTicks: 45,
      attackDamage: fp(6), attackType: 1 as const,
      attackReadyTick: 0, state: "chase", rare: 0 as const,
    });

    sim.step();
    expect(world.get<{ state: string }>(m, "monster")!.state).toBe("idle");
    expect(world.get<{ x: number; y: number }>(m, "position")).toEqual({ x: fp(5), y: fp(3) });
    expect(sim.damageQueue).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```
npx vitest run packages/simulation/src/systems/monster-ai.test.ts
```

Fails: `Cannot find module './monster-ai'`.

- [ ] **Step 3: Implement `monster-ai.ts`**

`packages/simulation/src/systems/monster-ai.ts`:

```ts
import { fpDist2, fpStepToward, fpClamp } from "@pact/fixed-point";
import { WORLD_MIN, WORLD_MAX } from "../movement";
import type { Simulation } from "../loop";
import type { Entity } from "../ecs";

interface MonsterC {
  defId: string; moveSpeed: number; bodyRadius: number;
  attackRange: number; attackCooldownTicks: number;
  attackDamage: number; attackType: 0 | 1;
  attackReadyTick: number; state: string; rare: 0 | 1;
}
interface Pos { x: number; y: number }
interface FactionC { team: number }
interface CS extends Simulation {
  enqueueDamage(e: { target: Entity; source: Entity; amountFixed: number; type: 0 | 1 }): void;
}

export function registerMonsterAI(sim: Simulation): void {
  const cs = sim as CS;
  cs.register("monsterAI", (world, tick) => {
    // Players: team 0, sorted ascending (world.query already sorts by id)
    const players = world
      .query("player", "faction", "position")
      .filter(e => (world.get<FactionC>(e, "faction")?.team ?? -1) === 0);

    for (const m of world.query("monster", "position")) {
      const mpos = world.get<Pos>(m, "position")!;
      const mon = world.get<MonsterC>(m, "monster")!;

      if (players.length === 0) {
        world.set(m, "monster", { ...mon, state: "idle" });
        continue;
      }

      // Nearest player — ascending iteration means first minimum wins (lowest-id tiebreak)
      let nearest: Entity = players[0]!;
      let nearestD2 = fpDist2(
        mpos.x, mpos.y,
        world.get<Pos>(nearest, "position")!.x,
        world.get<Pos>(nearest, "position")!.y,
      );
      for (let i = 1; i < players.length; i++) {
        const p = players[i]!;
        const pp = world.get<Pos>(p, "position")!;
        const d2 = fpDist2(mpos.x, mpos.y, pp.x, pp.y);
        if (d2 < nearestD2) { nearest = p; nearestD2 = d2; }
      }

      const ppos = world.get<Pos>(nearest, "position")!;
      const ar = mon.attackRange;

      if (nearestD2 <= ar * ar) {
        let { attackReadyTick } = mon;
        if (tick >= attackReadyTick) {
          cs.enqueueDamage({
            target: nearest, source: m,
            amountFixed: mon.attackDamage,
            type: mon.attackType,
          });
          attackReadyTick = tick + mon.attackCooldownTicks;
        }
        world.set(m, "monster", { ...mon, state: "attack", attackReadyTick });
      } else {
        const { dx, dy } = fpStepToward(mpos.x, mpos.y, ppos.x, ppos.y, mon.moveSpeed);
        world.set(m, "position", {
          x: fpClamp(mpos.x + dx, WORLD_MIN, WORLD_MAX),
          y: fpClamp(mpos.y + dy, WORLD_MIN, WORLD_MAX),
        });
        world.set(m, "monster", { ...mon, state: "chase" });
      }
    }
  });
}
```

- [ ] **Step 4: Run test — expect pass**

```
npx vitest run packages/simulation/src/systems/monster-ai.test.ts
```

All 3 tests pass.

- [ ] **Step 5: Export from index**

In `packages/simulation/src/index.ts`, append:

```ts
export { registerMonsterAI } from "./systems/monster-ai";
```

- [ ] **Step 6: Commit**

```
git add packages/simulation/src/systems/monster-ai.ts \
        packages/simulation/src/systems/monster-ai.test.ts \
        packages/simulation/src/index.ts
git commit -m "feat(simulation): registerMonsterAI — chase/attack/idle AI state machine"
```

---

### Task 14: `registerDamageResolve(sim)` + `registerDeath(sim)` + `registerExpiry(sim)`

**Files:**
- Create `packages/simulation/src/systems/damage-resolve.ts`
- Create `packages/simulation/src/systems/death.ts`
- Create `packages/simulation/src/systems/expiry.ts`
- Create `packages/simulation/src/systems/damage-resolve.test.ts`
- Create `packages/simulation/src/systems/death.test.ts`
- Create `packages/simulation/src/systems/expiry.test.ts`
- Modify `packages/simulation/src/index.ts`: export all three

**Interfaces:**
- Consumes: `Simulation` (with `damageQueue`/`enqueueDamage` from Task 8); `applyDamage` from `@pact/rules`; `DamageSpec`, `Defenses` from `@pact/content-schema`; components `health`, `defenses`, `monster`, `player`, `mana`, `position`, `projectile`, `groundArea`
- Produces: `registerDamageResolve(sim: Simulation): void`, `registerDeath(sim: Simulation): void`, `registerExpiry(sim: Simulation): void`

- [ ] **Step 1: Write the failing tests**

`packages/simulation/src/systems/damage-resolve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Simulation } from "@pact/simulation";
import { fp } from "@pact/fixed-point";
import { registerDamageResolve } from "./damage-resolve";

interface DamageEvent { target: number; source: number; amountFixed: number; type: 0 | 1 }
interface CS extends Simulation { damageQueue: DamageEvent[]; enqueueDamage(e: DamageEvent): void }

function makeSim(): CS {
  const sim = new Simulation() as CS;
  sim.damageQueue = [];
  sim.enqueueDamage = (e) => sim.damageQueue.push(e);
  return sim;
}

describe("registerDamageResolve", () => {
  it("applies two enqueued events in sorted order, floored at 0", () => {
    const sim = makeSim();
    registerDamageResolve(sim);
    const { world } = sim;

    // target=1: physical hit, armour fp(0) → takes full fp(10)
    const t1 = world.create();
    world.set(t1, "health", { life: fp(40), maxLife: fp(40) });
    world.set(t1, "defenses", { fireResPct: 0, armour: fp(0) });

    // target=2: fire hit, fireResPct=50 → takes trunc(fp(20)*50/100)=fp(10)
    const t2 = world.create();
    world.set(t2, "health", { life: fp(30), maxLife: fp(30) });
    world.set(t2, "defenses", { fireResPct: 50, armour: fp(0) });

    sim.damageQueue.push({ target: t2, source: 99, amountFixed: fp(20), type: 0 }); // fire
    sim.damageQueue.push({ target: t1, source: 99, amountFixed: fp(10), type: 1 }); // physical

    sim.step();

    // t1: physical fp(10), armour fp(0) → ARMOUR_K/(0+ARMOUR_K)*fp(10) = fp(10)
    expect(world.get<{ life: number }>(t1, "health")!.life).toBe(fp(40) - fp(10));
    // t2: fire fp(20), fireResPct=50 → trunc(20000*50/100)=10000=fp(10)
    expect(world.get<{ life: number }>(t2, "health")!.life).toBe(fp(30) - fp(10));
  });

  it("life floors at 0, never goes negative", () => {
    const sim = makeSim();
    registerDamageResolve(sim);
    const { world } = sim;

    const t = world.create();
    world.set(t, "health", { life: fp(1), maxLife: fp(40) });
    world.set(t, "defenses", { fireResPct: 0, armour: fp(0) });

    sim.damageQueue.push({ target: t, source: 99, amountFixed: fp(100), type: 1 });
    sim.step();

    expect(world.get<{ life: number }>(t, "health")!.life).toBe(0);
  });
});
```

`packages/simulation/src/systems/death.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Simulation } from "@pact/simulation";
import { fp } from "@pact/fixed-point";
import { registerDeath } from "./death";

describe("registerDeath", () => {
  it("destroys a monster with life <= 0", () => {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;

    const m = world.create();
    world.set(m, "monster", { defId: "test", state: "idle", moveSpeed: 0, bodyRadius: 0,
      attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, rare: 0 });
    world.set(m, "health", { life: 0, maxLife: fp(40) });

    sim.step();
    expect(world.alive.has(m)).toBe(false);
  });

  it("respawns a player at origin with full life/mana when life <= 0", () => {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;

    const p = world.create();
    world.set(p, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    world.set(p, "health", { life: 0, maxLife: fp(100) });
    world.set(p, "mana", { mana: fp(10), maxMana: fp(60), regen: 0 });
    world.set(p, "position", { x: fp(5), y: fp(5) });

    sim.step();

    expect(world.alive.has(p)).toBe(true);
    expect(world.get<{ life: number; maxLife: number }>(p, "health")!.life).toBe(fp(100));
    expect(world.get<{ mana: number; maxMana: number }>(p, "mana")!.mana).toBe(fp(60));
    expect(world.get<{ x: number; y: number }>(p, "position")).toEqual({ x: 0, y: 0 });
  });

  it("does not touch a monster with life > 0", () => {
    const sim = new Simulation();
    registerDeath(sim);
    const { world } = sim;

    const m = world.create();
    world.set(m, "monster", { defId: "test", state: "idle", moveSpeed: 0, bodyRadius: 0,
      attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, rare: 0 });
    world.set(m, "health", { life: fp(1), maxLife: fp(40) });

    sim.step();
    expect(world.alive.has(m)).toBe(true);
  });
});
```

`packages/simulation/src/systems/expiry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Simulation } from "@pact/simulation";
import { fp } from "@pact/fixed-point";
import { registerExpiry } from "./expiry";

describe("registerExpiry", () => {
  it("destroys a projectile with remainingRange <= 0", () => {
    const sim = new Simulation();
    registerExpiry(sim);
    const { world } = sim;

    const e = world.create();
    world.set(e, "projectile", {
      dirx: fp(1), diry: 0, remainingRange: 0,
      radius: fp(0.4), damageType: 0, damageAmount: fp(10),
      ownerId: 1, team: 0,
    });
    world.set(e, "position", { x: fp(3), y: fp(0) });

    sim.step(); // tick=0, projectile.remainingRange=0 → destroy
    expect(world.alive.has(e)).toBe(false);
  });

  it("does not destroy a projectile with remainingRange > 0", () => {
    const sim = new Simulation();
    registerExpiry(sim);
    const { world } = sim;

    const e = world.create();
    world.set(e, "projectile", {
      dirx: fp(1), diry: 0, remainingRange: fp(5),
      radius: fp(0.4), damageType: 0, damageAmount: fp(10),
      ownerId: 1, team: 0,
    });
    world.set(e, "position", { x: fp(0), y: fp(0) });

    sim.step();
    expect(world.alive.has(e)).toBe(true);
  });

  it("destroys a groundArea whose expiryTick <= tick", () => {
    const sim = new Simulation();
    registerExpiry(sim);
    const { world } = sim;

    const e = world.create();
    // expiryTick=0; step runs with tick=0 → 0 >= 0 → destroy
    world.set(e, "groundArea", {
      radius: fp(2.5), expiryTick: 0, nextTick: 0,
      ailmentKind: "burning", stacksPerApply: 1,
      dps: fp(8), ailmentDuration: 60, maxStacks: 5,
    });
    world.set(e, "position", { x: fp(0), y: fp(0) });

    sim.step();
    expect(world.alive.has(e)).toBe(false);
  });

  it("keeps a groundArea with expiryTick in the future", () => {
    const sim = new Simulation();
    registerExpiry(sim);
    const { world } = sim;

    const e = world.create();
    world.set(e, "groundArea", {
      radius: fp(2.5), expiryTick: 90, nextTick: 0,
      ailmentKind: "burning", stacksPerApply: 1,
      dps: fp(8), ailmentDuration: 60, maxStacks: 5,
    });
    world.set(e, "position", { x: fp(0), y: fp(0) });

    sim.step(); // tick=0, 0 < 90 → keep
    expect(world.alive.has(e)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — expect failure**

```
npx vitest run packages/simulation/src/systems/damage-resolve.test.ts \
               packages/simulation/src/systems/death.test.ts \
               packages/simulation/src/systems/expiry.test.ts
```

All fail: modules not found.

- [ ] **Step 3: Implement `damage-resolve.ts`**

`packages/simulation/src/systems/damage-resolve.ts`:

```ts
import { applyDamage } from "@pact/rules";
import type { Simulation } from "../loop";
import type { Entity } from "../ecs";

interface DamageEvent { target: Entity; source: Entity; amountFixed: number; type: 0 | 1 }
interface CS extends Simulation { damageQueue: DamageEvent[] }
interface HealthC { life: number; maxLife: number }
interface DefC { fireResPct: number; armour: number }

export function registerDamageResolve(sim: Simulation): void {
  const cs = sim as CS;
  cs.register("damageResolve", (world) => {
    const q = cs.damageQueue
      .slice()
      .sort((a, b) =>
        a.target !== b.target ? a.target - b.target :
        a.source !== b.source ? a.source - b.source :
        a.type - b.type,
      );
    cs.damageQueue.length = 0;

    for (const ev of q) {
      const health = world.get<HealthC>(ev.target, "health");
      const def = world.get<DefC>(ev.target, "defenses");
      if (!health || !def) continue;

      const final = applyDamage(
        { type: ev.type === 0 ? "fire" : "physical", amountFixed: ev.amountFixed },
        { fireResPct: def.fireResPct, armourFixed: def.armour },
      );
      world.set(ev.target, "health", {
        ...health,
        life: Math.max(0, health.life - final),
      });
    }
  });
}
```

- [ ] **Step 4: Implement `death.ts`**

`packages/simulation/src/systems/death.ts`:

```ts
import type { Simulation } from "../loop";

interface HealthC { life: number; maxLife: number }
interface ManaC { mana: number; maxMana: number; regen: number }

export function registerDeath(sim: Simulation): void {
  sim.register("death", (world) => {
    // Monsters: life <= 0 → destroy
    for (const e of world.query("monster", "health")) {
      if ((world.get<HealthC>(e, "health")?.life ?? 1) <= 0) {
        world.destroy(e);
      }
    }

    // Player: life <= 0 → respawn at origin with full resources
    for (const e of world.query("player", "health")) {
      const h = world.get<HealthC>(e, "health")!;
      if (h.life > 0) continue;
      world.set(e, "position", { x: 0, y: 0 });
      world.set(e, "health", { ...h, life: h.maxLife });
      const mn = world.get<ManaC>(e, "mana");
      if (mn) world.set(e, "mana", { ...mn, mana: mn.maxMana });
    }
  });
}
```

- [ ] **Step 5: Implement `expiry.ts`**

`packages/simulation/src/systems/expiry.ts`:

```ts
import type { Simulation } from "../loop";

interface ProjectileC { remainingRange: number }
interface GroundAreaC { expiryTick: number }

export function registerExpiry(sim: Simulation): void {
  sim.register("expiry", (world, tick) => {
    for (const e of world.query("projectile")) {
      if ((world.get<ProjectileC>(e, "projectile")?.remainingRange ?? 1) <= 0) {
        world.destroy(e);
      }
    }
    for (const e of world.query("groundArea")) {
      if (tick >= (world.get<GroundAreaC>(e, "groundArea")?.expiryTick ?? Infinity)) {
        world.destroy(e);
      }
    }
  });
}
```

- [ ] **Step 6: Run tests — expect pass**

```
npx vitest run packages/simulation/src/systems/damage-resolve.test.ts \
               packages/simulation/src/systems/death.test.ts \
               packages/simulation/src/systems/expiry.test.ts
```

All 7 tests pass.

- [ ] **Step 7: Export from index**

In `packages/simulation/src/index.ts`, append:

```ts
export { registerDamageResolve } from "./systems/damage-resolve";
export { registerDeath } from "./systems/death";
export { registerExpiry } from "./systems/expiry";
```

- [ ] **Step 8: Commit**

```
git add packages/simulation/src/systems/damage-resolve.ts \
        packages/simulation/src/systems/damage-resolve.test.ts \
        packages/simulation/src/systems/death.ts \
        packages/simulation/src/systems/death.test.ts \
        packages/simulation/src/systems/expiry.ts \
        packages/simulation/src/systems/expiry.test.ts \
        packages/simulation/src/index.ts
git commit -m "feat(simulation): damageResolve, death, expiry systems"
```

---

### Task 15: `createCombatSim(seed)` — system assembly + world bootstrap

**Files:**
- Create `packages/simulation/src/combat-sim.ts`
- Create `packages/simulation/src/combat-sim.test.ts`
- Modify `packages/simulation/src/index.ts`: export `createCombatSim`
- Modify `packages/simulation/package.json`: add deps `@pact/rules`, `@pact/content-schema`, `@pact/content-runtime`, `@pact/protocol`

**Interfaces:**
- Consumes: all `register*` functions (C1 + T13/T14); `baseCasterStats`, `makeRare` from `@pact/rules`; `SKILLS`, `MONSTERS`, `RARE_TEMPLATE`, `CONTENT_VERSION` from `@pact/content-runtime`; `fp` from `@pact/fixed-point`; `Simulation`, `World`, `Entity` from `@pact/simulation`
- Produces: `createCombatSim(seed: number): { sim: Simulation; world: World; playerEntity: Entity }`

- [ ] **Step 1: Update `packages/simulation/package.json`**

```json
{
  "name": "@pact/simulation",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@pact/fixed-point": "*",
    "@pact/rules": "*",
    "@pact/content-schema": "*",
    "@pact/content-runtime": "*",
    "@pact/protocol": "*"
  }
}
```

- [ ] **Step 2: Write the failing test**

`packages/simulation/src/combat-sim.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checksumWorld } from "@pact/simulation";
import { fp } from "@pact/fixed-point";
import { createCombatSim } from "./combat-sim";

describe("createCombatSim", () => {
  it("spawns exactly 1 player and 6 monsters (5 normal + 1 rare)", () => {
    const { world } = createCombatSim(42);
    expect(world.query("player")).toHaveLength(1);
    expect(world.query("monster")).toHaveLength(6);
  });

  it("player entity carries all required components with correct values", () => {
    const { world, playerEntity } = createCombatSim(42);
    const health = world.get<{ life: number; maxLife: number }>(playerEntity, "health")!;
    expect(health.life).toBe(health.maxLife);
    expect(health.maxLife).toBe(fp(100));

    const mana = world.get<{ mana: number; maxMana: number; regen: number }>(playerEntity, "mana")!;
    expect(mana.mana).toBe(mana.maxMana);
    expect(mana.maxMana).toBe(fp(60));
    expect(mana.regen).toBe(Math.trunc(fp(6) / 30)); // 200

    const faction = world.get<{ team: number }>(playerEntity, "faction")!;
    expect(faction.team).toBe(0);

    const player = world.get<{ moveSpeed: number; bodyRadius: number }>(playerEntity, "player")!;
    expect(player.moveSpeed).toBe(Math.trunc(fp(3.5) / 30)); // 116
    expect(player.bodyRadius).toBe(fp(0.5));

    const pos = world.get<{ x: number; y: number }>(playerEntity, "position")!;
    expect(pos).toEqual({ x: 0, y: 0 });

    // cooldowns, defenses, moveTarget, moveDir must be present
    expect(world.has(playerEntity, "cooldowns")).toBe(true);
    expect(world.has(playerEntity, "defenses")).toBe(true);
    expect(world.has(playerEntity, "moveTarget")).toBe(true);
    expect(world.has(playerEntity, "moveDir")).toBe(true);
  });

  it("rare monster has higher maxLife than a normal imp", () => {
    const { world } = createCombatSim(42);
    const monsters = world.query("monster");
    const lives = monsters.map(e =>
      world.get<{ maxLife?: number; rare: number }>(e, "health")
        ? { maxLife: world.get<{ maxLife: number }>(e, "health")!.maxLife,
            rare: world.get<{ rare: number }>(e, "monster")!.rare }
        : null,
    ).filter(Boolean) as { maxLife: number; rare: number }[];

    const normalLife = lives.find(l => l.rare === 0)!.maxLife;
    const rareLife = lives.find(l => l.rare === 1)!.maxLife;
    expect(rareLife).toBeGreaterThan(normalLife);
    // rare = trunc(fp(40)*250/100) = trunc(100000/100) = 1000 ??? 
    // fp(40)=40000; 40000*250/100 = 100000 = fp(100). normal = fp(40)=40000.
    expect(rareLife).toBe(Math.trunc(fp(40) * 250 / 100)); // fp(100)
  });

  it("running 30 ticks twice with the same seed produces identical checksum sequences (determinism)", () => {
    const run = () => {
      const { sim } = createCombatSim(42);
      const sums: number[] = [];
      for (let i = 0; i < 30; i++) {
        sim.step([]);
        sums.push(checksumWorld(sim.world));
      }
      return sums;
    };
    expect(run()).toEqual(run());
  });

  it("system registration order matches canonical spec", () => {
    const { sim } = createCombatSim(42);
    expect(sim.systemOrder()).toEqual([
      "resourceRegen", "skillCast", "playerMovement", "monsterAI",
      "projectileMove", "groundAreaTick", "ailmentTick",
      "damageResolve", "death", "expiry",
    ]);
  });
});
```

- [ ] **Step 3: Run test — expect failure**

```
npx vitest run packages/simulation/src/combat-sim.test.ts
```

Fails: `Cannot find module './combat-sim'`.

- [ ] **Step 4: Implement `combat-sim.ts`**

`packages/simulation/src/combat-sim.ts`:

```ts
import { fp } from "@pact/fixed-point";
import { baseCasterStats, makeRare } from "@pact/rules";
import { SKILLS, MONSTERS, RARE_TEMPLATE } from "@pact/content-runtime";
import type { MonsterDef } from "@pact/content-schema";
import { Simulation, World } from "./ecs";
import type { Entity } from "./ecs";
import {
  registerResourceRegen,
  registerPlayerMovement,
  registerSkillCast,
  registerProjectileMove,
  registerGroundAreaTick,
  registerAilmentTick,
} from "./systems";
import { registerMonsterAI } from "./systems/monster-ai";
import { registerDamageResolve } from "./systems/damage-resolve";
import { registerDeath } from "./systems/death";
import { registerExpiry } from "./systems/expiry";
import { Simulation as SimClass } from "./loop";

// ponytail: seed unused by Phase C2 systems; kept as param so the signature is
// stable for Phase C3 when RNG-driven monster variance will use it.
export function createCombatSim(
  _seed: number,
): { sim: SimClass; world: World; playerEntity: Entity } {
  const sim = new SimClass();
  const { world } = sim;

  // ── Register systems in canonical order ──────────────────────────────────
  registerResourceRegen(sim);
  registerSkillCast(sim, SKILLS);
  registerPlayerMovement(sim);
  registerMonsterAI(sim);
  registerProjectileMove(sim);
  registerGroundAreaTick(sim);
  registerAilmentTick(sim);
  registerDamageResolve(sim);
  registerDeath(sim);
  registerExpiry(sim);

  // ── Bootstrap player ─────────────────────────────────────────────────────
  const s = baseCasterStats();
  const playerEntity = world.create();
  world.set(playerEntity, "position", { x: 0, y: 0 });
  world.set(playerEntity, "health", { life: s.maxLifeFixed, maxLife: s.maxLifeFixed });
  world.set(playerEntity, "mana", {
    mana: s.maxManaFixed,
    maxMana: s.maxManaFixed,
    regen: Math.trunc(s.manaRegenPerSecFixed / 30),
  });
  world.set(playerEntity, "faction", { team: 0 });
  world.set(playerEntity, "player", {
    moveSpeed: Math.trunc(s.moveSpeedFixed / 30),
    bodyRadius: fp(0.5),
  });
  world.set(playerEntity, "cooldowns", {});
  world.set(playerEntity, "defenses", {
    fireResPct: s.fireResPct,
    armour: s.armourFixed,
  });
  world.set(playerEntity, "moveTarget", { x: 0, y: 0, active: 0 });
  world.set(playerEntity, "moveDir", { dx: 0, dy: 0 });

  // ── Bootstrap monsters ────────────────────────────────────────────────────
  const impDef = MONSTERS.get("monster.cinder_imp.v1")!;

  // 5 normal imps at fixed coords
  const normalCoords: [number, number][] = [
    [fp(5), fp(0)], [fp(-5), fp(0)],
    [fp(0), fp(5)], [fp(0), fp(-5)],
    [fp(6), fp(6)],
  ];
  for (const [x, y] of normalCoords) {
    spawnMonster(world, impDef, x, y, false);
  }

  // 1 rare imp
  const rareDef = makeRare(impDef, RARE_TEMPLATE);
  spawnMonster(world, rareDef, fp(8), fp(8), true);

  return { sim, world, playerEntity };
}

function spawnMonster(
  world: World,
  def: MonsterDef,
  x: number,
  y: number,
  rare: boolean,
): Entity {
  const e = world.create();
  world.set(e, "position", { x, y });
  world.set(e, "health", { life: def.maxLifeFixed, maxLife: def.maxLifeFixed });
  world.set(e, "faction", { team: 1 });
  world.set(e, "monster", {
    defId: def.id,
    moveSpeed: Math.trunc(def.moveSpeedFixed / 30),
    bodyRadius: def.radiusFixed,
    attackRange: def.attackRangeFixed,
    attackCooldownTicks: def.attackCooldownTicks,
    attackDamage: def.attackDamage.amountFixed,
    attackType: def.attackDamage.type === "fire" ? 0 : 1,
    attackReadyTick: 0,
    state: "idle",
    rare: rare ? 1 : 0,
  });
  world.set(e, "defenses", {
    fireResPct: def.defenses.fireResPct,
    armour: def.defenses.armourFixed,
  });
  return e;
}
```

- [ ] **Step 5: Run test — expect pass**

```
npx vitest run packages/simulation/src/combat-sim.test.ts
```

All 5 tests pass.

- [ ] **Step 6: Export from index**

In `packages/simulation/src/index.ts`, append:

```ts
export { createCombatSim } from "./combat-sim";
```

- [ ] **Step 7: Commit**

```
git add packages/simulation/src/combat-sim.ts \
        packages/simulation/src/combat-sim.test.ts \
        packages/simulation/src/index.ts \
        packages/simulation/package.json
git commit -m "feat(simulation): createCombatSim — full system assembly and world bootstrap"
```

---

### Task 16: `intentToCommand` + `buildSnapshot`

**Files:**
- Create `packages/simulation/src/protocol-bridge.ts`
- Create `packages/simulation/src/protocol-bridge.test.ts`
- Modify `packages/simulation/src/index.ts`: export `intentToCommand`, `buildSnapshot`
- (No `loop.ts` change: `Command.skillId?: string` already exists from Task 8; `data` stays `Record<string, number>`.)

**Interfaces:**
- Consumes: `Intent`, `Snapshot`, `SnapshotEntity` from `@pact/protocol`; `Command`, `Simulation`, `World`, `Entity` from `@pact/simulation`; `toNumber` from `@pact/fixed-point`; `CONTENT_VERSION` from `@pact/content-runtime`
- Produces: `intentToCommand(intent: Intent, player: Entity, tick: number): Command`, `buildSnapshot(world: World, sim: Simulation, tick: number, contentVersion: string): Snapshot`

- [ ] **Step 1: Write the failing test**

`packages/simulation/src/protocol-bridge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fp, toNumber } from "@pact/fixed-point";
import { createCombatSim } from "./combat-sim";
import { intentToCommand, buildSnapshot } from "./protocol-bridge";
import { CONTENT_VERSION } from "@pact/content-runtime";
import type { Intent } from "@pact/protocol";

describe("intentToCommand", () => {
  it("moveTo maps to correct Command shape", () => {
    const intent: Intent = { kind: "moveTo", x: fp(3), y: fp(-2) };
    const cmd = intentToCommand(intent, 1, 5);
    expect(cmd).toEqual({ tick: 5, entity: 1, type: "moveTo", data: { x: fp(3), y: fp(-2) } });
  });

  it("moveDir maps to correct Command shape", () => {
    const intent: Intent = { kind: "moveDir", dx: 1, dy: -1 };
    const cmd = intentToCommand(intent, 1, 0);
    expect(cmd).toEqual({ tick: 0, entity: 1, type: "moveDir", data: { dx: 1, dy: -1 } });
  });

  it("useSkill maps to correct Command shape with skillId at top level", () => {
    const intent: Intent = { kind: "useSkill", skillId: "skill.ember_bolt.v1", tx: fp(5), ty: fp(0) };
    const cmd = intentToCommand(intent, 2, 10);
    expect(cmd.type).toBe("useSkill");
    expect(cmd.entity).toBe(2);
    expect(cmd.tick).toBe(10);
    expect(cmd.skillId).toBe("skill.ember_bolt.v1");
    expect(cmd.data?.tx).toBe(fp(5));
    expect(cmd.data?.ty).toBe(fp(0));
  });

  it("stop maps to correct Command shape", () => {
    const intent: Intent = { kind: "stop" };
    const cmd = intentToCommand(intent, 1, 3);
    expect(cmd).toEqual({ tick: 3, entity: 1, type: "stop" });
  });
});

describe("buildSnapshot", () => {
  it("reflects player position, full life/mana on fresh world", () => {
    const { world, sim, playerEntity } = createCombatSim(42);
    const snap = buildSnapshot(world, sim, 0, CONTENT_VERSION);
    expect(snap.tick).toBe(0);
    expect(snap.player.id).toBe(playerEntity);
    expect(snap.player.x).toBe(0); // toNumber(fp(0)) = 0
    expect(snap.player.y).toBe(0);
    expect(snap.player.life).toBeCloseTo(toNumber(fp(100)), 5);
    expect(snap.player.maxLife).toBeCloseTo(toNumber(fp(100)), 5);
    expect(snap.player.mana).toBeCloseTo(toNumber(fp(60)), 5);
    expect(snap.player.alive).toBe(true);
  });

  it("cooldown shows remaining seconds after a skill is cast", () => {
    const { world, sim, playerEntity } = createCombatSim(42);
    const intent: Intent = { kind: "useSkill", skillId: "skill.ember_bolt.v1", tx: fp(5), ty: fp(0) };
    const cmd = intentToCommand(intent, playerEntity, 0);
    sim.step([cmd]); // tick=0 processed, sim.tick becomes 1
    // Ember Bolt cooldownTicks=6; readyTick=6; remaining at tick=1 → (6-1)/30
    const snap = buildSnapshot(world, sim, sim.tick, CONTENT_VERSION);
    expect(snap.player.cooldowns["skill.ember_bolt.v1"]).toBeCloseTo(5 / 30, 5);
  });

  it("monster entities appear in snapshot sorted by id with life/maxLife/rare", () => {
    const { world, sim } = createCombatSim(42);
    const snap = buildSnapshot(world, sim, 0, CONTENT_VERSION);
    const monsters = snap.entities.filter(e => e.kind === "monster");
    expect(monsters).toHaveLength(6);
    // ids are ascending
    for (let i = 1; i < monsters.length; i++) {
      expect(monsters[i]!.id).toBeGreaterThan(monsters[i - 1]!.id);
    }
    // one is rare
    expect(monsters.filter(e => e.rare).length).toBe(1);
    // all have life === maxLife on fresh world
    for (const m of monsters) {
      expect(m.life).toBeCloseTo(m.maxLife!, 5);
    }
  });

  it("a spawned projectile appears as a projectile entity", () => {
    const { world, sim, playerEntity } = createCombatSim(42);
    const intent: Intent = { kind: "useSkill", skillId: "skill.ember_bolt.v1", tx: fp(5), ty: fp(0) };
    sim.step([intentToCommand(intent, playerEntity, 0)]);
    const snap = buildSnapshot(world, sim, sim.tick, CONTENT_VERSION);
    const projs = snap.entities.filter(e => e.kind === "projectile");
    expect(projs).toHaveLength(1);
    expect(typeof projs[0]!.radius).toBe("number");
  });

  it("all entities are sorted by id", () => {
    const { world, sim, playerEntity } = createCombatSim(42);
    const intent: Intent = { kind: "useSkill", skillId: "skill.cinder_ground.v1", tx: fp(3), ty: fp(0) };
    sim.step([intentToCommand(intent, playerEntity, 0)]);
    const snap = buildSnapshot(world, sim, sim.tick, CONTENT_VERSION);
    for (let i = 1; i < snap.entities.length; i++) {
      expect(snap.entities[i]!.id).toBeGreaterThan(snap.entities[i - 1]!.id);
    }
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```
npx vitest run packages/simulation/src/protocol-bridge.test.ts
```

Fails: `Cannot find module './protocol-bridge'`.

- [ ] **Step 3: Implement `protocol-bridge.ts`**

`packages/simulation/src/protocol-bridge.ts`:

```ts
import { toNumber } from "@pact/fixed-point";
import type { Intent, Snapshot, SnapshotEntity } from "@pact/protocol";
import type { Command } from "./loop";
import type { Simulation } from "./loop";
import type { World, Entity } from "./ecs";

export function intentToCommand(intent: Intent, player: Entity, tick: number): Command {
  switch (intent.kind) {
    case "moveTo":
      return { tick, entity: player, type: "moveTo", data: { x: intent.x, y: intent.y } };
    case "moveDir":
      return { tick, entity: player, type: "moveDir", data: { dx: intent.dx, dy: intent.dy } };
    case "useSkill":
      return {
        tick, entity: player, type: "useSkill",
        skillId: intent.skillId,
        data: { tx: intent.tx, ty: intent.ty },
      };
    case "stop":
      return { tick, entity: player, type: "stop" };
  }
}

interface HealthC { life: number; maxLife: number }
interface ManaC { mana: number; maxMana: number }
interface PosC { x: number; y: number }
interface AilmentC { stacks: number }
interface ProjectileC { radius: number }
interface GroundAreaC { radius: number; expiryTick: number }

export function buildSnapshot(
  world: World,
  sim: Simulation,
  tick: number,
  _contentVersion: string,
): Snapshot {
  const playerEntities = world.query("player", "health", "mana", "position", "cooldowns");
  const playerEntity = playerEntities[0]!;

  const ph = world.get<HealthC>(playerEntity, "health")!;
  const pm = world.get<ManaC>(playerEntity, "mana")!;
  const pp = world.get<PosC>(playerEntity, "position")!;
  const rawCds = world.get<Record<string, number>>(playerEntity, "cooldowns") ?? {};

  const cooldowns: Record<string, number> = {};
  for (const [skillId, readyTick] of Object.entries(rawCds)) {
    cooldowns[skillId] = Math.max(0, (readyTick - tick) / 30);
  }

  const entities: SnapshotEntity[] = [];

  for (const e of world.query("monster", "position", "health")) {
    const mp = world.get<PosC>(e, "position")!;
    const mh = world.get<HealthC>(e, "health")!;
    const mon = world.get<{ rare: number }>(e, "monster")!;
    const ail = world.get<AilmentC>(e, "ailment");
    const entry: SnapshotEntity = {
      id: e,
      kind: "monster",
      x: toNumber(mp.x), y: toNumber(mp.y),
      life: toNumber(mh.life), maxLife: toNumber(mh.maxLife),
      rare: mon.rare === 1,
    };
    if (ail !== undefined) entry.ailmentStacks = ail.stacks;
    entities.push(entry);
  }

  for (const e of world.query("projectile", "position")) {
    const pp2 = world.get<PosC>(e, "position")!;
    const pr = world.get<ProjectileC>(e, "projectile")!;
    entities.push({
      id: e, kind: "projectile",
      x: toNumber(pp2.x), y: toNumber(pp2.y),
      radius: toNumber(pr.radius),
    });
  }

  for (const e of world.query("groundArea", "position")) {
    const gp = world.get<PosC>(e, "position")!;
    const ga = world.get<GroundAreaC>(e, "groundArea")!;
    entities.push({
      id: e, kind: "groundArea",
      x: toNumber(gp.x), y: toNumber(gp.y),
      radius: toNumber(ga.radius),
      remainingSeconds: (ga.expiryTick - tick) / 30,
    });
  }

  entities.sort((a, b) => a.id - b.id);

  return {
    tick,
    player: {
      id: playerEntity,
      x: toNumber(pp.x), y: toNumber(pp.y),
      life: toNumber(ph.life), maxLife: toNumber(ph.maxLife),
      mana: toNumber(pm.mana), maxMana: toNumber(pm.maxMana),
      cooldowns,
      alive: ph.life > 0,
    },
    entities,
  };
}
```

- [ ] **Step 4: Run test — expect pass**

```
npx vitest run packages/simulation/src/protocol-bridge.test.ts
```

All 7 tests pass.

- [ ] **Step 5: Export from index**

In `packages/simulation/src/index.ts`, append:

```ts
export { intentToCommand, buildSnapshot } from "./protocol-bridge";
```

- [ ] **Step 6: Commit**

```
git add packages/simulation/src/protocol-bridge.ts \
        packages/simulation/src/protocol-bridge.test.ts \
        packages/simulation/src/index.ts
git commit -m "feat(simulation): intentToCommand and buildSnapshot protocol bridge"
```

---

### Task 17: golden combat scenarios (headless, spec §9)

**Files:**
- Create `packages/replay/src/scenarios/combat.ts`
- Create `packages/replay/src/scenarios/combat.test.ts`
- Verify `@pact/simulation` is already in `packages/replay/package.json` (it is — no change needed)

**Interfaces:**
- Consumes: `createCombatSim`, `intentToCommand`, `buildSnapshot` from `@pact/simulation`; `checksumWorld` from `@pact/simulation`; `applyDamage` from `@pact/rules`; `fp` from `@pact/fixed-point`; `firstDifference` from `@pact/replay`; `CONTENT_VERSION` from `@pact/content-runtime`; `Command` from `@pact/simulation`; `Snapshot` from `@pact/protocol`
- Produces: `runCombat(seed, commandsByTick, ticks): { checksums: number[]; finalSnapshot: Snapshot }`

- [ ] **Step 1: Write the failing test**

`packages/replay/src/scenarios/combat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fp, toNumber } from "@pact/fixed-point";
import { applyDamage } from "@pact/rules";
import { createCombatSim, intentToCommand, checksumWorld } from "@pact/simulation";
import { CONTENT_VERSION } from "@pact/content-runtime";
import { firstDifference } from "../index";
import { runCombat } from "./combat";
import type { Intent } from "@pact/protocol";

// ── helpers ────────────────────────────────────────────────────────────────

function fireSkill(player: number, skillId: string, tx: number, ty: number, atTick: number) {
  const intent: Intent = { kind: "useSkill", skillId, tx, ty };
  return intentToCommand(intent, player, atTick);
}

// ── (a) Ember Bolt hits a lined-up cinder imp ──────────────────────────────

describe("golden (a): Ember Bolt fire damage on a cinder imp", () => {
  it("reduces imp life by the correctly mitigated amount after projectile connects", () => {
    const { sim, world, playerEntity } = createCombatSim(42);
    // imp at fp(5),fp(0) = entity 2; player at origin
    // Projectile speed fp(12)/s → fp(12000)/30 = 400 fixed/tick
    // imp moveSpeed fp(2.4)/s → Math.trunc(2400/30)=80 fixed/tick
    // They converge: collision at ~step 8 (see plan notes)
    const cmd = fireSkill(playerEntity, "skill.ember_bolt.v1", fp(5), fp(0), 0);
    for (let t = 0; t < 20; t++) {
      sim.step(t === 0 ? [cmd] : []);
    }
    // Expected mitigated damage: fire fp(25), imp fireResPct=0 → full fp(25)
    const expectedDamage = applyDamage(
      { type: "fire", amountFixed: fp(25) },
      { fireResPct: 0, armourFixed: fp(0.5) },
    );
    expect(expectedDamage).toBe(fp(25)); // no fire res → full damage

    // At least one imp must have taken the hit
    const damagedImps = world.query("monster", "health").filter(e => {
      const h = world.get<{ life: number; maxLife: number }>(e, "health")!;
      return h.life < h.maxLife;
    });
    expect(damagedImps.length).toBeGreaterThan(0);

    // The hit imp's life deficit equals expectedDamage (accounting for potential monster
    // that also took melee damage — check at least one has exactly fp(40)-fp(25)=fp(15))
    const hasCorrectLife = world.query("monster", "health").some(e => {
      const h = world.get<{ life: number; maxLife: number }>(e, "health")!;
      return h.life === h.maxLife - expectedDamage;
    });
    expect(hasCorrectLife).toBe(true);
  });
});

// ── (b) Cinder Ground applies burning that stacks and expires ─────────────

describe("golden (b): Cinder Ground burning ailment", () => {
  it("applies burning stacks to a monster standing in the area", () => {
    const { sim, world, playerEntity } = createCombatSim(42);
    // Fire CG at fp(5),fp(0) — imp starts there, radius 2.5 covers it
    const cmd = fireSkill(playerEntity, "skill.cinder_ground.v1", fp(5), fp(0), 0);
    // Run 7 ticks: groundAreaTick at tick=0 sets nextTick=6, fires at tick=6
    for (let t = 0; t < 7; t++) {
      sim.step(t === 0 ? [cmd] : []);
    }
    // By tick 6, at least one monster in range should have ailment stacks >= 1
    const hasAilment = world.query("monster", "ailment").some(e =>
      (world.get<{ stacks: number }>(e, "ailment")?.stacks ?? 0) >= 1,
    );
    expect(hasAilment).toBe(true);
  });

  it("ailment expires after durationTicks with no re-application", () => {
    const { sim, world, playerEntity } = createCombatSim(42);
    const cmd = fireSkill(playerEntity, "skill.cinder_ground.v1", fp(5), fp(0), 0);
    // Run 200 ticks — well past ailmentDuration=60 and CG expiryTick=90
    for (let t = 0; t < 200; t++) {
      sim.step(t === 0 ? [cmd] : []);
    }
    // No living monster should still have a burning ailment
    const stillBurning = world.query("monster", "ailment")
      .filter(e => world.get<{ kind: string }>(e, "ailment")?.kind === "burning")
      .length;
    expect(stillBurning).toBe(0);
  });
});

// ── (c) Resistance check: rare imp takes less fire damage than normal ──────

describe("golden (c): fire resistance reduces damage", () => {
  it("rare imp (fireResPct=30) takes strictly less fire damage than normal (fireResPct=0)", () => {
    // Direct rule check — no need for full sim run
    const hit = fp(25);
    const normalDmg = applyDamage({ type: "fire", amountFixed: hit }, { fireResPct: 0, armourFixed: fp(0.5) });
    const rareDmg = applyDamage({ type: "fire", amountFixed: hit }, { fireResPct: 30, armourFixed: fp(0.5) });
    expect(rareDmg).toBeLessThan(normalDmg);
    // rare: trunc(25000 * 70/100) = trunc(17500) = 17500
    expect(rareDmg).toBe(Math.trunc(fp(25) * 70 / 100));
  });
});

// ── (d) Monster at 0 life is removed from the world ───────────────────────

describe("golden (d): monster death removes entity", () => {
  it("a monster overkilled to 0 life is absent from the world after the tick", () => {
    const { sim, world, playerEntity } = createCombatSim(42);
    // Fire three Ember Bolts at the imp at fp(5),fp(0) in successive windows
    // Imp has fp(40) life; each bolt does fp(25) → two bolts are enough
    // Use cooldown-window scheduling: EB cooldown=6 ticks
    const cmds: [number, ReturnType<typeof fireSkill>][] = [
      [0, fireSkill(playerEntity, "skill.ember_bolt.v1", fp(5), fp(0), 0)],
      [10, fireSkill(playerEntity, "skill.ember_bolt.v1", fp(5), fp(0), 10)],
    ];
    const cmdMap = new Map(cmds);
    let impEntityAliveAtSome = false;
    let impEntityDeadEventually = false;
    for (let t = 0; t < 60; t++) {
      const tickCmds = cmdMap.get(t) ? [cmdMap.get(t)!] : [];
      sim.step(tickCmds);
      // Track whether the imp at fp(5) ever existed and was later removed
      const alive = world.query("monster").length;
      if (t < 10) impEntityAliveAtSome = alive > 0;
      if (t > 20 && world.query("monster").every(e => {
        const h = world.get<{ life: number }>(e, "health")!;
        return h.life > 0;
      })) impEntityDeadEventually = true;
    }
    expect(impEntityAliveAtSome).toBe(true);
    // After sufficient bolts, at least one monster should have been killed
    const allMonsters = world.query("monster");
    // started with 6, at least one should be gone (or all remaining have life>0)
    expect(allMonsters.length).toBeLessThanOrEqual(5);
  });
});

// ── (e) Determinism: two runs with same seed produce identical checksums ───

describe("golden (e): determinism", () => {
  it("two runCombat calls with same seed and commands yield identical checksum sequences", () => {
    const ticks = 30;
    const cmds: import("@pact/simulation").Command[][] = [];
    // Fire Ember Bolt at tick 0
    const { playerEntity } = createCombatSim(42);
    const bolt = fireSkill(playerEntity, "skill.ember_bolt.v1", fp(5), fp(0), 0);
    cmds[0] = [bolt];

    const run1 = runCombat(42, cmds, ticks);
    const run2 = runCombat(42, cmds, ticks);

    expect(firstDifference(run1.checksums, run2.checksums)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect failure**

```
npx vitest run packages/replay/src/scenarios/combat.test.ts
```

Fails: `Cannot find module './combat'`.

- [ ] **Step 3: Implement `combat.ts`**

`packages/replay/src/scenarios/combat.ts`:

```ts
import { createCombatSim, buildSnapshot, checksumWorld } from "@pact/simulation";
import { CONTENT_VERSION } from "@pact/content-runtime";
import type { Command } from "@pact/simulation";
import type { Snapshot } from "@pact/protocol";

export function runCombat(
  seed: number,
  commandsByTick: Command[][],
  ticks: number,
): { checksums: number[]; finalSnapshot: Snapshot } {
  const { sim, world } = createCombatSim(seed);
  const checksums: number[] = [];

  for (let t = 0; t < ticks; t++) {
    sim.step(commandsByTick[t] ?? []);
    checksums.push(checksumWorld(world));
  }

  const finalSnapshot = buildSnapshot(world, sim, sim.tick, CONTENT_VERSION);
  return { checksums, finalSnapshot };
}
```

- [ ] **Step 4: Run test — expect pass**

```
npx vitest run packages/replay/src/scenarios/combat.test.ts
```

All tests pass.

- [ ] **Step 5: Run full suite to confirm no regressions**

```
npx vitest run
```

All tests pass.

- [ ] **Step 6: Commit**

```
git add packages/replay/src/scenarios/combat.ts \
        packages/replay/src/scenarios/combat.test.ts
git commit -m "test(replay): golden combat scenarios — damage, ailment, resistance, death, determinism"
```

<!-- Phase D — apps/web client (Tasks 18–23) -->

### Task 18: apps/web scaffold (Vite + React + workspace wiring)

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/vite-env.d.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/App.test.tsx`
- Modify: root `package.json` (add `"apps/*"` to `workspaces`)
- Modify: root `vitest.config.ts` (extend `include` to cover `apps/**/*.test.{ts,tsx}`)
- Modify: root `tsconfig.json` (add `apps/web/src` to `include`)
- Modify: `.github/workflows/ci.yml` (add `npm run build -w apps/web`)

**Interfaces:**
- Consumes: `@pact/protocol` (`Snapshot`), nothing from sim yet (stub only).
- Produces: a working `npm run dev -w apps/web` entry point; `apps/web` tests run under `vitest` via jsdom pragma; CI builds the bundle.

- [ ] **Step 1: Modify root `package.json` — add `apps/*` workspace**

```json
{
  "name": "pact-of-ruin",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Modify root `vitest.config.ts` — include apps tests**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.{ts,tsx}",
      "*.test.ts",
    ],
    environment: "node",
  },
});
```

- [ ] **Step 3: Modify root `tsconfig.json` — include apps/web/src**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["packages/*/src", "apps/web/src", "*.ts"]
}
```

- [ ] **Step 4: Modify `.github/workflows/ci.yml` — add web build step**

```yaml
name: CI
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build -w apps/web
```

- [ ] **Step 5: Write failing test first**

`apps/web/src/App.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { App } from "./App";

// Worker is not available in jsdom — stub it so App can mount without crashing.
beforeAll(() => {
  vi.stubGlobal(
    "Worker",
    vi.fn(() => ({
      postMessage: vi.fn(),
      onmessage: null,
      terminate: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

describe("App", () => {
  it("renders a canvas element", () => {
    const { container } = render(<App />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});
```

Run: `npm test` — **expected to fail** (modules do not exist yet).

- [ ] **Step 6: Create `apps/web/package.json`**

```json
{
  "name": "apps/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@babylonjs/core": "^7.35.0",
    "@pact/protocol": "*",
    "@pact/simulation": "*",
    "@pact/content-runtime": "*"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "@testing-library/react": "^16.0.1",
    "@testing-library/jest-dom": "^6.6.3",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1"
  }
}
```

- [ ] **Step 7: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node", "@testing-library/jest-dom"],
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 8: Create `apps/web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  worker: {
    format: "es",
  },
});
```

- [ ] **Step 9: Create `apps/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Pact of Ruin — Combat Lab</title>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
      #root { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 10: Create `apps/web/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />
```

- [ ] **Step 11: Create `apps/web/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 12: Create `apps/web/src/App.tsx` (scaffold stub)**

```tsx
import React from "react";

export function App() {
  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <canvas
        id="render-canvas"
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      <div id="hud-root" style={{ position: "absolute", top: 0, left: 0 }} />
    </div>
  );
}
```

- [ ] **Step 13: Run tests — expected to pass**

```
npm test
```

Expected: the `App.test.tsx` suite passes (canvas element present).

- [ ] **Step 14: Commit**

```
feat(apps/web): scaffold Vite+React workspace, wire CI build
```

---

### Task 19: sim worker (fixed-step driver)

**Files:**
- Create: `apps/web/src/worker/worker-core.ts`
- Create: `apps/web/src/worker/sim-worker.ts`
- Create: `apps/web/src/worker/worker-core.test.ts`

**Interfaces:**
- Consumes: `@pact/simulation` (`createCombatSim`, `intentToCommand`, `buildSnapshot`, `Simulation`, `World`, `Entity`); `@pact/protocol` (`Intent`, `Snapshot`, `ToWorker`, `FromWorker`); `@pact/content-runtime` (`CONTENT_VERSION`).
- Produces: `WorkerCore` — headless, testable fixed-step sim driver; `sim-worker.ts` — thin `onmessage` glue (not unit-tested; verified in Task 23).

- [ ] **Step 1: Write failing tests first**

`apps/web/src/worker/worker-core.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { WorkerCore } from "./worker-core";
import type { Intent } from "@pact/protocol";
import { fp } from "@pact/fixed-point";

// ponytail: determinism is the whole point — these three cases cover the contract
describe("WorkerCore", () => {
  it("advance(100) from rest produces exactly 3 ticks (3 × ~33.33 ms ≤ 100 ms)", () => {
    const core = new WorkerCore(42);
    const snaps = core.advance(100);
    expect(snaps.length).toBe(3);
    expect(snaps[snaps.length - 1]!.tick).toBe(3);
  });

  it("two seeds produce identical snapshot sequences (determinism)", () => {
    const intent: Intent = { kind: "moveDir", dx: 1, dy: 0 };
    const coreA = new WorkerCore(42);
    const coreB = new WorkerCore(42);
    coreA.pushIntent(intent);
    coreB.pushIntent(intent);
    const snapsA = coreA.advance(100);
    const snapsB = coreB.advance(100);
    expect(JSON.stringify(snapsA)).toBe(JSON.stringify(snapsB));
  });

  it("a pushed moveTo intent moves the player from origin", () => {
    const core = new WorkerCore(42);
    const before = core.snapshot();
    const startX = before?.player.x ?? 0;
    const startY = before?.player.y ?? 0;

    const intent: Intent = { kind: "moveTo", x: fp(10), y: fp(10) };
    core.pushIntent(intent);
    core.advance(34); // one tick
    const after = core.snapshot();

    expect(after).not.toBeNull();
    // Player must have moved at least somewhat toward (10,10)
    const dx = (after!.player.x - startX) ** 2;
    const dy = (after!.player.y - startY) ** 2;
    expect(dx + dy).toBeGreaterThan(0);
  });
});
```

Run: `npm test` — **expected to fail** (module does not exist).

- [ ] **Step 2: Create `apps/web/src/worker/worker-core.ts`**

```ts
import {
  createCombatSim,
  intentToCommand,
  buildSnapshot,
} from "@pact/simulation";
import type { Simulation, World, Entity } from "@pact/simulation";
import type { Intent, Snapshot } from "@pact/protocol";
import { CONTENT_VERSION } from "@pact/content-runtime";

// MS_PER_TICK lives here (client wall-clock pacing) — never fed into the sim.
// ponytail: float constant is intentional; accumulator drives integer tick steps
const MS_PER_TICK = 1000 / 30;

export class WorkerCore {
  private readonly sim: Simulation;
  private readonly world: World;
  private readonly playerEntity: Entity;
  private tick = 0;
  private accMs = 0;
  private pending: Intent[] = [];

  constructor(seed: number) {
    const result = createCombatSim(seed);
    this.sim = result.sim;
    this.world = result.sim.world;
    this.playerEntity = result.playerEntity;
  }

  pushIntent(intent: Intent): void {
    this.pending.push(intent);
  }

  advance(dtMs: number): Snapshot[] {
    this.accMs += dtMs;
    const out: Snapshot[] = [];
    while (this.accMs >= MS_PER_TICK) {
      const commands = this.pending.map((i) =>
        intentToCommand(i, this.playerEntity, this.tick),
      );
      this.pending = [];
      this.sim.step(commands);
      this.tick++;
      this.accMs -= MS_PER_TICK;
      out.push(buildSnapshot(this.world, this.sim, this.tick, CONTENT_VERSION));
    }
    return out;
  }

  /** Latest snapshot, or null before the first tick. */
  snapshot(): Snapshot | null {
    if (this.tick === 0) return null;
    return buildSnapshot(this.world, this.sim, this.tick, CONTENT_VERSION);
  }
}
```

- [ ] **Step 3: Create `apps/web/src/worker/sim-worker.ts`**

```ts
/// <reference lib="webworker" />
import { WorkerCore } from "./worker-core";
import type { ToWorker, FromWorker } from "@pact/protocol";

// ponytail: thin glue only — no logic lives here; all sim logic is in WorkerCore
const MS_PER_TICK = 1000 / 30;

let core: WorkerCore | null = null;

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === "init") {
    core = new WorkerCore(msg.seed);
    const ready: FromWorker = { type: "ready" };
    self.postMessage(ready);
  } else if (msg.type === "intent" && core) {
    core.pushIntent(msg.intent);
  } else if (msg.type === "reset") {
    // seed preserved across reset is not in the protocol — recreate with seed 42
    // (lab default). Full seed-carry requires a ToWorker_Reset extension in M3+).
    // ponytail: hard-coded lab seed; parameterise reset in M3 when needed
    core = new WorkerCore(42);
  }
};

// Drive the sim at MS_PER_TICK regardless of message rate.
setInterval(() => {
  if (!core) return;
  const snaps = core.advance(MS_PER_TICK);
  for (const snapshot of snaps) {
    const msg: FromWorker = { type: "snapshot", snapshot };
    self.postMessage(msg);
  }
}, MS_PER_TICK);
```

- [ ] **Step 4: Run tests — expected to pass**

```
npm test
```

Expected: all three `WorkerCore` cases pass.

- [ ] **Step 5: Commit**

```
feat(apps/web): WorkerCore fixed-step sim driver and sim-worker glue
```

---

### Task 20: Babylon greybox render (NullEngine-tested)

**Files:**
- Create: `apps/web/src/render/interp.ts`
- Create: `apps/web/src/render/engine.ts`
- Create: `apps/web/src/render/meshes.ts`
- Create: `apps/web/src/render/renderer.ts`
- Create: `apps/web/src/render/interp.test.ts`
- Create: `apps/web/src/render/render.test.ts`

**Interfaces:**
- Consumes: `@babylonjs/core` (`Engine`, `NullEngine`, `Scene`, `ArcRotateCamera`, `HemisphericLight`, `Vector3`, `MeshBuilder`, `Mesh`); `@pact/protocol` (`Snapshot`, `SnapshotEntity`).
- Produces: `lerp` (pure); `createScene`; `makeMesh`; `SnapshotRenderer` (keyed by entity id, interpolates positions between ticks).

**Coordinate map:** sim `x` → `mesh.position.x`; sim `y` → `mesh.position.z` (ground plane); `mesh.position.y` is lifted per kind (player/monster: 0.5, rare: 1.0, projectile: 0.3, groundArea: 0.05).

- [ ] **Step 1: Write failing tests first**

`apps/web/src/render/interp.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lerp } from "./interp";

describe("lerp", () => {
  it("midpoint", () => expect(lerp(0, 10, 0.5)).toBe(5));
  it("alpha 0 returns a", () => expect(lerp(3, 7, 0)).toBe(3));
  it("alpha 1 returns b", () => expect(lerp(3, 7, 1)).toBe(7));
  it("clamps below 0", () => expect(lerp(0, 10, -0.5)).toBe(0));
  it("clamps above 1", () => expect(lerp(0, 10, 1.5)).toBe(10));
});
```

`apps/web/src/render/render.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { NullEngine, Scene } from "@babylonjs/core";
import { createScene } from "./engine";
import { SnapshotRenderer } from "./renderer";
import type { Snapshot } from "@pact/protocol";

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    tick: 1,
    player: {
      id: 0,
      x: 0,
      y: 0,
      life: 100,
      maxLife: 100,
      mana: 60,
      maxMana: 60,
      cooldowns: {},
      alive: true,
    },
    entities: [],
    ...overrides,
  };
}

let engine: InstanceType<typeof NullEngine>;

afterEach(() => {
  engine?.dispose();
});

describe("SnapshotRenderer", () => {
  it("creates a mesh for the player on first apply", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const snap = makeSnapshot({ player: { id: 0, x: 2, y: 3, life: 100, maxLife: 100, mana: 60, maxMana: 60, cooldowns: {}, alive: true } });
    renderer.apply(null, snap, 1);

    // Player mesh positioned at x=2, z=3
    const playerMesh = scene.getMeshByName("entity-0");
    expect(playerMesh).not.toBeNull();
    expect(playerMesh!.position.x).toBeCloseTo(2);
    expect(playerMesh!.position.z).toBeCloseTo(3);
  });

  it("creates meshes for each entity and places them correctly", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const snap = makeSnapshot({
      entities: [
        { id: 1, kind: "monster", x: 5, y: -2 },
        { id: 2, kind: "projectile", x: 1, y: 1, radius: 0.4 },
      ],
    });
    renderer.apply(null, snap, 1);

    const m1 = scene.getMeshByName("entity-1");
    const m2 = scene.getMeshByName("entity-2");
    expect(m1).not.toBeNull();
    expect(m1!.position.x).toBeCloseTo(5);
    expect(m1!.position.z).toBeCloseTo(-2);
    expect(m2).not.toBeNull();
  });

  it("disposes the mesh when an entity disappears in a subsequent snapshot", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const snap1 = makeSnapshot({
      entities: [{ id: 1, kind: "monster", x: 0, y: 0 }],
    });
    renderer.apply(null, snap1, 1);
    expect(scene.getMeshByName("entity-1")).not.toBeNull();

    const snap2 = makeSnapshot({ entities: [] });
    renderer.apply(snap1, snap2, 1);
    expect(scene.getMeshByName("entity-1")).toBeNull();
  });

  it("monster count matches entity list", () => {
    engine = new NullEngine();
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    const snap = makeSnapshot({
      entities: [
        { id: 1, kind: "monster", x: 1, y: 0 },
        { id: 2, kind: "monster", x: 2, y: 0 },
        { id: 3, kind: "monster", x: 3, y: 0 },
      ],
    });
    renderer.apply(null, snap, 1);

    const monsters = scene.meshes.filter((m) =>
      [1, 2, 3].includes(parseInt(m.name.replace("entity-", ""), 10)),
    );
    expect(monsters.length).toBe(3);
  });
});
```

Run: `npm test` — **expected to fail** (modules do not exist).

- [ ] **Step 2: Create `apps/web/src/render/interp.ts`**

```ts
/** Pure linear interpolation, clamped to [0,1]. */
export function lerp(a: number, b: number, alpha: number): number {
  const t = Math.max(0, Math.min(1, alpha));
  return a + (b - a) * t;
}
```

- [ ] **Step 3: Create `apps/web/src/render/engine.ts`**

```ts
import {
  ArcRotateCamera,
  HemisphericLight,
  Scene,
  Vector3,
  type Engine,
} from "@babylonjs/core";

export interface SceneHandle {
  scene: Scene;
  camera: ArcRotateCamera;
}

export function createScene(engine: Engine): SceneHandle {
  const scene = new Scene(engine);

  // Top-down-ish camera: positioned above the origin, looking down at the
  // ground plane (xz). Alpha=0, beta=π/4 gives a comfortable isometric feel.
  const camera = new ArcRotateCamera(
    "cam",
    0,
    Math.PI / 4,
    30,
    Vector3.Zero(),
    scene,
  );
  camera.lowerRadiusLimit = 5;
  camera.upperRadiusLimit = 80;

  new HemisphericLight("sun", new Vector3(0, 1, 0), scene);

  return { scene, camera };
}
```

- [ ] **Step 4: Create `apps/web/src/render/meshes.ts`**

```ts
import { MeshBuilder, type Mesh, type Scene } from "@babylonjs/core";

export type MeshKind = "player" | "monster" | "rare" | "projectile" | "groundArea";

/** Y-lift off the ground plane per kind (render only). */
const Y_LIFT: Record<MeshKind, number> = {
  player: 0.5,
  monster: 0.5,
  rare: 1.0,
  projectile: 0.3,
  groundArea: 0.05,
};

export { Y_LIFT };

export function makeMesh(scene: Scene, kind: MeshKind, name: string): Mesh {
  switch (kind) {
    case "player":
      return MeshBuilder.CreateCapsule(name, { radius: 0.4, height: 1.8 }, scene);
    case "rare":
      return MeshBuilder.CreateBox(name, { width: 0.9, height: 2.0, depth: 0.9 }, scene);
    case "monster":
      return MeshBuilder.CreateBox(name, { size: 0.8 }, scene);
    case "projectile":
      return MeshBuilder.CreateSphere(name, { diameter: 0.3 }, scene);
    case "groundArea":
      return MeshBuilder.CreateCylinder(name, { diameter: 5, height: 0.1, tessellation: 24 }, scene);
  }
}
```

- [ ] **Step 5: Create `apps/web/src/render/renderer.ts`**

```ts
import type { Scene } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core";
import type { Snapshot, SnapshotEntity } from "@pact/protocol";
import { makeMesh, Y_LIFT } from "./meshes";
import type { MeshKind } from "./meshes";
import { lerp } from "./interp";

function kindOf(e: SnapshotEntity): MeshKind {
  if (e.kind === "monster") return e.rare ? "rare" : "monster";
  if (e.kind === "projectile") return "projectile";
  return "groundArea";
}

export class SnapshotRenderer {
  private readonly scene: Scene;
  // keyed by entity id (player id = player.id)
  private readonly meshes = new Map<number, Mesh>();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  apply(prev: Snapshot | null, next: Snapshot, alpha: number): void {
    // Collect the full set of ids that should exist after this call
    const liveIds = new Set<number>();

    // Player
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
      );
    }

    // Dispose meshes for entities that no longer exist
    for (const [id, mesh] of this.meshes) {
      if (!liveIds.has(id)) {
        mesh.dispose();
        this.meshes.delete(id);
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
  ): void {
    let mesh = this.meshes.get(id);
    if (!mesh) {
      mesh = makeMesh(this.scene, kind, `entity-${id}`);
      this.meshes.set(id, mesh);
    }
    mesh.position.x = lerp(prevX, nextX, alpha);
    mesh.position.z = lerp(prevY, nextY, alpha);
    mesh.position.y = Y_LIFT[kind];
  }
}
```

- [ ] **Step 6: Run tests — expected to pass**

```
npm test
```

Expected: `interp.test.ts` (5 cases) and `render.test.ts` (4 cases) all green.

- [ ] **Step 7: Commit**

```
feat(apps/web): greybox render — lerp, createScene, makeMesh, SnapshotRenderer
```

---

### Task 21: input mapping

**Files:**
- Create: `apps/web/src/input/intents.ts`
- Create: `apps/web/src/input/bindings.ts`
- Create: `apps/web/src/input/intents.test.ts`

**Interfaces:**
- Consumes: `@pact/protocol` (`Intent`); `@pact/fixed-point` (`fp`, `Fixed`).
- Produces: pure `keyToIntent` and `pointerToWorld`; thin DOM `attachBindings` (no test — exercised in Task 23).

- [ ] **Step 1: Write failing tests first**

`apps/web/src/input/intents.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { keyToIntent, pointerToWorld } from "./intents";
import { fp } from "@pact/fixed-point";

describe("keyToIntent", () => {
  const aim = { x: 0, y: 0 };

  it("w → moveDir north (+y)", () => {
    const i = keyToIntent("w", aim);
    expect(i).toEqual({ kind: "moveDir", dx: 0, dy: 1 });
  });
  it("s → moveDir south (-y)", () => {
    const i = keyToIntent("s", aim);
    expect(i).toEqual({ kind: "moveDir", dx: 0, dy: -1 });
  });
  it("a → moveDir west (-x)", () => {
    const i = keyToIntent("a", aim);
    expect(i).toEqual({ kind: "moveDir", dx: -1, dy: 0 });
  });
  it("d → moveDir east (+x)", () => {
    const i = keyToIntent("d", aim);
    expect(i).toEqual({ kind: "moveDir", dx: 1, dy: 0 });
  });

  it("1 → useSkill ember_bolt aimed at aim point", () => {
    const aimPt = { x: 3.2, y: -1.7 };
    const i = keyToIntent("1", aimPt);
    expect(i).toEqual({
      kind: "useSkill",
      skillId: "skill.ember_bolt.v1",
      tx: fp(3.2),
      ty: fp(-1.7),
    });
  });
  it("2 → useSkill cinder_ground", () => {
    const i = keyToIntent("2", aim);
    expect(i?.kind).toBe("useSkill");
    expect((i as { skillId: string }).skillId).toBe("skill.cinder_ground.v1");
  });
  it("3 → useSkill blink", () => {
    const i = keyToIntent("3", aim);
    expect(i?.kind).toBe("useSkill");
    expect((i as { skillId: string }).skillId).toBe("skill.blink.v1");
  });

  it("unmapped key → null", () => {
    expect(keyToIntent("q", aim)).toBeNull();
    expect(keyToIntent("Enter", aim)).toBeNull();
  });
});

describe("pointerToWorld", () => {
  it("maps Babylon xz pick coords to sim Fixed xy", () => {
    const result = pointerToWorld({ x: 3.2, z: -1.7 });
    expect(result).toEqual({ x: fp(3.2), y: fp(-1.7) });
  });
});
```

Run: `npm test` — **expected to fail**.

- [ ] **Step 2: Create `apps/web/src/input/intents.ts`**

```ts
import type { Intent } from "@pact/protocol";
import { fp } from "@pact/fixed-point";

const SKILL_KEYS: Record<string, string> = {
  "1": "skill.ember_bolt.v1",
  "2": "skill.cinder_ground.v1",
  "3": "skill.blink.v1",
};

const MOVE_KEYS: Record<string, { dx: -1 | 0 | 1; dy: -1 | 0 | 1 }> = {
  w: { dx: 0, dy: 1 },
  s: { dx: 0, dy: -1 },
  a: { dx: -1, dy: 0 },
  d: { dx: 1, dy: 0 },
};

/**
 * Pure: map a KeyboardEvent.key + current world-space aim point to an Intent.
 * Returns null for unmapped keys.
 * `aim` is in world-space floats (already converted from screen via pointerToWorld).
 */
export function keyToIntent(
  key: string,
  aim: { x: number; y: number },
): Intent | null {
  const move = MOVE_KEYS[key];
  if (move) return { kind: "moveDir", ...move };

  const skillId = SKILL_KEYS[key];
  if (skillId) {
    return { kind: "useSkill", skillId, tx: fp(aim.x), ty: fp(aim.y) };
  }

  return null;
}

/**
 * Pure: convert a Babylon ground-plane pick result (world x, z) to sim Fixed coords.
 * Sim y maps to Babylon z (ground plane).
 */
export function pointerToWorld(pick: {
  x: number;
  z: number;
}): { x: ReturnType<typeof fp>; y: ReturnType<typeof fp> } {
  return { x: fp(pick.x), y: fp(pick.z) };
}
```

- [ ] **Step 3: Create `apps/web/src/input/bindings.ts`**

```ts
import type { ToWorker } from "@pact/protocol";
import { keyToIntent, pointerToWorld } from "./intents";
import type { Scene } from "@babylonjs/core";

// ponytail: thin DOM glue — no logic here; all mapping is in intents.ts

/** Current world-space aim (updated on pointermove via ground-plane raycast). */
let aimWorld = { x: 0, y: 0 };

/**
 * Attach keyboard + pointer listeners to the canvas.
 * Requires an initialised Babylon scene for ground-plane raycasting.
 * Returns a cleanup function.
 */
export function attachBindings(
  canvas: HTMLCanvasElement,
  worker: Worker,
  scene: Scene,
): () => void {
  function onKeyDown(e: KeyboardEvent) {
    const intent = keyToIntent(e.key, aimWorld);
    if (!intent) return;
    const msg: ToWorker = { type: "intent", intent };
    worker.postMessage(msg);
  }

  function onPointerMove(e: PointerEvent) {
    const pick = scene.pick(e.clientX, e.clientY);
    if (pick.hit && pick.pickedPoint) {
      aimWorld = pointerToWorld({
        x: pick.pickedPoint.x,
        z: pick.pickedPoint.z,
      });
    }
  }

  function onClick(e: MouseEvent) {
    const pick = scene.pick(e.clientX, e.clientY);
    if (pick.hit && pick.pickedPoint) {
      const world = pointerToWorld({
        x: pick.pickedPoint.x,
        z: pick.pickedPoint.z,
      });
      const msg: ToWorker = {
        type: "intent",
        intent: { kind: "moveTo", x: world.x, y: world.y },
      };
      worker.postMessage(msg);
    }
  }

  window.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("click", onClick);

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("click", onClick);
  };
}
```

- [ ] **Step 4: Run tests — expected to pass**

```
npm test
```

Expected: all 8 `intents.test.ts` cases pass.

- [ ] **Step 5: Commit**

```
feat(apps/web): pure input mapping — keyToIntent, pointerToWorld, bindings
```

---

### Task 22: combat HUD + App wiring

**Files:**
- Create: `apps/web/src/hud/Hud.tsx`
- Create: `apps/web/src/hud/Hud.test.tsx`
- Rewrite: `apps/web/src/App.tsx` (replaces the Task 18 stub)

**Interfaces:**
- Consumes: `@pact/protocol` (`Snapshot`); `@babylonjs/core` (`Engine`); all render, worker, input modules from Tasks 19–21.
- Produces: `Hud` component (testable in jsdom); fully wired `App` (verified manually in Task 23).

- [ ] **Step 1: Write failing tests first**

`apps/web/src/hud/Hud.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { Hud } from "./Hud";
import type { Snapshot } from "@pact/protocol";

function makeSnap(overrides: {
  life?: number;
  maxLife?: number;
  cooldowns?: Record<string, number>;
}): Snapshot {
  return {
    tick: 1,
    player: {
      id: 0,
      x: 0,
      y: 0,
      life: overrides.life ?? 100,
      maxLife: overrides.maxLife ?? 100,
      mana: 30,
      maxMana: 60,
      cooldowns: overrides.cooldowns ?? {},
      alive: true,
    },
    entities: [],
  };
}

describe("Hud", () => {
  it("renders null snapshot without crashing", () => {
    render(<Hud snapshot={null} />);
    // no assertion needed — just must not throw
  });

  it("life bar width reflects life/maxLife ratio", () => {
    const { getByTestId } = render(<Hud snapshot={makeSnap({ life: 50, maxLife: 100 })} />);
    const bar = getByTestId("life-bar-fill");
    expect(bar).toHaveStyle({ width: "50%" });
  });

  it("skill with cooldown shows remaining seconds", () => {
    const snap = makeSnap({ cooldowns: { "skill.ember_bolt.v1": 1.5 } });
    render(<Hud snapshot={snap} />);
    expect(screen.getByText("1.5s")).toBeInTheDocument();
  });

  it("skill with cooldown 0 shows Ready", () => {
    const snap = makeSnap({ cooldowns: { "skill.ember_bolt.v1": 0 } });
    render(<Hud snapshot={snap} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("skill with no cooldown entry shows Ready", () => {
    const snap = makeSnap({ cooldowns: {} });
    render(<Hud snapshot={snap} />);
    const readyLabels = screen.getAllByText("Ready");
    // All three skill slots should show Ready when no cooldowns present
    expect(readyLabels.length).toBe(3);
  });
});
```

Run: `npm test` — **expected to fail**.

- [ ] **Step 2: Create `apps/web/src/hud/Hud.tsx`**

```tsx
import React from "react";
import type { Snapshot } from "@pact/protocol";

const SKILL_SLOTS = [
  { id: "skill.ember_bolt.v1", label: "Ember Bolt" },
  { id: "skill.cinder_ground.v1", label: "Cinder Ground" },
  { id: "skill.blink.v1", label: "Blink" },
] as const;

interface HudProps {
  snapshot: Snapshot | null;
}

export function Hud({ snapshot }: HudProps) {
  if (!snapshot) return null;

  const { life, maxLife, mana, maxMana, cooldowns } = snapshot.player;
  const lifePct = maxLife > 0 ? (life / maxLife) * 100 : 0;
  const manaPct = maxMana > 0 ? (mana / maxMana) * 100 : 0;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 16,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        pointerEvents: "none",
        userSelect: "none",
      }}
    >
      {/* Resource bars */}
      <div style={{ display: "flex", gap: 8 }}>
        <div
          data-testid="life-bar"
          style={{ width: 180, height: 14, background: "#333", borderRadius: 4, overflow: "hidden" }}
        >
          <div
            data-testid="life-bar-fill"
            style={{ width: `${lifePct}%`, height: "100%", background: "#c0392b" }}
          />
        </div>
        <div
          data-testid="mana-bar"
          style={{ width: 120, height: 14, background: "#333", borderRadius: 4, overflow: "hidden" }}
        >
          <div
            data-testid="mana-bar-fill"
            style={{ width: `${manaPct}%`, height: "100%", background: "#2980b9" }}
          />
        </div>
      </div>

      {/* Skill slots */}
      <div style={{ display: "flex", gap: 8 }}>
        {SKILL_SLOTS.map((slot, idx) => {
          const cd = cooldowns[slot.id] ?? 0;
          const ready = cd <= 0;
          return (
            <div
              key={slot.id}
              data-testid={`skill-slot-${idx + 1}`}
              style={{
                width: 56,
                height: 56,
                background: ready ? "#4a4a4a" : "#2a2a2a",
                border: `2px solid ${ready ? "#aaa" : "#555"}`,
                borderRadius: 6,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: ready ? "#fff" : "#888",
                fontSize: 11,
              }}
            >
              <span>{idx + 1}</span>
              <span>{ready ? "Ready" : `${cd.toFixed(1)}s`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `apps/web/src/App.tsx` — full wiring**

```tsx
import React, { useEffect, useRef, useState } from "react";
import { Engine } from "@babylonjs/core";
import { createScene } from "./render/engine";
import { SnapshotRenderer } from "./render/renderer";
import { attachBindings } from "./input/bindings";
import { Hud } from "./hud/Hud";
import type { Snapshot, FromWorker } from "@pact/protocol";

const LAB_SEED = 42;
// ponytail: fixed seed for the lab; M3 will thread seed from game state
const MS_PER_TICK = 1000 / 30;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Spawn sim worker
    const worker = new Worker(
      new URL("./worker/sim-worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.postMessage({ type: "init", seed: LAB_SEED });

    let prevSnap: Snapshot | null = null;
    let curSnap: Snapshot | null = null;
    let prevTickTime = performance.now();

    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      if (msg.type === "snapshot") {
        prevSnap = curSnap;
        curSnap = msg.snapshot;
        prevTickTime = performance.now();
        setSnapshot(msg.snapshot);
      }
    };

    // Babylon engine + render loop
    const engine = new Engine(canvas, true);
    const { scene } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    engine.runRenderLoop(() => {
      if (!curSnap) return;
      // ponytail: float alpha for lerp — never fed into sim
      const alpha = Math.min(1, (performance.now() - prevTickTime) / MS_PER_TICK);
      renderer.apply(prevSnap, curSnap, alpha);
      scene.render();
    });

    window.addEventListener("resize", () => engine.resize());

    // Input bindings (keydown, pointermove, click)
    const detach = attachBindings(canvas, worker, scene);

    return () => {
      detach();
      engine.dispose();
      worker.terminate();
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      <Hud snapshot={snapshot} />
    </div>
  );
}
```

- [ ] **Step 4: Run tests — expected to pass**

```
npm test
```

Expected: all 5 `Hud.test.tsx` cases pass; `App.test.tsx` (Task 18 canvas check) still passes.

- [ ] **Step 5: Commit**

```
feat(apps/web): combat HUD component and full App wiring
```

---

### Task 23: end-to-end verification + run docs

**Files:**
- Create: `apps/web/README.md`

**Interfaces:**
- Consumes: everything built in Tasks 18–22.
- Produces: verified CI green + a playable greybox arena (Approach A gate).

> This task contains no red-green test cycle. All steps are verification gates.

- [ ] **Step 1: Full typecheck**

```
npm run typecheck
```

Expected: exit 0, no TS errors across all packages and `apps/web`.

- [ ] **Step 2: Full test suite**

```
npm test
```

Expected: all suites green, including:
- `packages/fixed-point/**/*.test.ts` (isqrt, fpStepToward, fpDist2)
- `packages/protocol/**/*.test.ts` (validateIntent, isToWorker)
- `packages/rules/**/*.test.ts` (applyDamage, refreshBurning, burningTickDamage, makeRare)
- `packages/content-schema/**/*.test.ts` (validateSkillDef, validateMonsterDef)
- `packages/content-runtime/**/*.test.ts` (SKILLS, MONSTERS, RARE_TEMPLATE content values)
- `packages/simulation/**/*.test.ts` (determinism, checksum, combat systems golden)
- `apps/web/src/App.test.tsx` (canvas present)
- `apps/web/src/worker/worker-core.test.ts` (3 ticks, determinism, moveTo)
- `apps/web/src/render/interp.test.ts` (lerp 5 cases)
- `apps/web/src/render/render.test.ts` (NullEngine mesh lifecycle 4 cases)
- `apps/web/src/input/intents.test.ts` (keyToIntent 8 cases)
- `apps/web/src/hud/Hud.test.tsx` (5 cases)

- [ ] **Step 3: Build**

```
npm run build -w apps/web
```

Expected: Vite build succeeds, `apps/web/dist/` produced with `index.html` + hashed assets. The sim worker bundle emits as a separate ES module chunk.

- [ ] **Step 4: Create `apps/web/README.md`**

```markdown
# Combat Lab — local dev

## Run

```bash
npm install           # from repo root (workspace hoisting)
npm run dev -w apps/web
```

Open the URL printed by Vite (default: `http://localhost:5173`).

## Manual verification checklist

Open in Chromium and confirm:

- [ ] The arena renders: a flat ground plane with greybox meshes visible.
- [ ] **Click-to-move**: left-click anywhere on the ground — the player capsule moves toward that point.
- [ ] **WASD**: holding W/A/S/D moves the player continuously in the expected direction.
- [ ] **Skill 1 (Ember Bolt)**: press `1` — a sphere projectile fires toward the cursor; on contact with a Cinder Imp the monster takes damage (life bar shrinks).
- [ ] **Skill 2 (Cinder Ground)**: press `2` — a flat disc appears at the cursor; Cinder Imps standing in it acquire burning stacks (ailmentStacks visible in HUD/debug or inferred from faster death).
- [ ] **Skill 3 (Blink)**: press `3` — the player teleports toward the cursor by ~5 units.
- [ ] **Rare Cinder Imp**: the one taller box-shaped monster visibly survives significantly more hits than the normal imps (2.5× life, +30 fire res).
- [ ] **Cinder Ground lingering burn**: a monster that walks out of the disc continues taking damage for ~2 seconds (burning ailment expiry).
- [ ] **HUD life bar** updates as the player takes damage from monster attacks.
- [ ] **HUD mana bar** decreases on skill use and regenerates over time.
- [ ] **HUD cooldown slots** show the remaining cooldown in seconds after each skill use; slot shows "Ready" when the cooldown expires.
- [ ] **Player death**: when the player's life reaches 0, the player respawns at the origin with full life and mana on the next tick.

## Architecture note

This is the Approach A "playable greybox arena" gate (Milestone 2). The full
Hideout → Atlas → Mapping loop is Milestone 5. The sim worker is authoritative;
the client sends `Intent`s only and never mutates sim state.
```

- [ ] **Step 5: Commit**

```
docs(apps/web): add run instructions and manual verification checklist
```

---
<!-- end Phase D -->
