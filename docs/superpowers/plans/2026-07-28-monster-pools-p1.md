# Per-biome Monster Pools — P1 (Fight Layer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each of the four biomes its own three monster species, drawn from four behavioural archetypes, so a Desert map asks something different of the player than a Swamp one.

**Architecture:** Four archetypes (`swarm`, `brute`, `shooter`, `heavy`) defined in content, not in code. `swarm` and `brute` are the existing chase-and-melee behaviour with different numbers and need no new sim code. `shooter` reuses the existing `projectileMove` system, which only needs its collision query widened from "monsters" to "anything damageable on another team". `heavy` reuses the existing `telegraphResolve` system, which is already fully faction-generic — only the *spawn* half of the boss's slam is copied into trash AI. No new sim systems are registered.

**Tech Stack:** TypeScript, npm workspaces, Vitest. Deterministic fixed-point integer sim at 30 Hz.

**Spec:** `docs/specs/2026-07-28-monster-pools-design.md`. Read it before Task 1.

## Global Constraints

- **Sim math is deterministic fixed-point integers.** Never `Math.random()`, never floats in the sim. Randomness comes from `mulberry32(seed ^ constant)`, the idiom used by `rules/items.ts`, `rules/waystone.ts`, `rules/vendor.ts`.
- **`@exiled/rules` is a pure leaf.** It must not import any other `@exiled` package. Nothing in this plan touches it.
- **`CONTENT_VERSION` is not bumped.** It seeds `generateArea`; changing it would reshuffle every layout in the game.
- **No new sim systems are registered.** Ranged reuses `projectileMove`; heavy reuses `telegraphResolve`.
- **Loot rolls on the killing blow** (`docs/09-reward-psychology.md` §4 rule 8). Nothing in this plan may delay a drop.
- **Test command:** `npx vitest run <scope>` from repo root. **Typecheck:** `npm run typecheck` — vitest strips types, so this is mandatory and is not optional at the end of any task.
- **Commit style:** direct to `main`, one commit per task, no attribution trailers, no emdashes in messages.
- Fixed-point helper: `fp(2.4)` converts a human number to Fixed. Per-tick speed is `Math.trunc(fixedPerSecond / 30)`.

---

### Task 1: Archetypes in the schema

**Files:**
- Modify: `packages/content-schema/src/index.ts` (`BossSpec` at :93-110, `MonsterDef` at :112-123, `validateMonsterDef` at :269+)
- Modify: `packages/content-runtime/src/monsters.ts` (both existing defs)
- Test: `packages/content-schema/src/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MonsterArchetype`, `MONSTER_ARCHETYPES`, `SlamSpec`, `RangedSpec`; `MonsterDef.archetype` (required), `MonsterDef.ranged?`, `MonsterDef.heavy?`.

- [ ] **Step 1: Write the failing tests**

In `packages/content-schema/src/schema.test.ts`, next to the existing `validateMonsterDef` tests. The file already defines a valid base monster object at :29 — reuse that shape.

```ts
describe("validateMonsterDef archetypes", () => {
  const base = {
    id: "monster.test_thing.v1",
    name: "Test Thing",
    archetype: "swarm" as const,
    maxLifeFixed: fp(40), moveSpeedFixed: fp(2.4), attackRangeFixed: fp(1.2),
    attackDamage: { type: "physical" as const, amountFixed: fp(6) },
    attackCooldownTicks: 45, radiusFixed: fp(0.5),
    defenses: { resPct: resBlock(), armourFixed: fp(0.5) },
  };

  it("accepts a valid swarm", () => {
    expect(validateMonsterDef(base).ok).toBe(true);
  });

  it("rejects a missing archetype", () => {
    const { archetype, ...noArch } = base;
    const r = validateMonsterDef(noArch);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/archetype/);
  });

  it("rejects an unknown archetype", () => {
    const r = validateMonsterDef({ ...base, archetype: "sniper" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/archetype/);
  });

  it("rejects a shooter with no ranged spec", () => {
    const r = validateMonsterDef({ ...base, archetype: "shooter" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/ranged/);
  });

  it("accepts a shooter with a ranged spec", () => {
    const r = validateMonsterDef({
      ...base, archetype: "shooter",
      ranged: { speedFixed: fp(9), radiusFixed: fp(0.22) },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a ranged spec on a non-shooter", () => {
    const r = validateMonsterDef({
      ...base, ranged: { speedFixed: fp(9), radiusFixed: fp(0.22) },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/ranged/);
  });

  it("rejects a heavy with no slam", () => {
    const r = validateMonsterDef({ ...base, archetype: "heavy" });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/heavy/);
  });

  it("accepts a heavy with a slam", () => {
    const r = validateMonsterDef({
      ...base, archetype: "heavy",
      heavy: { windupTicks: 30, radiusFixed: fp(2.6), damageFixed: fp(22), cooldownTicks: 150, rangeFixed: fp(6.5) },
    });
    expect(r.ok).toBe(true);
  });

  it("rejects a slam on a non-heavy", () => {
    const r = validateMonsterDef({
      ...base,
      heavy: { windupTicks: 30, radiusFixed: fp(2.6), damageFixed: fp(22), cooldownTicks: 150, rangeFixed: fp(6.5) },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/heavy/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/content-schema`
Expected: FAIL — the archetype tests fail because the validator ignores the field (`rejects a missing archetype` reports ok=true).

- [ ] **Step 3: Add the types**

In `packages/content-schema/src/index.ts`, above `BossSpec`:

```ts
/**
 * What a monster asks of the player. The number of an archetype is a statement
 * about the monster, so the archetype and not the layout decides how many stand
 * at a socket (see PACK_COUNT in content-runtime).
 *
 * `swarm` punishes fighting one at a time, `brute` punishes trading hits,
 * `shooter` punishes standing still, `heavy` punishes standing close.
 */
export const MONSTER_ARCHETYPES = ["swarm", "brute", "shooter", "heavy"] as const;
export type MonsterArchetype = (typeof MONSTER_ARCHETYPES)[number];

/**
 * A wind-up, a radius, a hit. Extracted verbatim from what BossSpec.slam already
 * was: the boss's slam and a heavy's slam are the same five numbers and must not
 * become two types that drift apart.
 */
export interface SlamSpec {
  windupTicks: number;
  radiusFixed: Fixed;
  damageFixed: Fixed;
  cooldownTicks: number;
  rangeFixed: Fixed;
}

/** A shooter's bolt. `speedFixed` is per second; the sim divides by 30, as it does for moveSpeed. */
export interface RangedSpec {
  speedFixed: Fixed;
  radiusFixed: Fixed;
}
```

Change `BossSpec.slam` to use it (the shape is identical, so nothing else moves):

```ts
export interface BossSpec {
  phase2AtLifePct: number;
  slam: SlamSpec;
  phase2: {
    fireGroundDurationTicks: number;
    addCount: number;
    addDefId: string;
    cadenceMulPct: number;
    fireGround: AilmentSpec;
  };
}
```

Add to `MonsterDef`, after `defenses`:

