# Character Levels 1-100 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move characters from starting at level 65 to starting at level 1, rescaling the Atlas, the experience curve, the level bonus and the passive-point budget so the whole 1-100 climb is playable.

**Architecture:** Every number changed lives in `@exiled/rules`, a pure leaf with no `@exiled` imports. The simulation reads those functions and does not hold copies, so the change is confined to two files (`xp.ts`, `atlas.ts`) plus one constant pair in `passives.ts`. Nothing in the client, the protocol or persistence changes shape. What does change is what the numbers mean, so the balance suite is re-measured against the same rig rather than re-argued.

**Tech Stack:** TypeScript 7 strict, npm workspaces, Vitest 4. No new dependencies.

## Global Constraints

- `@exiled/rules` is a pure leaf: it imports no other `@exiled` package. Do not add an import to it.
- Simulation math is deterministic fixed-point integers. Every function here returns integers; no floats reach a stored value.
- Golden replay checksums must stay stable in shape. Where a value changes, regenerate deliberately and say so in the commit message.
- Commit messages: no attribution trailers, no emdashes.
- Run from repo root: `npx vitest run <scope>`, `npm run typecheck`.
- Do not touch `packages/simulation/src/balance.test.ts` band values until Task 6, which re-measures them.

---

### Task 1: The experience curve starts at 1