```ts
  archetype: MonsterArchetype;
  /** Required iff archetype === "shooter", forbidden otherwise. */
  ranged?: RangedSpec;
  /** Required iff archetype === "heavy", forbidden otherwise. Distinct from
   *  BossSpec.slam: `boss` being present is what makes a monster a boss. */
  heavy?: SlamSpec;
```

- [ ] **Step 4: Add the validator rules**

In `validateMonsterDef`, immediately after the `validateDamageSpec(v["attackDamage"], ...)` call and before the `boss` block:

```ts
  const archetype = v["archetype"];
  const knownArchetype =
    typeof archetype === "string" &&
    (MONSTER_ARCHETYPES as readonly string[]).includes(archetype);
  if (!knownArchetype) {
    errors.push(
      `archetype: must be one of ${MONSTER_ARCHETYPES.join(", ")}, got "${String(archetype)}"`,
    );
  }
  // A spec and its archetype are one statement, so each implies the other: a
  // shooter with no bolt would silently melee, and a bolt on a brute would never
  // fire. Both are content bugs that only show up in play.
  validateSubSpec(v["ranged"], archetype === "shooter", "ranged",
    ["speedFixed", "radiusFixed"], errors);
  validateSubSpec(v["heavy"], archetype === "heavy", "heavy",
    ["windupTicks", "radiusFixed", "damageFixed", "cooldownTicks", "rangeFixed"], errors);
```

And a helper beside `validateMonsterDef`:

```ts
/** Present-iff-required check for an all-non-negative-integer sub-spec. */
function validateSubSpec(
  v: unknown, required: boolean, field: string,
  numericFields: readonly string[], errors: string[],
): void {
  if (v === undefined) {
    if (required) errors.push(`${field}: required for this archetype`);
    return;
  }
  if (!required) {
    errors.push(`${field}: only valid on its own archetype`);
    return;
  }
  if (!isObj(v)) {
    errors.push(`${field}: must be an object`);
    return;
  }
  const o = v as Record<string, unknown>;
  for (const f of numericFields) {
    if (!isNonNegInt(o[f])) errors.push(`${field}.${f}: must be a non-negative integer`);
  }
}
```

- [ ] **Step 5: Give the two existing defs their archetype**

In `packages/content-runtime/src/monsters.ts`: add `archetype: "swarm",` to `monster.cinder_imp.v1` and `archetype: "brute",` to `monster.cinder_warden.v1`, each on the line after `name`. The Warden keeps its `boss` block and gains no `heavy` block — a boss's slam lives in `BossSpec`.

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run packages/content-schema packages/content-runtime`
Expected: PASS, including the eight new archetype tests.
Run: `npm run typecheck`
Expected: rc=0. If `MonsterDef` literals elsewhere (test fixtures in `simulation/src/systems/*.test.ts`, `rules/src/rare.test.ts`) now fail to compile, add the correct `archetype` to each — that is the required field doing its job.

- [ ] **Step 7: Commit**

```bash
git add packages/content-schema packages/content-runtime
git commit -m "feat(content): monsters declare an archetype, and its spec comes with it"
```

---

### Task 2: A projectile can hit anything on another team

**Files:**
- Modify: `packages/simulation/src/systems/projectile.ts:19-40`
- Test: `packages/simulation/src/systems/projectile.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `projectileMove` damages any entity with `position` + `health` + `faction` on a team other than the projectile's. Task 5 depends on this.

Today the loop queries `world.query("position", "monster", "faction")`, so a projectile is structurally incapable of hitting the player — not because of a team check (that already exists and already works), but because the player has no `monster` component. This is the root-cause shape: one loop, every projectile source.

- [ ] **Step 1: Write the failing test**

Append to `packages/simulation/src/systems/projectile.test.ts`, following the existing fixture style in that file:

```ts
it("a monster-team bolt damages the player", () => {
  const sim = new Simulation(1);
  registerProjectileMove(sim);
  const world = sim.world;

  const player = world.create();
  world.set<Position>(player, "position", { x: fp(2), y: fp(0) });
  world.set<Health>(player, "health", { life: fp(100), maxLife: fp(100) });
  world.set<Faction>(player, "faction", { team: 0 });
  world.set(player, "player", {});

  const shooter = world.create();
  const proj = world.create();
  world.set<Position>(proj, "position", { x: fp(1), y: fp(0) });
  world.set<ProjectileC>(proj, "projectile", {
    dirx: fp(1), diry: 0, remainingRange: fp(5), radius: fp(0.2),
    damageType: 0, damageAmount: fp(9), ownerId: shooter, team: 1,
  });

  sim.step();
  expect(world.get<Health>(player, "health")!.life).toBeLessThan(fp(100));
});

it("a bolt does not damage its own team", () => {
  const sim = new Simulation(1);
  registerProjectileMove(sim);
  const world = sim.world;

  const ally = world.create();
  world.set<Position>(ally, "position", { x: fp(2), y: fp(0) });
  world.set<Health>(ally, "health", { life: fp(100), maxLife: fp(100) });
  world.set<Faction>(ally, "faction", { team: 1 });

  const shooter = world.create();
  const proj = world.create();
  world.set<Position>(proj, "position", { x: fp(1), y: fp(0) });
  world.set<ProjectileC>(proj, "projectile", {
    dirx: fp(1), diry: 0, remainingRange: fp(5), radius: fp(0.2),
    damageType: 0, damageAmount: fp(9), ownerId: shooter, team: 1,
  });

  sim.step();
  expect(world.get<Health>(ally, "health")!.life).toBe(fp(100));
});
```

The existing tests in this file already cover "a player bolt damages a monster" and must keep passing unchanged — that is the regression half.

- [ ] **Step 2: Run to verify the first new test fails**

Run: `npx vitest run packages/simulation/src/systems/projectile.test.ts`
Expected: FAIL on "a monster-team bolt damages the player" — the player's life is untouched at `fp(100)`, because the query cannot see it.

- [ ] **Step 3: Widen the query**

In `packages/simulation/src/systems/projectile.ts`, replace the collision block:

```ts
      // Anything damageable on another team, not just monsters: the player has
      // no `monster` component, which is the only reason a monster's bolt used
      // to pass straight through. Body radius comes from body.ts so a projectile
      // and a telegraph agree about how wide a target is.
      for (const m of world.query("position", "health", "faction")) {
        const mFaction = world.get<Faction>(m, "faction")!;
        if (mFaction.team === proj.team) continue; // same team
        const mPos = world.get<Position>(m, "position")!;
        const dist2 = fpDist2(nx, ny, mPos.x, mPos.y);
        if (dist2 <= combinedR2Fn(bodyRadiusOf(world, m))) {
          sim.enqueueDamage({
            target: m,
            source: proj.ownerId,
            amountFixed: proj.damageAmount,
            type: proj.damageType,
          });
          newRange = 0; // spent
          break; // first target only
        }
      }
```

Imports become:

```ts
import { isqrt, fpDist2 } from "@exiled/fixed-point";
import { Simulation } from "../loop";
import { bodyRadiusOf } from "../body";
import type { Position, ProjectileC, Faction } from "../components";
```

(`MonsterC` is no longer used here.)

- [ ] **Step 4: Run the whole simulation suite**

Run: `npx vitest run packages/simulation`
Expected: PASS. Pay attention to `combat-sim.test.ts` and `balance.test.ts` — if a player bolt now hits something it did not before, that is a real behaviour change and must be understood, not suppressed.
Run: `npm run typecheck`
Expected: rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/simulation/src/systems/projectile.ts packages/simulation/src/systems/projectile.test.ts
git commit -m "fix(sim): a projectile hits anything on another team, not only monsters"
```

---

### Task 3: The twelve species and the pools

**Files:**
- Modify: `packages/content-runtime/src/monsters.ts`
- Modify: `packages/content-runtime/src/index.ts` (exports)
- Test: `packages/content-runtime/src/content.test.ts`

**Interfaces:**
- Consumes: `MonsterArchetype`, `RangedSpec`, `SlamSpec` from Task 1.
- Produces: 12 new entries in `MONSTERS`; `MONSTER_POOLS: Record<BiomeId, readonly PoolEntry[]>`; `PACK_COUNT: Record<MonsterArchetype, number>`; `pickPack(biomeId: BiomeId, roll: number): MonsterDef`. Task 4 calls `pickPack` and `PACK_COUNT`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/content-runtime/src/content.test.ts`:

```ts
describe("monster pools", () => {
  it("every biome has exactly three species", () => {
    for (const id of BIOME_IDS) {
      expect(MONSTER_POOLS[id].length, id).toBe(3);
    }
  });

  it("every pool entry resolves in MONSTERS", () => {
    for (const id of BIOME_IDS) {
      for (const entry of MONSTER_POOLS[id]) {
        expect(MONSTERS.has(entry.defId), `${id}: ${entry.defId}`).toBe(true);
      }
    }
  });

  it("no biome repeats an archetype", () => {
    for (const id of BIOME_IDS) {
      const kinds = MONSTER_POOLS[id].map((e) => MONSTERS.get(e.defId)!.archetype);
      expect(new Set(kinds).size, id).toBe(3);
    }
  });

  it("no two biomes field the same three archetypes", () => {
    const sigs = BIOME_IDS.map((id) =>
      MONSTER_POOLS[id].map((e) => MONSTERS.get(e.defId)!.archetype).sort().join(","),
    );
    expect(new Set(sigs).size).toBe(BIOME_IDS.length);
  });

  it("every archetype appears in some biome", () => {
    const seen = new Set(
      BIOME_IDS.flatMap((id) => MONSTER_POOLS[id].map((e) => MONSTERS.get(e.defId)!.archetype)),
    );
    expect(seen.size).toBe(MONSTER_ARCHETYPES.length);
  });

  it("every element is answered by an ordinary monster somewhere", () => {
    const types = new Set(
      BIOME_IDS.flatMap((id) =>
        MONSTER_POOLS[id].map((e) => MONSTERS.get(e.defId)!.attackDamage.type),
      ),
    );
    for (const el of ELEMENTS) expect(types.has(el), el).toBe(true);
  });

  it("pickPack is total and deterministic across the whole 0..1 range", () => {
    for (const id of BIOME_IDS) {
      for (let i = 0; i <= 100; i++) {
        const roll = i / 100;
        const a = pickPack(id, roll);
        const b = pickPack(id, roll);
        expect(a.id).toBe(b.id);
        expect(MONSTER_POOLS[id].some((e) => e.defId === a.id)).toBe(true);
      }
    }
  });

  it("pickPack reaches every species in its pool", () => {
    for (const id of BIOME_IDS) {
      const hit = new Set<string>();
      for (let i = 0; i < 1000; i++) hit.add(pickPack(id, i / 1000).id);
      expect(hit.size, id).toBe(3);
    }
  });

  it("a shooter's range is inside AGGRO_RADIUS so a woken shooter can reach the player", () => {
    for (const def of MONSTERS.values()) {
      if (def.archetype !== "shooter") continue;
      expect(def.attackRangeFixed, def.id).toBeLessThan(fp(9));
    }
  });

  it("a heavy's wind-up is long enough to be a decision, not a reflex test", () => {
    for (const def of MONSTERS.values()) {
      if (def.archetype !== "heavy") continue;
      expect(def.heavy!.windupTicks / 30, def.id).toBeGreaterThanOrEqual(0.75);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/content-runtime`
Expected: FAIL — `MONSTER_POOLS` is not exported and does not exist.

- [ ] **Step 3: Add the twelve defs**

In `packages/content-runtime/src/monsters.ts`, append to `MONSTER_DEFS`. Numbers are the archetype baselines from the spec §8 and are **starting points measured in Task 8**, not final values.

```ts
  // --- Vaal Stone: swarm, brute, heavy. A dead city fields foot soldiers,
  // constructs and one thing that swings something too big for a corridor.
  {
    id: "monster.vaal_husk.v1", name: "Vaal Husk", archetype: "swarm",
    maxLifeFixed: fp(24), moveSpeedFixed: fp(3.0), attackRangeFixed: fp(1.1),
    attackDamage: { type: "physical", amountFixed: fp(4) },
    attackCooldownTicks: 40, radiusFixed: fp(0.42),
    defenses: { resPct: resBlock(), armourFixed: fp(0) },
  },
  {
    id: "monster.vaal_construct.v1", name: "Vaal Construct", archetype: "brute",
    maxLifeFixed: fp(140), moveSpeedFixed: fp(1.45), attackRangeFixed: fp(1.6),
    attackDamage: { type: "physical", amountFixed: fp(13) },
    attackCooldownTicks: 75, radiusFixed: fp(0.85),
    defenses: { resPct: resBlock(), armourFixed: fp(4) },
  },
  {
    id: "monster.blood_sentinel.v1", name: "Blood Sentinel", archetype: "heavy",
    maxLifeFixed: fp(88), moveSpeedFixed: fp(1.8), attackRangeFixed: fp(1.8),
    attackDamage: { type: "chaos", amountFixed: fp(8) },
    attackCooldownTicks: 45, radiusFixed: fp(0.8),
    defenses: { resPct: resBlock({ chaos: 30 }), armourFixed: fp(2) },
    heavy: { windupTicks: 30, radiusFixed: fp(2.6), damageFixed: fp(22), cooldownTicks: 150, rangeFixed: fp(6.5) },
  },

  // --- Desert: swarm, shooter, heavy. Nothing here holds a line; it circles.
  {
    id: "monster.sand_skitterer.v1", name: "Sand Skitterer", archetype: "swarm",
    maxLifeFixed: fp(24), moveSpeedFixed: fp(3.0), attackRangeFixed: fp(1.1),
    attackDamage: { type: "physical", amountFixed: fp(4) },
    attackCooldownTicks: 40, radiusFixed: fp(0.42),
    defenses: { resPct: resBlock({ fire: 20 }), armourFixed: fp(0) },
  },
  {
    id: "monster.dune_spitter.v1", name: "Dune Spitter", archetype: "shooter",
    maxLifeFixed: fp(32), moveSpeedFixed: fp(2.15), attackRangeFixed: fp(7.5),
    attackDamage: { type: "chaos", amountFixed: fp(8) },
    attackCooldownTicks: 70, radiusFixed: fp(0.5),
    defenses: { resPct: resBlock({ chaos: 25 }), armourFixed: fp(0.5) },
    ranged: { speedFixed: fp(9), radiusFixed: fp(0.22) },
  },
  {
    id: "monster.sunbaked_colossus.v1", name: "Sunbaked Colossus", archetype: "heavy",
    maxLifeFixed: fp(88), moveSpeedFixed: fp(1.8), attackRangeFixed: fp(1.8),
    // 25 and not 40: fire is the only element the player owns, and 40% against
    // it is a wall rather than a choice — the same reasoning that set the
    // Warden's fire resistance below.
    attackDamage: { type: "fire", amountFixed: fp(8) },
    attackCooldownTicks: 45, radiusFixed: fp(0.8),
    defenses: { resPct: resBlock({ fire: 25 }), armourFixed: fp(2) },
    heavy: { windupTicks: 30, radiusFixed: fp(2.6), damageFixed: fp(22), cooldownTicks: 150, rangeFixed: fp(6.5) },
  },

  // --- Swamp: brute, shooter, heavy. Slow, wet, and nothing you can outrun in a line.
  {
    id: "monster.bog_drowned.v1", name: "Bog Drowned", archetype: "brute",
    maxLifeFixed: fp(140), moveSpeedFixed: fp(1.45), attackRangeFixed: fp(1.6),
    attackDamage: { type: "physical", amountFixed: fp(13) },
    attackCooldownTicks: 75, radiusFixed: fp(0.85),
    defenses: { resPct: resBlock({ cold: 20 }), armourFixed: fp(3) },
  },
  {
    id: "monster.fen_wisp.v1", name: "Fen Wisp", archetype: "shooter",
    maxLifeFixed: fp(32), moveSpeedFixed: fp(2.15), attackRangeFixed: fp(7.5),
    attackDamage: { type: "lightning", amountFixed: fp(8) },
    attackCooldownTicks: 70, radiusFixed: fp(0.5),
    defenses: { resPct: resBlock({ lightning: 30 }), armourFixed: fp(0.5) },
    ranged: { speedFixed: fp(9), radiusFixed: fp(0.22) },
  },
  {
    id: "monster.rotting_behemoth.v1", name: "Rotting Behemoth", archetype: "heavy",
    maxLifeFixed: fp(88), moveSpeedFixed: fp(1.8), attackRangeFixed: fp(1.8),
    attackDamage: { type: "physical", amountFixed: fp(8) },
    attackCooldownTicks: 45, radiusFixed: fp(0.8),
    defenses: { resPct: resBlock({ chaos: 20 }), armourFixed: fp(2) },
    heavy: { windupTicks: 30, radiusFixed: fp(2.6), damageFixed: fp(22), cooldownTicks: 150, rangeFixed: fp(6.5) },
  },

  // --- Forest: swarm, brute, shooter. The only biome with nothing to dodge,
  // and the only one that never lets you stand still.
  {
    id: "monster.bramble_whelp.v1", name: "Bramble Whelp", archetype: "swarm",
    maxLifeFixed: fp(24), moveSpeedFixed: fp(3.0), attackRangeFixed: fp(1.1),
    attackDamage: { type: "physical", amountFixed: fp(4) },
    attackCooldownTicks: 40, radiusFixed: fp(0.42),
    defenses: { resPct: resBlock(), armourFixed: fp(0) },
  },
  {
    id: "monster.thornhide_boar.v1", name: "Thornhide Boar", archetype: "brute",
    maxLifeFixed: fp(140), moveSpeedFixed: fp(1.45), attackRangeFixed: fp(1.6),
    attackDamage: { type: "physical", amountFixed: fp(13) },
    attackCooldownTicks: 75, radiusFixed: fp(0.85),
    defenses: { resPct: resBlock({ cold: 15 }), armourFixed: fp(3) },
  },
  {
    id: "monster.hoarfrost_spitter.v1", name: "Hoarfrost Spitter", archetype: "shooter",
    maxLifeFixed: fp(32), moveSpeedFixed: fp(2.15), attackRangeFixed: fp(7.5),
    attackDamage: { type: "cold", amountFixed: fp(8) },
    attackCooldownTicks: 70, radiusFixed: fp(0.5),
    defenses: { resPct: resBlock({ cold: 30 }), armourFixed: fp(0.5) },
    ranged: { speedFixed: fp(9), radiusFixed: fp(0.22) },
  },
```

- [ ] **Step 4: Add the pools and the selector**

At the foot of `packages/content-runtime/src/monsters.ts`:

```ts
/**
 * How many of an archetype stand at one spawn socket. Content's number, not the
 * generator's: "a swarm is four" is a fact about the monster. The layout still
 * owns *where* a fight may stand — a modifier must never be able to put a
 * monster inside a wall.
 */