**Files:**
- Modify: `packages/rules/src/xp.ts:13` (`START_LEVEL`), `:18-21` (`xpToNext`), `:56-65` (`levelBonus`)
- Test: `packages/rules/src/xp.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `START_LEVEL = 1`, `MAX_LEVEL = 100` (unchanged), `xpToNext(level: number): number`, `levelBonus(level: number): { maxLife: number; maxMana: number }`. Every later task and every existing caller keeps these exact signatures.

- [ ] **Step 1: Write the failing tests**

Add to `packages/rules/src/xp.test.ts`:

```ts
describe("a character starts at 1 and climbs to 100", () => {
  it("starts at level 1", () => {
    expect(START_LEVEL).toBe(1);
  });

  it("levels fast at the start and slowly at the end", () => {
    expect(xpToNext(1)).toBeLessThan(100);
    expect(xpToNext(50)).toBeGreaterThan(xpToNext(49));
    expect(xpToNext(99)).toBeGreaterThan(100_000);
    expect(xpToNext(100)).toBe(0);
  });

  it("is monotonic, so no level is ever cheaper than the one before it", () => {
    for (let lv = 1; lv < 100; lv++) {
      expect(xpToNext(lv + 1)).toBeGreaterThanOrEqual(xpToNext(lv));
    }
  });

  it("returns whole numbers only", () => {
    for (let lv = 1; lv <= 100; lv++) {
      expect(Number.isSafeInteger(xpToNext(lv))).toBe(true);
    }
  });

  it("hands out the same total life and mana across the longer climb", () => {
    // 210 life and 70 mana was the whole-climb total at 65-100. Keep the total,
    // spread it over 99 levels, or every level-up silently gets stronger.
    expect(levelBonus(100)).toEqual({ maxLife: 210, maxMana: 70 });
    expect(levelBonus(1)).toEqual({ maxLife: 0, maxMana: 0 });
  });

  it("never hands out a fractional pool", () => {
    for (let lv = 1; lv <= 100; lv++) {
      const b = levelBonus(lv);
      expect(Number.isSafeInteger(b.maxLife)).toBe(true);
      expect(Number.isSafeInteger(b.maxMana)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/rules/src/xp.test.ts`
Expected: FAIL. `START_LEVEL` is 65, `xpToNext(1)` is 60000, `levelBonus(100)` is `{ maxLife: 210, maxMana: 70 }` only by coincidence of the old span and will now be wrong.

- [ ] **Step 3: Replace the three functions**

In `packages/rules/src/xp.ts`, replace `START_LEVEL` and its doc comment, `xpToNext`, and `levelBonus`:

```ts
/**
 * A character starts at 1. The Atlas is rescaled to meet him there
 * (`atlas.ts`: tier 0 is area level 2), so the level-difference penalty is a
 * choice about which tier to run, never a permanent tax for existing.
 */
export const START_LEVEL = 1;
/** Both PoE games stop at 100, and so does this one. */
export const MAX_LEVEL = 100;

/**
 * Experience needed to leave `level`. Zero at the cap: nothing to buy.
 *
 * Quadratic, because a kill's value only grows LINEARLY with area level: a
 * cubic curve outruns what the player can earn and the late game stops paying
 * at all. This shape holds the cost at roughly 15 normal-monster equivalents to
 * leave level 1 and 3,400 to leave 99, which is a few minutes against about ten
 * maps. `xp.test.ts` pins that band rather than the constant, so the constant
 * can be retuned without anyone having to guess what it was protecting.
 */
export function xpToNext(level: number): number {
  if (level >= MAX_LEVEL) return 0;
  return 30 * level * level;
}

/**
 * What levelling itself grants. Deliberately small and flat: gear is where this
 * game's power lives, and a level that handed out a percentage would compound
 * with every affix. The whole-climb total is unchanged from the 65-100 era —
 * 210 life and 70 mana — so spreading it over 99 levels makes each level
 * smaller, never the climb richer. Computed from the total rather than from a
 * per-level rate so it lands exactly on 210/70 at the cap instead of drifting.
 */
export function levelBonus(level: number): { maxLife: number; maxMana: number } {
  const n = Math.min(Math.max(level, START_LEVEL), MAX_LEVEL) - START_LEVEL;
  const span = MAX_LEVEL - START_LEVEL;
  return {
    maxLife: Math.trunc((210 * n) / span),
    maxMana: Math.trunc((70 * n) / span),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/rules/src/xp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/xp.ts packages/rules/src/xp.test.ts
git commit -m "feat(xp): a character starts at level 1 and the curve is cubic"
```

---

### Task 2: The Atlas comes down to meet a level-1 character

**Files:**
- Modify: `packages/rules/src/atlas.ts:44-53` (`areaLevel`, `monsterTierScale`)
- Test: `packages/rules/src/atlas.test.ts`

**Interfaces:**
- Consumes: `START_LEVEL` and `MAX_LEVEL` from Task 1 (import from `./xp`; `atlas.ts` already sits in the same package, so this is an intra-package import and does not break the pure-leaf rule).
- Produces: `areaLevel(tier: number): number` and `monsterTierScale(tier: number): { lifeMilli: number; dmgMilli: number }`, both unchanged in signature. `ATLAS_NODE_COUNT` stays 15, so tiers run 0 to 14.

- [ ] **Step 1: Write the failing tests**

Add to `packages/rules/src/atlas.test.ts`, importing `xpToNext` and `monsterXp`
from `./xp` alongside the atlas exports already imported there:

```ts
describe("the Atlas spans a 1-100 character's climb", () => {
  it("opens at a level a fresh character can survive", () => {
    expect(areaLevel(0)).toBe(2);
  });

  it("tops out below the level cap, so the last levels are a grind by choice", () => {
    expect(areaLevel(ATLAS_NODE_COUNT - 1)).toBe(86);
  });

  it("climbs by a fixed step, so a tier is always worth the same jump", () => {
    for (let t = 0; t < ATLAS_NODE_COUNT - 1; t++) {
      expect(areaLevel(t + 1) - areaLevel(t)).toBe(6);
    }
  });

  it("costs a sane number of kills at every level, which is the real contract", () => {
    // The two curves are only meaningful against each other: a level must never
    // cost so few kills that it is noise, nor so many that the track stops
    // paying (docs/09 rule 7). Measured in normal-monster equivalents at the
    // area level a character of that level would be running; a rare is 8 of
    // these and a boss 40, so real kill counts are several times smaller.
    // This case lives here rather than in xp.test.ts because it needs BOTH
    // curves, and it is the only thing stopping them being tuned separately.
    for (const level of [1, 10, 50, 90, 99]) {
      const tier = Math.max(0, Math.min(ATLAS_NODE_COUNT - 1, Math.round((level - 2) / 6)));
      const kills = xpToNext(level) / monsterXp(areaLevel(tier), "normal");
      expect(kills).toBeGreaterThan(10);
      expect(kills).toBeLessThan(5_000);
    }
  });

  it("keeps tier 0 monsters at their authored numbers", () => {
    // The reference character is tuned against tier 0. If this scale ever stops
    // being 1000/1000, every band in balance.test.ts moves with it.
    expect(monsterTierScale(0)).toEqual({ lifeMilli: 1000, dmgMilli: 1000 });
  });

  it("scales monsters across the whole Atlas rather than the old 15 tiers", () => {
    const top = monsterTierScale(ATLAS_NODE_COUNT - 1);
    expect(top.lifeMilli).toBeGreaterThan(monsterTierScale(0).lifeMilli);
    expect(top.dmgMilli).toBeGreaterThan(monsterTierScale(0).dmgMilli);
    expect(Number.isSafeInteger(top.lifeMilli)).toBe(true);
    expect(Number.isSafeInteger(top.dmgMilli)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/rules/src/atlas.test.ts`
Expected: FAIL with `areaLevel(0)` returning 64.

- [ ] **Step 3: Rescale both functions**

In `packages/rules/src/atlas.ts`, replace `areaLevel` and `monsterTierScale`:

```ts
/**
 * Natural area level per docs/01:308, rescaled for a 1-100 character. Tier 0 is
 * level 2 so a character out of the character-creation screen can run the first
 * node, and the fifteenth is 86 so the last stretch to 100 is a tier the player
 * has chosen to farm rather than one the Atlas hands him.
 */
export function areaLevel(tier: number): number {
  return 2 + 6 * tier;
}

// ponytail: linear per-mille scaling is a calibration placeholder (docs/01:780
// says monster-vs-level needs empirical tuning). Two knobs; adjust here only.
// The per-tier step tracks the six area levels a tier now covers, so a monster
// at the top of the Atlas is about ten times a tier-0 one rather than three.
export function monsterTierScale(tier: number): { lifeMilli: number; dmgMilli: number } {
  return { lifeMilli: 1000 + 650 * tier, dmgMilli: 1000 + 430 * tier };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/rules/src/atlas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/atlas.ts packages/rules/src/atlas.test.ts
git commit -m "feat(atlas): tier 0 is area level 2, so a new character has somewhere to start"
```

---

### Task 3: The passive budget is re-baselined on 99 levels

**Files:**
- Modify: `packages/rules/src/passives.ts:443-459` (the doc comment, `PASSIVE_POINTS_AT_START`, `PASSIVE_POINTS_PER_LEVEL`)
- Test: `packages/rules/src/passives.test.ts`

**Interfaces:**
- Consumes: `START_LEVEL` and `MAX_LEVEL` from Task 1, already imported at `passives.ts:2`.
- Produces: `passivePoints(level: number): number`, unchanged signature. Later tasks and `systems/interact.ts:108` call it as-is.

**Why:** the old constants gave 24 points at level 65 and 94 at the cap, against a 239-node tree. Left alone at `START_LEVEL = 1` they give a brand-new character 24 points and a capped one 222, which walks almost the whole tree and destroys the "two disciplines and a keystone" budget the tree was designed around.

- [ ] **Step 1: Write the failing tests**

Add to `packages/rules/src/passives.test.ts`:

```ts
describe("the passive budget over a 1-100 climb", () => {
  it("gives a brand-new character nothing to spend yet", () => {
    expect(passivePoints(START_LEVEL)).toBe(0);
  });

  it("reaches the same budget at the cap the 65-94 era ended on", () => {
    // 94 points in a 239-node tree: enough to walk two disciplines and a
    // keystone, never enough to walk all eight. That budget is the design.
    expect(passivePoints(MAX_LEVEL)).toBe(99);
  });

  it("never exceeds the budget however far past the cap it is asked", () => {
    expect(passivePoints(MAX_LEVEL + 50)).toBe(passivePoints(MAX_LEVEL));
  });

  it("is monotonic and whole", () => {
    for (let lv = START_LEVEL; lv < MAX_LEVEL; lv++) {
      expect(passivePoints(lv + 1)).toBeGreaterThanOrEqual(passivePoints(lv));
      expect(Number.isSafeInteger(passivePoints(lv))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/rules/src/passives.test.ts`
Expected: FAIL. `passivePoints(1)` returns 24.

- [ ] **Step 3: Re-baseline the two constants**

In `packages/rules/src/passives.ts`, replace the doc comment above `PASSIVE_POINTS_AT_START` and both constants:

```ts
/**
 * How many points a character of this level has spent-able.
 *
 * One a level from 1 to 100 is 99 points in a web of 239 nodes: the same budget
 * the 65-to-94 era ended on, which is roughly PoE's own reach — enough to walk
 * two disciplines and a keystone, never enough to walk all eight. A level-1
 * character opens with nothing, because his first point is his first level-up
 * and that is the fixed-ratio track doing its job (docs/09 rule 7).
 */
export const PASSIVE_POINTS_AT_START = 0;
export const PASSIVE_POINTS_PER_LEVEL = 1;
```

`passivePoints` itself is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/rules/src/passives.test.ts`
Expected: PASS. If an existing case in this file asserts a point count at level 65 or 94, update it to the new budget — that case was pinning the old baseline, and the plan changes the baseline on purpose.

- [ ] **Step 5: Commit**

```bash
git add packages/rules/src/passives.ts packages/rules/src/passives.test.ts
git commit -m "feat(passives): one point a level from 1, so the budget survives the longer climb"
```

---

### Task 4: The starting vendor and the reference character follow the new level

**Files:**
- Modify: none expected. Verify only.
- Test: `packages/simulation/src/characters.test.ts`, `packages/simulation/src/persist.test.ts`, `packages/simulation/src/roster-io.test.ts`

**Interfaces:**
- Consumes: `START_LEVEL` from Task 1. Every site below already imports it and needs no edit:
  `combat-sim.ts:137` (fresh progress), `combat-sim.ts:138` (`stockVendor(seed, START_LEVEL)`),
  `derived.ts:39` (`levelBonus`), `persist.ts:50,84` (defaults), `roster-io.ts:68,99`, `characters.ts:93`, `protocol-bridge.ts:211`.
- Produces: nothing new. This task exists because those seven call sites are the whole blast radius, and a fresh reviewer needs to see them checked rather than assumed.

- [ ] **Step 1: Run the simulation suites and read the failures**

Run: `npx vitest run packages/simulation`
Expected: failures only in tests that hard-code 65 or a level-65 derived number. Record each failing file and line before changing anything.

- [ ] **Step 2: Update each failing assertion to the new baseline**

For each failure, decide which of two kinds it is and act accordingly:

- It asserts `START_LEVEL` indirectly (a fresh character's level, a vendor stocked at start): replace the literal with `START_LEVEL` imported from `@exiled/rules`, so it can never go stale again.
- It asserts a level chosen arbitrarily as "some level" (`level: 14`, `level: 23` in `characters.test.ts`): leave it. Those are valid levels in the new range and prove nothing about the baseline.

Do not weaken a band to make a test pass. If a test fails because a number genuinely moved, that belongs to Task 6.

- [ ] **Step 3: Run the suites again**

Run: `npx vitest run packages/simulation`
Expected: PASS, except anything in `balance.test.ts`, which Task 6 owns. If `balance.test.ts` is the only red file, that is the expected state at the end of this task.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/simulation/src
git commit -m "test(sim): the level baseline comes from START_LEVEL, never a literal 65"
```

---

### Task 5: The client shows the new area levels

**Files:**
- Modify: `apps/web/src/hud/PreparationPanel.tsx:162`, `:430` — verify only, no edit expected
- Test: `npx vitest run apps/web`

**Interfaces:**
- Consumes: `areaLevel(tier)` from Task 2. Both sites already call it and render whatever it returns.
- Produces: nothing.

- [ ] **Step 1: Run the client suite**

Run: `npx vitest run apps/web`
Expected: failures only where a test pins the string "Area Level 64" or similar.

- [ ] **Step 2: Update any pinned area-level string to call the rule**

Where a test asserts a rendered area level, assert against `areaLevel(tier)` rather than a literal, for the same reason as Task 4 Step 2.

- [ ] **Step 3: Run the client suite again**

Run: `npx vitest run apps/web`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "test(hud): the preparation panel's area level comes from the rule"
```

---

### Task 6: Re-measure the balance bands against the same rig

**Files:**
- Modify: `packages/simulation/src/balance.test.ts` (band values only)
- Test: the same file

**Interfaces:**
- Consumes: everything from Tasks 1 to 3.
- Produces: nothing. This is the verification gate for the whole plan.

**Why this is a task and not a cleanup:** the bands in this file were measured, not chosen. `monsterTierScale` and `levelBonus` both moved, so the measurements are stale by construction. Re-measuring means running the existing rig and reading what it now produces, then deciding whether that number is acceptable — not editing bands until they are green.

- [ ] **Step 1: Run the balance suite and capture what it now measures**

Run: `npx vitest run packages/simulation/src/balance.test.ts`
Expected: FAIL. For each failing case, write down the measured value from the failure message. Do not edit yet.

- [ ] **Step 2: Judge each measured value against the design intent**

The intents, from the file's own case names, are:

| Case | Intent |
|---|---|
| a lone imp | dies in under 1.5s |
| a five-imp pack | clears in under 6s |
| lone imp vs a stationary player | needs at least 15s to kill |
| five-imp pack vs a stationary player | 4 to 12s |
| Warden phase 1 | 8 to 22s |
| Warden phase 2 | deadlier than phase 1, still leaves 3s to walk out |
| a full biome pack | under 12s |

If a measured value sits inside its stated intent, widen or shift the band to the measured value and move on. If it sits outside — an imp now takes four seconds to kill, or kills the player in six — the tuning constant is wrong, not the band. Go back to `monsterTierScale` in Task 2 and adjust the two per-mille knobs, then re-run. **Never edit a band to accept a number that contradicts its own case name.**

- [ ] **Step 3: Apply the re-measured bands**

Edit only the numeric bands. Leave every case name, every rig setup and every assertion structure untouched, so the diff shows exactly which measurements moved.

- [ ] **Step 4: Run the full suite and typecheck**

Run: `npx vitest run`
Expected: PASS, all files.

Run: `npm run typecheck`
Expected: exit code 0.

Run: `npm run build -w apps/web`
Expected: exit code 0.

- [ ] **Step 5: Commit**

```bash
git add packages/simulation/src/balance.test.ts
git commit -m "test(balance): re-measure every band against the 1-100 curve"
```

---

### Task 7: Say what changed, where the project records it

**Files:**
- Modify: `docs/specs/2026-08-05-current-implementation-contract.md` (§5 Balance), `CHANGELOG.md`
- Test: none

**Interfaces:**
- Consumes: the final numbers from Task 6.
- Produces: nothing.

- [ ] **Step 1: Update the contract's balance section**

In `docs/specs/2026-08-05-current-implementation-contract.md`, §5 "Balance" currently describes a casual pass measured against level-65 characters. Replace the level assumption with the 1-100 range, `areaLevel(tier) = 2 + 6 * tier`, and the re-measured bands. Update the status line at the top of the file to the new commit and date.

- [ ] **Step 2: Add the changelog entry**

`CHANGELOG.md` follows Keep a Changelog and feeds the in-game News panel, so write it for a player, not for a reviewer: characters now start at level 1 and climb to 100, and the Atlas starts at area level 2.

- [ ] **Step 3: Commit**

```bash
git add docs/specs/2026-08-05-current-implementation-contract.md CHANGELOG.md
git commit -m "docs: characters climb from 1 to 100 and the Atlas starts at area level 2"
```

---

## What this plan does not do

The gem system — unlock levels, gem experience, gem levels, breakpoints and the per-character skill bar — is the second plan, written against this one once it is green. This plan alone leaves the game playable and internally consistent: it changes what a level means, not what a skill is.