export const PACK_COUNT: Record<MonsterArchetype, number> = {
  swarm: 4, brute: 1, shooter: 2, heavy: 1,
};

export interface PoolEntry { defId: string; weight: number }

/**
 * Three species per biome, and each biome a different three-of-four, so no two
 * biomes ask the same question. A heavy is the rarest roll in any pool because
 * it is the loudest: three in a map is a fight, ten is a chore.
 */
export const MONSTER_POOLS: Record<BiomeId, readonly PoolEntry[]> = {
  vaal_stone: [
    { defId: "monster.vaal_husk.v1", weight: 3 },
    { defId: "monster.vaal_construct.v1", weight: 2 },
    { defId: "monster.blood_sentinel.v1", weight: 1 },
  ],
  desert: [
    { defId: "monster.sand_skitterer.v1", weight: 3 },
    { defId: "monster.dune_spitter.v1", weight: 2 },
    { defId: "monster.sunbaked_colossus.v1", weight: 1 },
  ],
  swamp: [
    { defId: "monster.bog_drowned.v1", weight: 2 },
    { defId: "monster.fen_wisp.v1", weight: 2 },
    { defId: "monster.rotting_behemoth.v1", weight: 1 },
  ],
  forest: [
    { defId: "monster.bramble_whelp.v1", weight: 3 },
    { defId: "monster.thornhide_boar.v1", weight: 2 },
    { defId: "monster.hoarfrost_spitter.v1", weight: 2 },
  ],
};

// Referential integrity at module load, beside the def validation above: a pool
// naming a monster that does not exist is a programmer error, not a runtime one.
for (const [biome, pool] of Object.entries(MONSTER_POOLS)) {
  for (const entry of pool) {
    if (!MONSTERS.has(entry.defId)) {
      throw new Error(`[content-runtime] Pool "${biome}" names unknown monster "${entry.defId}"`);
    }
  }
}

/**
 * Which species fills one spawn socket. Total and deterministic; the caller
 * supplies the randomness, exactly as `rareTemplate` takes an integer, so
 * content never depends on the sim's rng. `roll` is clamped, so an out-of-range
 * value picks an end of the pool rather than throwing mid-run.
 */
export function pickPack(biomeId: BiomeId, roll: number): MonsterDef {
  const pool = MONSTER_POOLS[biomeId];
  const total = pool.reduce((sum, e) => sum + e.weight, 0);
  const clamped = roll < 0 ? 0 : roll >= 1 ? 0.999999 : roll;
  let n = clamped * total;
  for (const entry of pool) {
    n -= entry.weight;
    if (n < 0) return MONSTERS.get(entry.defId)!;
  }
  return MONSTERS.get(pool[pool.length - 1]!.defId)!;
}
```

Imports at the top of the file gain `BiomeId`, `MonsterArchetype` from `@exiled/content-schema`.

- [ ] **Step 5: Export them**

In `packages/content-runtime/src/index.ts`, extend the monsters export:

```ts
export { MONSTERS, RARE_TEMPLATES, rareTemplate, MONSTER_POOLS, PACK_COUNT, pickPack } from "./monsters.js";
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run packages/content-runtime`
Expected: PASS, including all ten new pool tests.
Run: `npm run typecheck`
Expected: rc=0.

- [ ] **Step 7: Commit**

```bash
git add packages/content-runtime
git commit -m "feat(content): twelve species, three per biome, and the pool that picks them"
```

---

### Task 4: Spawn from the biome's pool

**Files:**
- Modify: `packages/simulation/src/areas.ts:73-77` (`PACK_SPREAD`) and `:140-169` (the map branch of `buildArea`)
- Test: `packages/simulation/src/areas.test.ts`

**Interfaces:**
- Consumes: `pickPack`, `PACK_COUNT` from Task 3; `mapBaseIdForNode` from `@exiled/rules` and `mapBase` from `@exiled/content-runtime`, exactly as `systems/area-transition.ts:74` already uses them.
- Produces: pool-driven spawning. No new exported symbols.

- [ ] **Step 1: Write the failing tests**

Append to `packages/simulation/src/areas.test.ts`, following that file's existing world/session fixture style:

```ts
describe("pool-driven spawning", () => {
  const speciesIn = (world: World): string[] =>
    world.query("monster").map((e) => world.get<MonsterC>(e, "monster")!.defId);

  it("spawns only species from the active node's biome pool", () => {
    const { world, session, layout } = mapFixture({ mapSeed: 1234 });
    buildArea(world, "map", session, layout);
    const biome = mapBase(mapBaseIdForNode(session.activeNodeId)).biomeId;
    const allowed = new Set(MONSTER_POOLS[biome].map((e) => e.defId));
    allowed.add("monster.cinder_warden.v1"); // the boss is not from the pool
    for (const id of speciesIn(world)) expect(allowed.has(id), id).toBe(true);
  });

  it("the same map seed spawns the same species in the same order", () => {
    const a = mapFixture({ mapSeed: 99 });
    const b = mapFixture({ mapSeed: 99 });
    buildArea(a.world, "map", a.session, a.layout);
    buildArea(b.world, "map", b.session, b.layout);
    expect(speciesIn(a.world)).toEqual(speciesIn(b.world));
  });

  it("a different map seed can spawn a different mix", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const f = mapFixture({ mapSeed: seed });
      buildArea(f.world, "map", f.session, f.layout);
      seen.add(speciesIn(f.world).join(","));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("a socket holds that archetype's pack count", () => {
    const { world, session, layout } = mapFixture({ mapSeed: 7 });
    buildArea(world, "map", session, layout);
    // Group the non-boss monsters by species and check each count is a whole
    // multiple of that archetype's pack count.
    const counts = new Map<string, number>();
    for (const e of world.query("monster")) {
      if (world.has(e, "boss")) continue;
      const id = world.get<MonsterC>(e, "monster")!.defId;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    for (const [id, n] of counts) {
      const def = MONSTERS.get(id)!;
      expect(n % PACK_COUNT[def.archetype], id).toBe(0);
    }
  });

  it("exactly one rare, and it is still on the last layout socket", () => {
    const { world, session, layout } = mapFixture({ mapSeed: 21 });
    buildArea(world, "map", session, layout);
    const rares = world.query("monster").filter((e) => world.get<MonsterC>(e, "monster")!.rare === 1);
    expect(rares.length).toBe(1);
    const last = layout.spawnSockets[layout.spawnSockets.length - 1]!;
    const pos = world.get<Position>(rares[0]!, "position")!;
    expect(pos.x).toBe(fp(last.x));
    expect(pos.y).toBe(fp(last.y));
  });
});
```

`mapFixture` is a local helper in this describe block — write it to match how the file's existing tests build a world, a `SessionC` (with `activeNodeId`, `mapSeed`, `waystoneSeed`, `areaTier`) and a layout from `generateArea`. If the existing tests already have such a helper, reuse it and add a `mapSeed` override rather than writing a second one.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/simulation/src/areas.test.ts`
Expected: FAIL on "spawns only species from the active node's biome pool" — every monster is `monster.cinder_imp.v1`, which is in no pool.

- [ ] **Step 3: Widen PACK_SPREAD**

In `packages/simulation/src/areas.ts`, replace `PACK_SPREAD`:

```ts
/**
 * Where the members of one pack stand relative to the socket they share. Literal
 * fixed-point, never trig: the sim stays deterministic.
 *
 * Eight entries, because the largest pack is a swarm of 4 and a 100% pack-size
 * roll doubles it. At five entries the extras landed back on top of the first
 * three and a doubled swarm read as four monsters, not eight.
 */
const PACK_SPREAD: readonly { dx: number; dy: number }[] = [
  { dx: fp(0), dy: fp(0) },
  { dx: fp(1.4), dy: fp(0.9) },
  { dx: fp(-1.4), dy: fp(-0.9) },
  { dx: fp(1.5), dy: fp(-0.8) },
  { dx: fp(-1.5), dy: fp(0.8) },
  { dx: fp(0), dy: fp(1.7) },
  { dx: fp(0), dy: fp(-1.7) },
  { dx: fp(2.2), dy: fp(0) },
];
```

- [ ] **Step 4: Spawn from the pool**

Replace the spawn loop in the map branch of `buildArea` (the block from `const impDef = ...` through the end of the `for` loop) with:

```ts
    // Which biome this is decides what lives in it. Same route the layout
    // grammar takes (systems/area-transition.ts): the Atlas node picks the base,
    // the base picks the biome.
    const biomeId = mapBase(mapBaseIdForNode(session.activeNodeId)).biomeId;
    // One stream, walked once per socket in socket order, so the same map seed
    // always fields the same bestiary. Same idiom as rules/items.ts.
    const rnd = mulberry32(session.mapSeed ^ 0x9e37);
    const spawns = layout.spawnSockets;
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i]!;
      const base = withMonsterRes(pickPack(biomeId, rnd()), ws.monsterResAdd);
      // Pack size adds to the pack the socket already has. The generator owns
      // where a fight can stand, so a modifier adds bodies to a sanctioned
      // socket and never invents a new one.
      const packed = PACK_COUNT[base.archetype];
      const count = packed + Math.trunc((packed * ws.packSizePct) / 100);
      for (let j = 0; j < count; j++) {
        // The first member of the last socket carries the rare, so a big pack-size
        // roll means more to kill rather than more rares to answer.
        const rare = i === spawns.length - 1 && j === 0;
        // The map's own seed picks the rare's element, so a given map always
        // demands the same resistance and a replay of it stays identical.
        const def = rare ? makeRare(base, rareTemplate(session.mapSeed)) : base;
        const ring = PACK_SPREAD[j % PACK_SPREAD.length]!;
        spawnMonster(world, def, fp(s.x) + ring.dx, fp(s.y) + ring.dy, rare, scale);
      }
    }
```

Imports at the top of `areas.ts` gain `pickPack`, `PACK_COUNT`, `mapBase` from `@exiled/content-runtime` and `mapBaseIdForNode` from `@exiled/rules`. `MONSTERS` is still needed for the boss. Add `mulberry32` — copy the six-line implementation from `packages/rules/src/waystone.ts:59` into `areas.ts` as a file-local function, matching how every other consumer in the repo keeps its own copy rather than exporting one.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run packages/simulation`
Expected: PASS. `areas.test.ts`'s existing tests that assert imps will now fail; update them to assert the pool contract instead — an area's monsters coming from its biome is the new truth, and a test naming `cinder_imp` is testing the old one.
Run: `npm run typecheck`
Expected: rc=0.

- [ ] **Step 6: Commit**

```bash
git add packages/simulation/src/areas.ts packages/simulation/src/areas.test.ts
git commit -m "feat(sim): a map fields its biome's monsters, in packs the archetype sizes"
```

---

### Task 5: Shooters

**Files:**
- Modify: `packages/simulation/src/systems/monster-ai.ts`
- Test: `packages/simulation/src/systems/monster-ai.test.ts`

**Interfaces:**
- Consumes: the widened projectile collision from Task 2; `MonsterDef.ranged` from Task 1.
- Produces: a monster whose def has `ranged` spawns a `ProjectileC` instead of enqueueing damage.

- [ ] **Step 1: Write the failing tests**

Append to `packages/simulation/src/systems/monster-ai.test.ts`:

```ts
describe("shooters", () => {
  it("fires a bolt instead of hitting, and the bolt is on its team", () => {
    const { sim, world, monster, player } = aiFixture({
      def: MONSTERS.get("monster.dune_spitter.v1")!,
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(5), y: fp(0) },   // inside range 7.5
    });
    const before = world.get<Health>(player, "health")!.life;

    sim.step();

    const bolts = world.query("projectile");
    expect(bolts.length).toBe(1);
    expect(world.get<ProjectileC>(bolts[0]!, "projectile")!.team).toBe(1);
    expect(world.get<ProjectileC>(bolts[0]!, "projectile")!.ownerId).toBe(monster);
    // The bolt has to travel; the shot itself does no damage.
    expect(world.get<Health>(player, "health")!.life).toBe(before);
  });

  it("respects its attack cooldown", () => {
    const { sim, world } = aiFixture({
      def: MONSTERS.get("monster.dune_spitter.v1")!,
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(5), y: fp(0) },
    });
    for (let i = 0; i < 10; i++) sim.step();
    // 70-tick cooldown: ten ticks is one bolt, however many have expired.
    expect(world.query("projectile").length).toBeLessThanOrEqual(1);
  });

  it("does not fire while the player is out of range", () => {
    const { sim, world } = aiFixture({
      def: MONSTERS.get("monster.dune_spitter.v1")!,
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(8.5), y: fp(0) },  // awake (< AGGRO_RADIUS 9), out of range (> 7.5)
    });
    sim.step();
    expect(world.query("projectile").length).toBe(0);
  });

  it("a melee monster still enqueues damage and spawns no bolt", () => {
    const { sim, world, player } = aiFixture({
      def: MONSTERS.get("monster.vaal_husk.v1")!,
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(1), y: fp(0) },
    });
    const before = world.get<Health>(player, "health")!.life;
    sim.step();
    expect(world.query("projectile").length).toBe(0);
    expect(world.get<Health>(player, "health")!.life).toBeLessThan(before);
  });
});
```

`aiFixture` is a local helper: build a `Simulation`, `registerMonsterAI(sim)`, create a player (team 0, `player`, `position`, `health`, `faction`) and one monster via `spawnMonster(world, def, x, y, false)`, set its `MonsterC.state` to `"chase"` so it is awake, and return `{ sim, world, monster, player }`. If the file already has an equivalent helper, extend that one instead.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/simulation/src/systems/monster-ai.test.ts`
Expected: FAIL — no projectile is created; the shooter melees at 7.5 units because `attackRange` is all the AI reads.

- [ ] **Step 3: Add the branch**

In `packages/simulation/src/systems/monster-ai.ts`, inside the in-range case, replace the body of `if (nearestD2 <= ar * ar) { ... }` with:

```ts
      if (nearestD2 <= ar * ar) {
        let { attackReadyTick } = mon;
        if (tick >= attackReadyTick) {
          const def = MONSTERS.get(mon.defId);
          if (def?.ranged) {
            // A shooter's range is its attack range, so chase already stops it
            // where it should stand: no kiting AI, and none needed.
            // ponytail: no line of sight — a bolt crosses walls, as every
            // projectile in this game already does. Range 7.5 under an aggro
            // radius of 9 keeps it close to honest; real LOS is its own pass
            // over collision.ts, for the player's projectiles as much as these.
            const speedPerTick = Math.trunc(def.ranged.speedFixed / 30);
            const step = fpStepToward(mpos.x, mpos.y, ppos.x, ppos.y, speedPerTick);
            // Standing exactly on the player: nothing to aim at, so fall through
            // to next tick rather than emitting a bolt with no direction.
            if (step.dx !== 0 || step.dy !== 0) {
              const faction = world.get<Faction>(m, "faction")!;
              const bolt = world.create();
              world.set<Position>(bolt, "position", { x: mpos.x, y: mpos.y });
              world.set<ProjectileC>(bolt, "projectile", {
                dirx: step.dx,
                diry: step.dy,
                remainingRange: mon.attackRange,
                radius: def.ranged.radiusFixed,
                damageType: mon.attackType,
                damageAmount: mon.attackDamage,
                ownerId: m,
                team: faction.team,
              });
              attackReadyTick = tick + mon.attackCooldownTicks;
            }
          } else {
            sim.enqueueDamage({
              target: nearest,
              source: m,
              amountFixed: mon.attackDamage,
              type: mon.attackType,
            });
            attackReadyTick = tick + mon.attackCooldownTicks;
          }
        }
        world.set<MonsterC>(m, "monster", { ...mon, state: "attack", attackReadyTick });
      } else {
```

`damageAmount` and `damageType` come from `MonsterC`, not from the def, because `MonsterC.attackDamage` is the **tier- and Waystone-scaled** value (`spawnMonster` scales it) and the def's is not. A bolt that read the def would ignore map tier entirely.

Imports gain `MONSTERS` from `@exiled/content-runtime`, `fpStepToward` is already imported, and `ProjectileC` + `Faction` from `../components`.

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run packages/simulation`
Expected: PASS.
Run: `npm run typecheck`
Expected: rc=0.

- [ ] **Step 5: Commit**

```bash
git add packages/simulation/src/systems/monster-ai.ts packages/simulation/src/systems/monster-ai.test.ts
git commit -m "feat(sim): a shooter fires the bolt its content describes"
```

---

### Task 6: Heavies

**Files:**
- Modify: `packages/simulation/src/components.ts` (`MonsterC` at :77-93)
- Modify: `packages/simulation/src/systems/monster-ai.ts`
- Modify: `packages/simulation/src/areas.ts` (`spawnMonster` writes the new field)
- Test: `packages/simulation/src/systems/monster-ai.test.ts`

**Interfaces:**
- Consumes: `MonsterDef.heavy` from Task 1; the existing `TelegraphC` component and the already-faction-generic `telegraphResolve` system.
- Produces: `MonsterC.rootedUntilTick`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/simulation/src/systems/monster-ai.test.ts`:

```ts
describe("heavies", () => {
  const sentinel = () => MONSTERS.get("monster.blood_sentinel.v1")!;

  it("telegraphs on the player's position instead of hitting", () => {
    const { sim, world, monster, player } = aiFixture({
      def: sentinel(),
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(4), y: fp(0) },   // inside slam range 6.5, outside melee 1.8
    });
    const before = world.get<Health>(player, "health")!.life;

    sim.step();

    const teles = world.query("telegraph");
    expect(teles.length).toBe(1);
    const tg = world.get<TelegraphC>(teles[0]!, "telegraph")!;
    expect(tg.ownerId).toBe(monster);
    expect(tg.team).toBe(1);
    expect(tg.leavesGroundTicks).toBe(0);  // a burning patch stays a boss privilege
    expect(world.get<Position>(teles[0]!, "position")!.x).toBe(fp(4));
    expect(world.get<Health>(player, "health")!.life).toBe(before);
  });

  it("does not move or melee while rooted in the wind-up", () => {
    const { sim, world, monster, player } = aiFixture({
      def: sentinel(),
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(4), y: fp(0) },
    });
    sim.step();                                   // starts the wind-up
    const at = { ...world.get<Position>(monster, "position")! };
    const life = world.get<Health>(player, "health")!.life;
    for (let i = 0; i < 10; i++) sim.step();      // still inside 30 ticks
    expect(world.get<Position>(monster, "position")).toEqual(at);
    expect(world.get<Health>(player, "health")!.life).toBe(life);
  });

  it("the slam lands where it was telegraphed, on the wind-up tick", () => {
    const { sim, world, player } = aiFixture({
      def: sentinel(),
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(4), y: fp(0) },
      withTelegraphResolve: true,
    });
    const before = world.get<Health>(player, "health")!.life;
    for (let i = 0; i < 32; i++) sim.step();      // windupTicks 30, plus slack
    expect(world.get<Health>(player, "health")!.life).toBeLessThan(before);
    expect(world.query("telegraph").length).toBe(0);   // resolved and destroyed
  });

  it("a player who steps out of the ring takes nothing", () => {
    const { sim, world, player } = aiFixture({
      def: sentinel(),
      monsterAt: { x: fp(0), y: fp(0) },
      playerAt: { x: fp(4), y: fp(0) },
      withTelegraphResolve: true,
    });
    const before = world.get<Health>(player, "health")!.life;
    sim.step();                                    // telegraph placed at (4,0)
    // Radius 2.6 plus the player's body: 9 units away is unambiguously clear.
    world.set<Position>(player, "position", { x: fp(13), y: fp(0) });
    for (let i = 0; i < 32; i++) sim.step();
    expect(world.get<Health>(player, "health")!.life).toBe(before);
  });
});
```

`aiFixture` gains a `withTelegraphResolve` option that also calls `registerTelegraphResolve(sim)`. Note the fourth test moves the player and the monster is rooted, so nothing re-aims — that is the dodge being real.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/simulation/src/systems/monster-ai.test.ts`
Expected: FAIL — no telegraph entity is created; the Sentinel walks to melee range instead.

- [ ] **Step 3: Add the root field**

In `packages/simulation/src/components.ts`, add to `MonsterC` after `attackReadyTick`:

```ts
  /**
   * Rooted through a heavy's wind-up: no move, no melee. Trash reads this;
   * a boss reads BossC.rootedUntilTick and the two systems never cross.
   */
  rootedUntilTick: number;
```

In `packages/simulation/src/areas.ts`, `spawnMonster` writes `rootedUntilTick: 0` in its `world.set<MonsterC>` call. Every other construction site of a `MonsterC` literal (test fixtures across `packages/simulation/src/systems/*.test.ts`) will fail to typecheck until it does the same — add the field, do not make it optional.

This is safe for replay: `packages/replay` compares a run against a second run of the same scenario and stores no goldens on disk (`packages/replay/src/replay.test.ts`), so there is nothing to regenerate.

- [ ] **Step 4: Add the branch**

In `packages/simulation/src/systems/monster-ai.ts`, immediately after the aggro check (`if (mon.state === "idle" && nearestD2 > AGGRO_RADIUS * AGGRO_RADIUS) continue;`) and before the in-range test:

```ts
      // Rooted mid-wind-up: hold. Sits above the slam and the melee checks so a
      // heavy cannot re-aim what it has already committed to — the dodge is only
      // real if the ring stays where it was drawn.
      if (tick < mon.rootedUntilTick) {
        world.set<MonsterC>(m, "monster", { ...mon, state: "attack" });
        continue;
      }

      const heavy = MONSTERS.get(mon.defId)?.heavy;
      if (heavy && tick >= mon.attackReadyTick && nearestD2 <= heavy.rangeFixed * heavy.rangeFixed) {
        const faction = world.get<Faction>(m, "faction")!;
        const tele = world.create();
        world.set<Position>(tele, "position", { x: ppos.x, y: ppos.y });
        world.set<TelegraphC>(tele, "telegraph", {
          ownerId: m,
          team: faction.team,
          radius: heavy.radiusFixed,
          startTick: tick,
          impactTick: tick + heavy.windupTicks,
          // Trash leaves no burning patch. That stays the boss's, and it is the
          // difference between a fight you walk out of and one you must leave.
          damage: heavy.damageFixed,
          damageType: mon.attackType,
          leavesGroundTicks: 0,
        });
        world.set<MonsterC>(m, "monster", {
          ...mon,
          state: "attack",
          rootedUntilTick: tick + heavy.windupTicks,
          attackReadyTick: tick + heavy.cooldownTicks,
        });
        continue;
      }
```

`ppos` must be read before this block — move the existing `const ppos = world.get<Position>(nearest, "position")!;` line above it.

Imports gain `TelegraphC` from `../components`.

**Known gap, deliberate:** `heavy.damageFixed` is not scaled by map tier the way `MonsterC.attackDamage` is, because `spawnMonster` scales only the melee number. Task 8 decides whether the slam needs its own scaled field on `MonsterC`; do not invent one here.

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run packages/simulation packages/replay`
Expected: PASS. `packages/replay` is in scope here because `MonsterC` gained a field: its scenarios must still reproduce their checksum sequence run against run.
Run: `npm run typecheck`
Expected: rc=0.

- [ ] **Step 6: Commit**

```bash
git add packages/simulation
git commit -m "feat(sim): a heavy roots, telegraphs, and slams where it drew the ring"
```

---

### Task 7: The wire says which species

**Files:**
- Modify: `packages/protocol/src/index.ts` (`SnapshotEntity` at :122-166)
- Modify: `packages/simulation/src/protocol-bridge.ts:190-212`
- Test: `packages/simulation/src/protocol-bridge.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SnapshotEntity.species?: string`. The renderer ignores it until P2; this task exists so P2 is purely client-side.

- [ ] **Step 1: Write the failing test**

Append to `packages/simulation/src/protocol-bridge.test.ts`:

```ts
it("a monster snapshot carries its species so the client can pick a mesh", () => {
  const world = new World();
  const def = MONSTERS.get("monster.fen_wisp.v1")!;
  const e = spawnMonster(world, def, fp(1), fp(2), false);
  const snap = buildSnapshot(world, 0);
  const entry = snap.entities.find((x) => x.id === e)!;
  expect(entry.species).toBe("monster.fen_wisp.v1");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/simulation/src/protocol-bridge.test.ts`
Expected: FAIL — `entry.species` is `undefined`.

- [ ] **Step 3: Add the field**

In `packages/protocol/src/index.ts`, in `SnapshotEntity` beside `rare` and `element`:

```ts
  /**
   * Which monster def this is, so the renderer can pick a mesh. A plain string:
   * the wire contract must not depend on content, the same reason `element` and
   * `rarity` are protocol-local types.
   */
  species?: string;
```

In `packages/simulation/src/protocol-bridge.ts`, add to the monster `entry` literal:

```ts
      species: mon.defId,
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run packages/simulation packages/protocol`
Expected: PASS.
Run: `npm run typecheck` and `npm run build -w apps/web`
Expected: rc=0 both.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol packages/simulation
git commit -m "feat(protocol): a monster snapshot names its species"
```

---

### Task 8: Measure, then tune

**Files:**
- Modify: `packages/simulation/src/balance.test.ts`
- Modify: `packages/content-runtime/src/monsters.ts` (numbers only)

**Interfaces:**
- Consumes: everything above.
- Produces: measured numbers, and the comment that records what measured them.

Every number in `monsters.ts` today carries the measurement that set it (see the Warden's life comment at :24-30). The twelve new defs currently carry guesses. This task replaces the guesses with measurements, and the **bands are the spec — the stats are the knob.**

- [ ] **Step 1: Write the measurement tests**

Append to `packages/simulation/src/balance.test.ts`, using that file's existing harness (it already builds a reference character and runs ticks to a kill):

```ts
describe("archetype time-to-kill (Tier 1, reference character)", () => {
  const bands: Record<string, { defId: string; min: number; max: number }> = {
    swarm:   { defId: "monster.vaal_husk.v1",        min: 2, max: 4 },
    brute:   { defId: "monster.vaal_construct.v1",   min: 4, max: 7 },
    shooter: { defId: "monster.dune_spitter.v1",     min: 2, max: 5 },
    heavy:   { defId: "monster.blood_sentinel.v1",   min: 3, max: 6 },
  };

  for (const [archetype, band] of Object.entries(bands)) {
    it(`${archetype} dies in ${band.min}-${band.max}s`, () => {
      const def = MONSTERS.get(band.defId)!;
      const count = PACK_COUNT[def.archetype];
      const seconds = secondsToClearPack(def, count);
      expect(seconds).toBeGreaterThanOrEqual(band.min);
      expect(seconds).toBeLessThanOrEqual(band.max);
    });
  }
});

it("a full biome pack kills a stationary reference character in under 12s", () => {
  // One socket of each of Vaal Stone's three archetypes, none of them dodged.
  const seconds = secondsToKillIdlePlayer("vaal_stone");
  expect(seconds).toBeLessThan(12);
});
```

`secondsToClearPack(def, count)` and `secondsToKillIdlePlayer(biomeId)` are new local helpers in `balance.test.ts`: build a world with the reference character and the monsters, register the same systems `combat-sim.ts` registers, step until the condition, and return `ticks / 30`. Model them on the existing time-to-kill helper in that file rather than inventing a second harness.

- [ ] **Step 2: Run and read the numbers**

Run: `npx vitest run packages/simulation/src/balance.test.ts`
Expected: some bands FAIL. **This is the measurement, not a bug.** Write down the actual seconds each archetype produced.

- [ ] **Step 3: Tune the content, not the test**

Adjust `maxLifeFixed` first (it is the knob that sets fight length, per the Warden comment at `monsters.ts:24-30`), then `attackDamage.amountFixed` for the kill-the-player band. Re-run until green.

Two things are **not** knobs here: `windupTicks` never drops below 23 (0.75s), and elemental damage never exceeds physical damage of the same archetype — the element exists to make a resistance mean something, not to make one biome harder.

If the slam turns out to need tier scaling (the known gap flagged in Task 6, Step 4), add `slamDamage: Fixed` to `MonsterC`, scale it in `spawnMonster` exactly as `attackDamage` is scaled, and read it in the heavy branch. Do that only if the measurement says a Tier 15 slam is trivial.

- [ ] **Step 4: Record what measured it**

Replace the guessed numbers' silence with the repo's idiom — a comment on each archetype's def saying what was measured and when, e.g.:

```ts
    // 140 is the measured number, not a chosen one: at 90 a Construct fell in
    // 3.1s, inside the swarm band, and a brute that dies like a swarm is a
    // swarm. See balance.test.ts "brute dies in 4-7s".
```

- [ ] **Step 5: Full suite, typecheck, build**

Run: `npx vitest run`
Expected: PASS, all files.
Run: `npm run typecheck`
Expected: rc=0.
Run: `npm run build -w apps/web`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/simulation/src/balance.test.ts packages/content-runtime/src/monsters.ts
git commit -m "balance(monsters): archetype fight lengths set by measurement"
```

---

## After the plan

Run the game (`npm run dev -w apps/web`) and take one map in each biome. Every monster still looks like a Cinder Imp — that is expected, and it is what P2 fixes. What to watch for is whether the *fight* differs: a Desert map should push you off your mark, a Vaal Stone map should make you step out of a ring, a Forest map should never let you finish a cast standing still.

Devlog: per the workspace rule, ask the user to confirm each screen before capturing it. There is no visual change to show here, so a devlog entry for P1 is likely not warranted — say so rather than capturing a screenshot of an unchanged imp.
