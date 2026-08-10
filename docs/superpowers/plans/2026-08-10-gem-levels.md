# Skill Acquisition and Gem Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skills unlock by character level and level on their own shared experience, so a dry
session still pays a guaranteed, visible upgrade.

**Architecture:** Content authors three new fields per `SkillDef` (`classId`, `unlockLevel`,
`growth`). A new pure leaf `packages/rules/src/skill-xp.ts` owns the arithmetic: which skills a
level unlocks, the gem cap, the award split, and the fold that turns `(def, gemLevel)` into the
`SkillDef` the sim actually casts. A new `SkillsC` component on the session entity holds the gems
and the action bar (which moves out of client settings, because experience is earned by the slot).
`skillCast` and `describeSkills` both read through the same fold, so the tooltip promises exactly
what the cast does.

**Tech Stack:** TypeScript, npm workspaces, vitest, React. Sim math is deterministic fixed-point
integers throughout.

## Global Constraints

- Sim math is deterministic fixed-point. Every value written into a component must be an integer
  (`checksum.ts` throws on a non-integer), and every derivation must be integer-only truncation.
- `@exiled/rules` may import only `@exiled/fixed-point` and `@exiled/content-schema`.
- `persist.VERSION` stays at **2**. `skills` is an OPTIONAL field on `PersistedState`, the pattern
  `stash`, `progress` and `shards` already use. Bumping the version deletes every character
  (`persist.ts:107` returns false on mismatch with no migration path).
- `ROSTER_VERSION` (3) is untouched.
- Gem cap is `min(20, charLevel)`.
- Breakpoints sit at gem 5 and gem 15. At most two per skill, zero is legal.
- **Every task ends with a FULL `npx vitest run` from the repo root plus `npm run typecheck`, both
  green, before its commit.** If anything outside your task's file list turns red, you must say so
  explicitly in your report rather than fixing it silently or leaving it.
- **Mutation reasoning is required for every test you write.** For each assertion, state to yourself
  what production change would break it. A level-1 character has gem level 1 and few unlocked
  skills, so a test that uses a default-level character can very easily assert nothing at all. Where
  a test needs a high level or a high gem level to have teeth, set one explicitly.
- Some tests below are given as an `it(...)` title plus the exact assertions in a comment, rather
  than as finished code. That is deliberate, not a gap: those files already have setup helpers
  (world builders, render harnesses) and inventing a parallel one here would be confidently wrong.
  **Read the file's existing helpers first and write the body against them.** The stated assertions
  are the contract and none of them may be dropped or softened.
- Commits go direct to main, one per task. No attribution trailers, no emdashes in messages.
- Read `docs/09-reward-psychology.md` before Task 11 (the feedback task).

## File Structure

**Created:**
- `packages/rules/src/skill-xp.ts` — the whole arithmetic of gems: unlock predicate, cap, xp curve,
  award split, level fold, breakpoint queries. Pure, no world, no ECS.
- `packages/rules/src/skill-xp.test.ts` — its pins.

**Modified:**
- `packages/content-schema/src/index.ts` — three new `SkillDef` fields, one new `spawnProjectile`
  field, their validation.
- `packages/content-schema/src/schema.test.ts` — validator pins.
- `packages/content-runtime/src/skills.ts` — author the fields on all seven skills.
- `packages/content-runtime/src/content.test.ts` — the unlock/growth table pin.
- `packages/rules/src/index.ts` — re-export `skill-xp`.
- `packages/protocol/src/index.ts` — `setSkillBar` intent, `SKILL_SLOT_COUNT`/`MOVE_SOCKET`,
  `DisplaySkill` gem fields.
- `packages/simulation/src/components.ts` — `SkillsC`.
- `packages/simulation/src/loop.ts` — `Command.bar`.
- `packages/simulation/src/combat-sim.ts` — build `SkillsC`, register the bar system.
- `packages/simulation/src/persist.ts` — persist and restore `skills`.
- `packages/simulation/src/systems/skills.ts` (new) — applies `setSkillBar`, re-grants on level-up.
- `packages/simulation/src/systems/skill-cast.ts` — cast through the fold.
- `packages/simulation/src/systems/projectile.ts` — pierce.
- `packages/simulation/src/systems/death.ts` — award gem experience.
- `packages/simulation/src/protocol-bridge.ts` — unlocked-only, gem-scaled `describeSkills`.
- `apps/web/src/settings.ts` — `skillBar` leaves `UiSettings`.
- `apps/web/src/GameView.tsx`, `apps/web/src/hud/Hud.tsx`, `apps/web/src/hud/SkillTooltip.tsx` —
  read the bar from the snapshot, dispatch the intent, show the gem.

---

### Task 1: Content schema — the three gem fields

**Files:**
- Modify: `packages/content-schema/src/index.ts`
- Test: `packages/content-schema/src/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `SkillGrowth`, `SkillBreakpoint`, `GrowthField`, the widened `SkillDef`, and
  `pierceCount?: number` on the `spawnProjectile` effect node. Every later task depends on these
  exact names.

**Why the shape is what it is.** A breakpoint patch is a shallow merge over `effects[0]`, so it may
only set **top-level scalar** keys. That rule is what keeps the authoring honest: a nested patch
(say, of `ailment`) would silently replace the whole sub-object, and an author would have to repeat
five fields to change one. The validator enforces it, and it also enforces that a patch never
touches the same field `growth.perLevel.own.field` grows, because the patch is applied AFTER the
per-level growth and would wipe it.

- [ ] **Step 1: Write the failing tests**

Add to `packages/content-schema/src/schema.test.ts`:

```ts
describe("validateSkillDef: gem growth", () => {
  const base = {
    id: "skill.test.v1",
    name: "Test",
    manaCostFixed: 0,
    cooldownTicks: 10,
    unlockLevel: 1,
    growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [] },
    effects: [
      {
        type: "spawnProjectile",
        speedPerSecFixed: 1000,
        radiusFixed: 300,
        maxRangeFixed: 14000,
        damage: { type: "physical", amountFixed: 11000 },
      },
    ],
  };

  it("accepts a minimal growth block", () => {
    expect(validateSkillDef(base).ok).toBe(true);
  });

  it("requires unlockLevel to be a positive integer", () => {
    expect(validateSkillDef({ ...base, unlockLevel: 0 }).ok).toBe(false);
    expect(validateSkillDef({ ...base, unlockLevel: 1.5 }).ok).toBe(false);
    const r = validateSkillDef({ ...base, unlockLevel: undefined });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("unlockLevel");
  });

  it("requires growth and its per-level percentages", () => {
    expect(validateSkillDef({ ...base, growth: undefined }).ok).toBe(false);
    expect(validateSkillDef({
      ...base, growth: { perLevel: { damagePct: -1, manaPct: 4 }, breakpoints: [] },
    }).ok).toBe(false);
  });

  it("accepts an authored own-scalar and rejects an unknown field", () => {
    expect(validateSkillDef({
      ...base,
      growth: {
        perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
        breakpoints: [],
      },
    }).ok).toBe(true);
    expect(validateSkillDef({
      ...base,
      growth: {
        perLevel: { damagePct: 6, manaPct: 4, own: { field: "notAField", perMille: 20 } },
        breakpoints: [],
      },
    }).ok).toBe(false);
  });

  it("allows at most two breakpoints, in ascending order", () => {
    const bp = (atLevel: number) => ({ atLevel, text: "x", patch: { pierceCount: 1 } });
    expect(validateSkillDef({
      ...base, growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [bp(5), bp(15)] },
    }).ok).toBe(true);
    expect(validateSkillDef({
      ...base, growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [bp(5), bp(15), bp(18)] },
    }).ok).toBe(false);
    expect(validateSkillDef({
      ...base, growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [bp(15), bp(5)] },
    }).ok).toBe(false);
  });

  it("rejects a breakpoint patch that is not a top-level scalar", () => {
    const r = validateSkillDef({
      ...base,
      growth: {
        perLevel: { damagePct: 6, manaPct: 4 },
        breakpoints: [{ atLevel: 5, text: "x", patch: { damage: { type: "fire", amountFixed: 1 } } }],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("scalar");
  });

  it("rejects a breakpoint that patches the field growth already grows", () => {
    const r = validateSkillDef({
      ...base,
      growth: {
        perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
        breakpoints: [{ atLevel: 5, text: "x", patch: { maxRangeFixed: 20000 } }],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toContain("maxRangeFixed");
  });

  it("rejects a breakpoint patch keyed on `type`", () => {
    expect(validateSkillDef({
      ...base,
      growth: {
        perLevel: { damagePct: 6, manaPct: 4 },
        breakpoints: [{ atLevel: 5, text: "x", patch: { type: "teleport" } }],
      },
    }).ok).toBe(false);
  });

  it("accepts pierceCount on a projectile and rejects a negative one", () => {
    const withPierce = { ...base, effects: [{ ...base.effects[0], pierceCount: 2 }] };
    expect(validateSkillDef(withPierce).ok).toBe(true);
    const bad = { ...base, effects: [{ ...base.effects[0], pierceCount: -1 }] };
    expect(validateSkillDef(bad).ok).toBe(false);
  });

  it("accepts an absent classId and rejects an empty one", () => {
    expect(validateSkillDef(base).ok).toBe(true);
    expect(validateSkillDef({ ...base, classId: "" }).ok).toBe(false);
    expect(validateSkillDef({ ...base, classId: "class.stalker" }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/content-schema`
Expected: FAIL — the current validator accepts `unlockLevel: 0` and knows nothing about `growth`.

- [ ] **Step 3: Add the types**

In `packages/content-schema/src/index.ts`, add `pierceCount` to the projectile node:

```ts
  | {
      type: "spawnProjectile";
      speedPerSecFixed: Fixed;
      radiusFixed: Fixed;
      maxRangeFixed: Fixed;
      damage: DamageSpec;
      /**
       * Extra bodies the bolt passes through before it is spent. Absent or 0 is
       * PoE's default: the first target stops it. This is the one new sim
       * mechanism gem breakpoints bring, and it is a field rather than a flag so
       * one breakpoint can widen what an earlier one opened.
       */
      pierceCount?: number;
    }
```

And, after `SkillDef`'s current fields, the growth block:

```ts
/**
 * Fields a skill's authored per-level scalar may grow. Deliberately a closed
 * list rather than `string`: an author's typo would otherwise be a scalar that
 * silently grows nothing, and no test can see the difference between that and a
 * skill whose growth is genuinely small.
 */
export const GROWTH_FIELDS = [
  "radiusFixed", "durationTicks", "distanceFixed", "reachFixed", "maxRangeFixed",
] as const;
export type GrowthField = (typeof GROWTH_FIELDS)[number];

/**
 * A behaviour change at a gem level, authored as data.
 *
 * `patch` is merged SHALLOWLY over `effects[0]`, so it may only set top-level
 * scalar keys. A nested patch would replace a whole sub-object and force an
 * author to repeat five fields to change one; the validator refuses it rather
 * than letting that become a habit.
 */
export interface SkillBreakpoint {
  atLevel: number;
  /** One line, shown in the tooltip and greyed out until it is reached. */
  text: string;
  patch: Record<string, number>;
}

export interface SkillGrowth {
  perLevel: {
    /** Compounding, applied per level above 1, to every hit and ailment number. */
    damagePct: number;
    /** Compounding, applied per level above 1, to manaCostFixed. */
    manaPct: number;
    /** One authored scalar, in per-mille of the def's own value, added per level above 1. */
    own?: { field: GrowthField; perMille: number };
  };
  /** At most two, ascending by atLevel. Zero is legal: not every skill earns one. */
  breakpoints: SkillBreakpoint[];
}
```

Then widen `SkillDef`:

```ts
export interface SkillDef {
  id: string;
  name: string;
  /** Prose for the tooltip's white block. Authored, never derived from effects. */
  description?: string;
  /** Absent means every class may use it. Enforced from day one; every skill
   *  authored today is classless (see docs/superpowers/specs §5). */
  classId?: string;
  /** Character level that grants this skill. Unlock is DERIVED from the level on
   *  every load, never stored, so a save cannot desync into a missing skill. */
  unlockLevel: number;
  growth: SkillGrowth;
  manaCostFixed: Fixed;
  cooldownTicks: number;
  /** Post-cast movement recovery, in ticks. Omitted/0 = instant, no slow. */
  castTicks?: number;
  /** The skill's own critical strike chance, whole percent. Omitted/0 = never crits. */
  critChancePct?: number;
  effects: EffectNode[];
}
```

- [ ] **Step 4: Add the validation**

In `validateEffectNode`, inside the `spawnProjectile` branch, after the `maxRangeFixed` check:

```ts
    if (v["pierceCount"] !== undefined && !isNonNegInt(v["pierceCount"])) {
      errors.push(`${path}.pierceCount: must be a non-negative integer when present`);
      ok = false;
    }
```

Add a growth validator above `validateSkillDef`:

```ts
function validateSkillGrowth(v: unknown, errors: string[]): void {
  if (!isObj(v)) {
    errors.push("growth: required object");
    return;
  }
  const per = v["perLevel"];
  if (!isObj(per)) {
    errors.push("growth.perLevel: required object");
    return;
  }
  for (const f of ["damagePct", "manaPct"] as const) {
    if (!isNonNegInt(per[f])) errors.push(`growth.perLevel.${f}: must be a non-negative integer`);
  }
  let ownField: string | undefined;
  const own = per["own"];
  if (own !== undefined) {
    if (!isObj(own)) {
      errors.push("growth.perLevel.own: must be an object when present");
    } else {
      const field = own["field"];
      if (typeof field !== "string" || !(GROWTH_FIELDS as readonly string[]).includes(field)) {
        errors.push(`growth.perLevel.own.field: must be one of ${GROWTH_FIELDS.join(", ")}`);
      } else {
        ownField = field;
      }
      if (!isNonNegInt(own["perMille"])) {
        errors.push("growth.perLevel.own.perMille: must be a non-negative integer");
      }
    }
  }
  const bps = v["breakpoints"];
  if (!Array.isArray(bps)) {
    errors.push("growth.breakpoints: must be an array");
    return;
  }
  if (bps.length > 2) errors.push("growth.breakpoints: at most two");
  let prev = 0;
  for (let i = 0; i < bps.length; i++) {
    const bp = bps[i];
    const path = `growth.breakpoints[${i}]`;
    if (!isObj(bp)) {
      errors.push(`${path}: must be an object`);
      continue;
    }
    const at = bp["atLevel"];
    if (!isPosInt(at)) {
      errors.push(`${path}.atLevel: must be a positive integer`);
    } else if ((at as number) <= prev) {
      errors.push(`${path}.atLevel: must be greater than the previous breakpoint`);
    } else {
      prev = at as number;
    }
    if (typeof bp["text"] !== "string" || bp["text"].length === 0) {
      errors.push(`${path}.text: must be a non-empty string`);
    }
    const patch = bp["patch"];
    if (!isObj(patch) || Object.keys(patch).length === 0) {
      errors.push(`${path}.patch: must be a non-empty object`);
      continue;
    }
    for (const [k, pv] of Object.entries(patch)) {
      // Shallow merge over effects[0]: only top-level scalars, or the patch
      // silently replaces a whole sub-object.
      if (typeof pv !== "number" || !Number.isInteger(pv)) {
        errors.push(`${path}.patch.${k}: must be an integer scalar`);
      }
      if (k === "type") errors.push(`${path}.patch.type: a breakpoint may not change the effect type`);
      if (ownField !== undefined && k === ownField) {
        errors.push(
          `${path}.patch.${k}: growth.perLevel.own already grows this field; the patch would wipe it`,
        );
      }
    }
  }
}
```

`isPosInt` is already defined lower in the file — move its declaration above
`validateSkillGrowth` (it is a plain `function` declaration and hoists, so no move is strictly
needed; leave it where it is).

In `validateSkillDef`, after the `critChancePct` check:

```ts
  if (!isPosInt(v["unlockLevel"])) {
    errors.push("unlockLevel: must be a positive integer");
  }
  if (v["classId"] !== undefined && (typeof v["classId"] !== "string" || v["classId"].length === 0)) {
    errors.push("classId: must be a non-empty string when present");
  }
  validateSkillGrowth(v["growth"], errors);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/content-schema`
Expected: PASS.

`packages/content-runtime` will now fail its module-load validation, because no skill carries the
new required fields yet. That is expected and Task 2 fixes it — but the full-suite gate below still
applies, so run the full suite, see exactly that failure and nothing else, and note it in your
report. Commit anyway: the two tasks are one contract, and splitting them is what lets a reviewer
reject the schema without rejecting the content.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run` and `npm run typecheck`
Expected: content-runtime and anything downstream of it fails on the missing `unlockLevel`/`growth`.
Everything else green. Report the exact failing files.

- [ ] **Step 7: Commit**

```bash
git add packages/content-schema/src/index.ts packages/content-schema/src/schema.test.ts
git commit -m "feat(content-schema): gem growth, unlock level and class on SkillDef"
```

---

### Task 2: Author the gem fields on every skill

**Files:**
- Modify: `packages/content-runtime/src/skills.ts`
- Test: `packages/content-runtime/src/content.test.ts`

**Interfaces:**
- Consumes: `SkillGrowth`, `GROWTH_FIELDS`, `pierceCount` from Task 1.
- Produces: the authored table below. Task 3's fixtures and Task 9's tooltip both read it.

**The table.** Unlock levels come from the spec §3. `own` is the one authored scalar. Breakpoints
sit at 5 and 15.

| Skill | unlock | own scalar | gem 5 | gem 15 |
|---|---|---|---|---|
| Strike | 1 | `reachFixed` +15‰ | `arcDegrees: 200` | `arcDegrees: 360` |
| Snap Shot | 1 | `maxRangeFixed` +20‰ | `pierceCount: 1` | `pierceCount: 2` |
| Ember Spark | 1 | `maxRangeFixed` +20‰ | `pierceCount: 1` | `pierceCount: 2` |
| Ember Bolt | 1 | `maxRangeFixed` +20‰ | `pierceCount: 1` | `pierceCount: 3` |
| Blink | 4 | `distanceFixed` +20‰ | — | — |
| Cinder Ground | 8 | `durationTicks` +25‰ | `radiusFixed: fp(3.5)` | `radiusFixed: fp(4.5)` |
| Portal | 10 | — | — | — |

Strike's arc and the three pierce lines are real behaviour changes: at gem 15 Strike hits every
body around the caster, and a bolt stops being a single-target answer. Blink and Portal earn none,
which the schema allows on purpose. Cinder Ground's two are radius rather than behaviour, and that
is the one weak spot in this table — flagged for the owner rather than invented around.

- [ ] **Step 1: Write the failing test**

Add to `packages/content-runtime/src/content.test.ts`, importing `MAX_GEM_LEVEL` is NOT needed here
(Task 3 owns it); keep this test purely about the authored data:

```ts
describe("skill unlocks and growth", () => {
  const UNLOCK: Record<string, number> = {
    "skill.strike.v1": 1,
    "skill.snap_shot.v1": 1,
    "skill.ember_spark.v1": 1,
    "skill.ember_bolt.v1": 1,
    "skill.blink.v1": 4,
    "skill.cinder_ground.v1": 8,
    "skill.town_portal.v1": 10,
  };

  it("pins the unlock level of every skill, with no skill missing from the table", () => {
    expect(new Set(SKILLS.keys())).toEqual(new Set(Object.keys(UNLOCK)));
    for (const [id, level] of Object.entries(UNLOCK)) {
      expect(SKILLS.get(id)!.unlockLevel, id).toBe(level);
    }
  });

  it("every default attack is available at character level 1", () => {
    for (const id of Object.values(DEFAULT_ATTACK_BY_CLASS)) {
      expect(SKILLS.get(id)!.unlockLevel, id).toBe(1);
    }
  });

  it("every skill is authored classless until the class kits land", () => {
    for (const [id, def] of SKILLS) {
      expect(def.classId, id).toBeUndefined();
    }
  });

  it("every skill grows damage and mana, mana never faster than damage", () => {
    for (const [id, def] of SKILLS) {
      expect(def.growth.perLevel.damagePct, id).toBe(6);
      expect(def.growth.perLevel.manaPct, id).toBe(4);
    }
  });

  it("pins the two behaviour breakpoints that change what a skill DOES", () => {
    const strike = SKILLS.get("skill.strike.v1")!.growth.breakpoints;
    expect(strike.map((b) => b.atLevel)).toEqual([5, 15]);
    expect(strike[1]!.patch["arcDegrees"]).toBe(360);

    const bolt = SKILLS.get("skill.ember_bolt.v1")!.growth.breakpoints;
    expect(bolt.map((b) => b.atLevel)).toEqual([5, 15]);
    expect(bolt[0]!.patch["pierceCount"]).toBe(1);
    expect(bolt[1]!.patch["pierceCount"]).toBe(3);
  });

  it("leaves the movement and utility skills without breakpoints", () => {
    expect(SKILLS.get("skill.blink.v1")!.growth.breakpoints).toEqual([]);
    expect(SKILLS.get("skill.town_portal.v1")!.growth.breakpoints).toEqual([]);
  });

  it("every breakpoint names a top-level key of its own first effect", () => {
    for (const [id, def] of SKILLS) {
      const first = def.effects[0]! as unknown as Record<string, unknown>;
      for (const bp of def.growth.breakpoints) {
        for (const key of Object.keys(bp.patch)) {
          expect(Object.hasOwn(first, key), `${id}: ${key}`).toBe(true);
        }
      }
    }
  });

  it("every authored own-scalar names a field its own first effect actually has", () => {
    for (const [id, def] of SKILLS) {
      const own = def.growth.perLevel.own;
      if (!own) continue;
      const first = def.effects[0]! as unknown as Record<string, unknown>;
      expect(Object.hasOwn(first, own.field), `${id}: ${own.field}`).toBe(true);
      expect(own.perMille, id).toBeGreaterThan(0);
    }
  });
});
```

Note the last two tests: they are the ones with teeth. A patch or a scalar naming a field the effect
does not have would validate fine at the schema level and then grow nothing at runtime, which is
exactly the failure no other test can see.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/content-runtime`
Expected: FAIL — module load throws on the missing `unlockLevel`/`growth`.

- [ ] **Step 3: Author the fields**

In `packages/content-runtime/src/skills.ts`, add to each def. Ember Bolt:

```ts
    unlockLevel: 1,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
      breakpoints: [
        { atLevel: 5, text: "Pierces one enemy", patch: { pierceCount: 1 } },
        { atLevel: 15, text: "Pierces three enemies", patch: { pierceCount: 3 } },
      ],
    },
```

Cinder Ground:

```ts
    unlockLevel: 8,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "durationTicks", perMille: 25 } },
      breakpoints: [
        { atLevel: 5, text: "Scorches a wider patch", patch: { radiusFixed: fp(3.5) } },
        { atLevel: 15, text: "Scorches a far wider patch", patch: { radiusFixed: fp(4.5) } },
      ],
    },
```

Strike:

```ts
    unlockLevel: 1,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "reachFixed", perMille: 15 } },
      breakpoints: [
        { atLevel: 5, text: "Swings a wider arc", patch: { arcDegrees: 200 } },
        { atLevel: 15, text: "Swings all the way around you", patch: { arcDegrees: 360 } },
      ],
    },
```

Snap Shot:

```ts
    unlockLevel: 1,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
      breakpoints: [
        { atLevel: 5, text: "Pierces one enemy", patch: { pierceCount: 1 } },
        { atLevel: 15, text: "Pierces two enemies", patch: { pierceCount: 2 } },
      ],
    },
```

Ember Spark:

```ts
    unlockLevel: 1,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
      breakpoints: [
        { atLevel: 5, text: "Pierces one enemy", patch: { pierceCount: 1 } },
        { atLevel: 15, text: "Pierces two enemies", patch: { pierceCount: 2 } },
      ],
    },
```

Portal:

```ts
    unlockLevel: 10,
    growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [] },
```

Blink:

```ts
    unlockLevel: 4,
    growth: {
      perLevel: { damagePct: 6, manaPct: 4, own: { field: "distanceFixed", perMille: 20 } },
      breakpoints: [],
    },
```

Add a comment above `SKILL_DEFS` explaining the table:

```ts
/*
 * Every skill carries an unlock level and a growth block (docs/superpowers/specs/
 * 2026-08-10-skill-acquisition-design.md). Unlock levels are chosen so a
 * character has a kit inside the first hour and the rest of the climb is gem
 * levels rather than new icons.
 *
 * `own` is the ONE authored scalar a level grows beyond damage and mana, and no
 * breakpoint may patch the same field (the schema refuses it) because the patch
 * lands after the growth and would wipe it.
 *
 * Blink and Portal have no breakpoints on purpose: PoE1 gives its movement and
 * utility gems almost nothing per level either, and inventing two behaviour
 * changes for a teleport would be a rule nobody asked for.
 */
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/content-runtime`
Expected: PASS.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run` and `npm run typecheck`
Expected: both green. Any other package that constructs a `SkillDef` literal in a test fixture will
now fail to typecheck — fix those fixtures by adding `unlockLevel: 1` and a minimal `growth`, and
list every file you touched in your report.

- [ ] **Step 6: Commit**

```bash
git add packages/content-runtime/src/skills.ts packages/content-runtime/src/content.test.ts
git commit -m "feat(content): author unlock levels and gem growth on every skill"
```

---

### Task 3: `packages/rules/src/skill-xp.ts`

**Files:**
- Create: `packages/rules/src/skill-xp.ts`
- Create: `packages/rules/src/skill-xp.test.ts`
- Modify: `packages/rules/src/index.ts`

**Interfaces:**
- Consumes: `SkillDef`, `SkillBreakpoint` from `@exiled/content-schema`.
- Produces, and every later task calls exactly these:

```ts
export const MAX_GEM_LEVEL: number;                                        // 20
export interface Gem { level: number; xp: number }
export function maxGemLevel(charLevel: number): number;
export function gemXpToNext(gemLevel: number): number;
export function isUnlocked(def: SkillDef, charLevel: number, classId: string): boolean;
export function splitGemXp(award: number, occupiedSlots: number): number;
export function gainGemXp(gem: Gem, amount: number, cap: number): Gem;
export function effectiveSkill(def: SkillDef, gemLevel: number): SkillDef;
export function reachedBreakpoints(def: SkillDef, gemLevel: number): SkillBreakpoint[];
export function nextBreakpoint(def: SkillDef, gemLevel: number): SkillBreakpoint | null;
```

**The curve.** `gemXpToNext(level) = 60 * level * level`, the same quadratic shape as the character
curve for the same reason (a kill's value grows only linearly with area level), at twice the
coefficient because a gem's climb is 19 levels rather than 99. Reaching gem 20 costs 148,200 gem
experience; with three skills on the bar the split means about 444,600 character experience, which
lands around character level 35, and with a full eight-slot bar around 47. Gems therefore trail the
character comfortably and the `min(20, charLevel)` cap almost never binds — it exists for the
character who parks on one skill, not as a pacing device. The test pins that **band**, not the
constant, so the constant can be retuned without anyone having to guess what it protected.

**A gem holds experience past its cap** and pops the instant a character level allows it, so a
level-up can pay twice (spec §4). `gainGemXp` therefore banks the overflow rather than discarding
it, and only stops levelling at `MAX_GEM_LEVEL`.

- [ ] **Step 1: Write the failing tests**

Create `packages/rules/src/skill-xp.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import type { SkillDef } from "@exiled/content-schema";
import {
  MAX_GEM_LEVEL, maxGemLevel, gemXpToNext, isUnlocked, splitGemXp, gainGemXp,
  effectiveSkill, reachedBreakpoints, nextBreakpoint,
} from "./skill-xp";

const bolt: SkillDef = {
  id: "skill.fixture_bolt.v1",
  name: "Fixture Bolt",
  unlockLevel: 4,
  manaCostFixed: fp(10),
  cooldownTicks: 30,
  growth: {
    perLevel: { damagePct: 6, manaPct: 4, own: { field: "maxRangeFixed", perMille: 20 } },
    breakpoints: [
      { atLevel: 5, text: "Pierces one enemy", patch: { pierceCount: 1 } },
      { atLevel: 15, text: "Pierces three enemies", patch: { pierceCount: 3 } },
    ],
  },
  effects: [{
    type: "spawnProjectile",
    speedPerSecFixed: fp(12),
    radiusFixed: fp(0.4),
    maxRangeFixed: fp(20),
    damage: { type: "fire", amountFixed: fp(36) },
  }],
};

const ground: SkillDef = {
  id: "skill.fixture_ground.v1",
  name: "Fixture Ground",
  unlockLevel: 8,
  manaCostFixed: fp(20),
  cooldownTicks: 90,
  growth: { perLevel: { damagePct: 6, manaPct: 4 }, breakpoints: [] },
  effects: [{
    type: "spawnGroundArea",
    radiusFixed: fp(2.5),
    durationTicks: 90,
    ailment: { kind: "burning", stacksPerApply: 1, dpsFixed: fp(8), durationTicks: 60, maxStacks: 5 },
  }],
};

describe("maxGemLevel", () => {
  it("is the character level until 20, then 20 forever", () => {
    expect(maxGemLevel(1)).toBe(1);
    expect(maxGemLevel(7)).toBe(7);
    expect(maxGemLevel(20)).toBe(20);
    expect(maxGemLevel(100)).toBe(MAX_GEM_LEVEL);
  });

  it("never returns less than 1, whatever nonsense it is handed", () => {
    expect(maxGemLevel(0)).toBe(1);
    expect(maxGemLevel(-5)).toBe(1);
  });
});

describe("gemXpToNext", () => {
  it("is zero at the cap and rising below it", () => {
    expect(gemXpToNext(MAX_GEM_LEVEL)).toBe(0);
    expect(gemXpToNext(1)).toBeGreaterThan(0);
    for (let l = 1; l < MAX_GEM_LEVEL - 1; l++) {
      expect(gemXpToNext(l + 1)).toBeGreaterThan(gemXpToNext(l));
    }
  });

  it("costs a whole climb to cap: gem 20 lands between character 30 and 55", () => {
    // The band, not the constant. Total gem experience for the whole climb...
    let total = 0;
    for (let l = 1; l < MAX_GEM_LEVEL; l++) total += gemXpToNext(l);
    // ...is earned as one THIRD of the character's, on a three-skill bar.
    const charXpNeeded = total * 3;
    // Invert the character curve (xpToNext = 30 * l * l) by walking it.
    let acc = 0;
    let charLevel = 1;
    while (acc < charXpNeeded && charLevel < 100) {
      acc += 30 * charLevel * charLevel;
      charLevel++;
    }
    expect(charLevel).toBeGreaterThan(30);
    expect(charLevel).toBeLessThan(55);
  });
});

describe("isUnlocked", () => {
  it("opens at exactly the authored level and never before", () => {
    expect(isUnlocked(bolt, 3, "class.stalker")).toBe(false);
    expect(isUnlocked(bolt, 4, "class.stalker")).toBe(true);
    expect(isUnlocked(bolt, 100, "class.stalker")).toBe(true);
  });

  it("a classless skill belongs to everyone", () => {
    for (const c of ["class.stalker", "class.ironsworn", "class.emberbound", ""]) {
      expect(isUnlocked(bolt, 4, c), c).toBe(true);
    }
  });

  it("a class-restricted skill is refused to every other class, at any level", () => {
    const owned: SkillDef = { ...bolt, classId: "class.emberbound" };
    expect(isUnlocked(owned, 100, "class.emberbound")).toBe(true);
    expect(isUnlocked(owned, 100, "class.stalker")).toBe(false);
    expect(isUnlocked(owned, 100, "")).toBe(false);
  });
});

describe("splitGemXp", () => {
  it("divides evenly and truncates per slot", () => {
    expect(splitGemXp(100, 1)).toBe(100);
    expect(splitGemXp(100, 2)).toBe(50);
    expect(splitGemXp(100, 5)).toBe(20);
    expect(splitGemXp(101, 5)).toBe(20);   // the remainder is dropped, not banked
    expect(splitGemXp(3, 5)).toBe(0);
  });

  it("is zero rather than infinite on an empty bar", () => {
    expect(splitGemXp(100, 0)).toBe(0);
    expect(splitGemXp(100, -1)).toBe(0);
  });
});

describe("gainGemXp", () => {
  it("levels once, and loops for an award that crosses two thresholds", () => {
    const one = gainGemXp({ level: 1, xp: 0 }, gemXpToNext(1), 20);
    expect(one.level).toBe(2);
    expect(one.xp).toBe(0);

    const two = gainGemXp({ level: 1, xp: 0 }, gemXpToNext(1) + gemXpToNext(2), 20);
    expect(two.level).toBe(3);
  });

  it("BANKS experience past the cap instead of burning it, and pops when the cap rises", () => {
    const parked = gainGemXp({ level: 3, xp: 0 }, gemXpToNext(3) * 4, 3);
    expect(parked.level).toBe(3);
    expect(parked.xp).toBeGreaterThan(gemXpToNext(3));
    // The character levels; nothing else changes. The banked experience pays now.
    const popped = gainGemXp(parked, 0, 5);
    expect(popped.level).toBe(5);
  });

  it("stops dead at MAX_GEM_LEVEL and banks nothing there", () => {
    const capped = gainGemXp({ level: MAX_GEM_LEVEL, xp: 0 }, 10_000_000, MAX_GEM_LEVEL);
    expect(capped).toEqual({ level: MAX_GEM_LEVEL, xp: 0 });
  });
});

describe("effectiveSkill", () => {
  it("is the def itself at gem 1", () => {
    const at1 = effectiveSkill(bolt, 1);
    expect(at1.manaCostFixed).toBe(bolt.manaCostFixed);
    const e = at1.effects[0]!;
    if (e.type !== "spawnProjectile") throw new Error("wrong effect");
    expect(e.damage.amountFixed).toBe(fp(36));
    expect(e.maxRangeFixed).toBe(fp(20));
    expect(e.pierceCount).toBeUndefined();
  });

  it("compounds damage 6% and mana 4% per level, so damage outruns cost", () => {
    const at20 = effectiveSkill(bolt, 20);
    const e = at20.effects[0]!;
    if (e.type !== "spawnProjectile") throw new Error("wrong effect");
    // 1.06^19 is about 3.03, 1.04^19 about 2.11.
    expect(e.damage.amountFixed).toBeGreaterThan(fp(36) * 2.9);
    expect(e.damage.amountFixed).toBeLessThan(fp(36) * 3.2);
    expect(at20.manaCostFixed).toBeGreaterThan(fp(10) * 2.0);
    expect(at20.manaCostFixed).toBeLessThan(fp(10) * 2.3);
    const damageRatio = e.damage.amountFixed / fp(36);
    const manaRatio = at20.manaCostFixed / fp(10);
    expect(damageRatio).toBeGreaterThan(manaRatio);
  });

  it("adds the authored own-scalar linearly, in per-mille of the def's own value", () => {
    // 20 per-mille of fp(20) is fp(0.4) per level above 1.
    expect(pierceRange(effectiveSkill(bolt, 2))).toBe(fp(20) + fp(0.4));
    expect(pierceRange(effectiveSkill(bolt, 11))).toBe(fp(20) + fp(0.4) * 10);
  });

  it("scales an ailment's damage too, or a ground skill gains nothing from a level", () => {
    const at10 = effectiveSkill(ground, 10);
    const e = at10.effects[0]!;
    if (e.type !== "spawnGroundArea") throw new Error("wrong effect");
    expect(e.ailment.dpsFixed).toBeGreaterThan(fp(8));
  });

  it("applies every breakpoint reached, in order, the later one winning", () => {
    expect(pierceOf(effectiveSkill(bolt, 4))).toBeUndefined();
    expect(pierceOf(effectiveSkill(bolt, 5))).toBe(1);
    expect(pierceOf(effectiveSkill(bolt, 14))).toBe(1);
    expect(pierceOf(effectiveSkill(bolt, 15))).toBe(3);
    expect(pierceOf(effectiveSkill(bolt, 20))).toBe(3);
  });

  it("never mutates the def it was handed", () => {
    const before = JSON.stringify(bolt);
    effectiveSkill(bolt, 20);
    expect(JSON.stringify(bolt)).toBe(before);
  });

  it("returns only integers, because a component value that is not one throws", () => {
    for (let l = 1; l <= 20; l++) {
      const s = effectiveSkill(bolt, l);
      expect(Number.isInteger(s.manaCostFixed), `mana at ${l}`).toBe(true);
      const e = s.effects[0]!;
      if (e.type !== "spawnProjectile") throw new Error("wrong effect");
      expect(Number.isInteger(e.damage.amountFixed), `damage at ${l}`).toBe(true);
      expect(Number.isInteger(e.maxRangeFixed), `range at ${l}`).toBe(true);
    }
  });
});

describe("breakpoint queries", () => {
  it("reachedBreakpoints grows as the gem does", () => {
    expect(reachedBreakpoints(bolt, 4)).toHaveLength(0);
    expect(reachedBreakpoints(bolt, 5)).toHaveLength(1);
    expect(reachedBreakpoints(bolt, 15)).toHaveLength(2);
  });

  it("nextBreakpoint is the grey line the tooltip shows, and null once there are none", () => {
    expect(nextBreakpoint(bolt, 1)!.atLevel).toBe(5);
    expect(nextBreakpoint(bolt, 5)!.atLevel).toBe(15);
    expect(nextBreakpoint(bolt, 15)).toBeNull();
    expect(nextBreakpoint(ground, 1)).toBeNull();
  });
});

function pierceOf(def: SkillDef): number | undefined {
  const e = def.effects[0]!;
  return e.type === "spawnProjectile" ? e.pierceCount : undefined;
}
function pierceRange(def: SkillDef): number {
  const e = def.effects[0]!;
  if (e.type !== "spawnProjectile") throw new Error("wrong effect");
  return e.maxRangeFixed;
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/rules/src/skill-xp.test.ts`
Expected: FAIL — `./skill-xp` does not exist.

- [ ] **Step 3: Write the implementation**

Create `packages/rules/src/skill-xp.ts`:

```ts
// Gem levels: what a skill's own experience buys. Pure integers, like every other
// rule the sim reads — a gem level happens inside a tick and has to replay
// identically.
import type { EffectNode, SkillBreakpoint, SkillDef } from "@exiled/content-schema";

/** PoE1 stops an unsupported gem at 20, and so does this one. */
export const MAX_GEM_LEVEL = 20;

export interface Gem { level: number; xp: number }

/**
 * A gem may not outlevel its bearer. The character level IS the cap below 20,
 * which is what stops a level-1 character walking a first map with a gem 20
 * skill he was handed by a shared bar.
 */
export function maxGemLevel(charLevel: number): number {
  return Math.min(MAX_GEM_LEVEL, Math.max(1, Math.trunc(charLevel)));
}

/**
 * Experience needed to leave `gemLevel`. Zero at the cap: nothing to buy.
 *
 * Quadratic for the same reason the character curve is (`xp.ts`): a kill's value
 * grows only LINEARLY with area level, so a steeper curve stops paying at all.
 * Twice the character coefficient because the climb is 19 levels rather than 99.
 * The whole climb costs 148,200, which on a three-skill bar is about 444,600
 * character experience and lands gem 20 near character 35; a full eight-slot bar
 * pushes it to about 47. `skill-xp.test.ts` pins that BAND, not this constant.
 */
export function gemXpToNext(gemLevel: number): number {
  if (gemLevel >= MAX_GEM_LEVEL) return 0;
  return 60 * gemLevel * gemLevel;
}

/**
 * Whether a character has this skill at all. DERIVED, never stored: recomputing
 * from the level on every load means a save cannot desync into a missing skill,
 * and a retuned unlock table takes effect for characters that already exist.
 */
export function isUnlocked(def: SkillDef, charLevel: number, classId: string): boolean {
  if (def.classId !== undefined && def.classId !== classId) return false;
  return def.unlockLevel <= charLevel;
}

/**
 * One kill's experience, per occupied bar slot. Truncated per slot rather than
 * distributed with a remainder: the remainder is a fraction of one kill, and
 * carrying it would put a running balance in the save for nothing.
 */
export function splitGemXp(award: number, occupiedSlots: number): number {
  if (occupiedSlots <= 0) return 0;
  return Math.trunc(award / occupiedSlots);
}

/**
 * Apply an award to one gem, capped at `cap` (the character's `maxGemLevel`).
 *
 * A capped gem BANKS what it earns rather than burning it, and pops the instant
 * the cap rises — so a character level can pay twice, once for itself and once
 * for every gem that was waiting on it. Intensity over density (docs/09 rule 3).
 * Only MAX_GEM_LEVEL is a floor on that: there is nothing left to bank for.
 */
export function gainGemXp(gem: Gem, amount: number, cap: number): Gem {
  if (gem.level >= MAX_GEM_LEVEL) return { level: MAX_GEM_LEVEL, xp: 0 };
  let level = gem.level;
  let xp = gem.xp + amount;
  const ceiling = Math.min(MAX_GEM_LEVEL, Math.max(1, Math.trunc(cap)));
  while (level < ceiling && xp >= gemXpToNext(level)) {
    xp -= gemXpToNext(level);
    level++;
  }
  return level >= MAX_GEM_LEVEL ? { level: MAX_GEM_LEVEL, xp: 0 } : { level, xp };
}

/** Compound `pct` percent, `times` times, truncating at every step so it replays. */
function compound(value: number, pct: number, times: number): number {
  let v = value;
  for (let i = 0; i < times; i++) v = Math.trunc((v * (100 + pct)) / 100);
  return v;
}

/** Fields on an effect node that carry a damage number the gem level scales. */
function scaleDamage(effect: EffectNode, pct: number, times: number): EffectNode {
  if (effect.type === "spawnProjectile" || effect.type === "meleeStrike") {
    return {
      ...effect,
      damage: { ...effect.damage, amountFixed: compound(effect.damage.amountFixed, pct, times) },
    };
  }
  if (effect.type === "spawnGroundArea") {
    // The ailment IS the skill's damage here, so a level has to reach it. This is
    // deliberately unlike gear's spellDamagePct, which PoE keeps off ailments
    // (see skillCast): a gem level is the gem's own power, not an external mod.
    return {
      ...effect,
      ailment: { ...effect.ailment, dpsFixed: compound(effect.ailment.dpsFixed, pct, times) },
    };
  }
  return effect;
}

/**
 * The def this character actually casts, at this gem level.
 *
 * One fold, called by BOTH `skillCast` and `describeSkills`, which is the only
 * reason the tooltip can promise exactly what the cast does. Order matters: the
 * per-level growth lands first and the breakpoint patches land on top, which is
 * why the schema refuses a patch of the same field the growth grows.
 */
export function effectiveSkill(def: SkillDef, gemLevel: number): SkillDef {
  const level = Math.min(MAX_GEM_LEVEL, Math.max(1, Math.trunc(gemLevel)));
  const steps = level - 1;
  const { damagePct, manaPct, own } = def.growth.perLevel;

  let effects = def.effects.map((e) => scaleDamage(e, damagePct, steps));

  if (own && effects.length > 0) {
    const first = effects[0]! as unknown as Record<string, unknown>;
    const base = first[own.field];
    if (typeof base === "number") {
      // Linear in the def's OWN value, not compounding: this is the authored
      // flavour scalar, and a compounding radius reaches the far wall.
      const grown = base + Math.trunc((base * own.perMille * steps) / 1000);
      effects = [{ ...(effects[0] as object), [own.field]: grown } as EffectNode, ...effects.slice(1)];
    }
  }

  for (const bp of def.growth.breakpoints) {
    if (bp.atLevel > level || effects.length === 0) continue;
    effects = [{ ...(effects[0] as object), ...bp.patch } as EffectNode, ...effects.slice(1)];
  }

  return { ...def, manaCostFixed: compound(def.manaCostFixed, manaPct, steps), effects };
}

/** Every breakpoint this gem has already crossed, in authored order. */
export function reachedBreakpoints(def: SkillDef, gemLevel: number): SkillBreakpoint[] {
  return def.growth.breakpoints.filter((b) => b.atLevel <= gemLevel);
}

/**
 * The one the tooltip greys out. That grey line is where the anticipation lives
 * (docs/09 rule 1), so it is the cheapest device in the whole design.
 */
export function nextBreakpoint(def: SkillDef, gemLevel: number): SkillBreakpoint | null {
  return def.growth.breakpoints.find((b) => b.atLevel > gemLevel) ?? null;
}
```

- [ ] **Step 4: Export it**

In `packages/rules/src/index.ts`, add alongside the other re-exports:

```ts
export * from "./skill-xp.js";
```

Match the extension convention already used in that file (check whether the neighbours use `.js`
and copy them exactly).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/rules`
Expected: PASS.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run` and `npm run typecheck`
Expected: both green.

- [ ] **Step 7: Commit**

```bash
git add packages/rules/src/skill-xp.ts packages/rules/src/skill-xp.test.ts packages/rules/src/index.ts
git commit -m "feat(rules): gem levels, their curve, the award split and the level fold"
```

---

### Task 4: Pierce

**Files:**
- Modify: `packages/simulation/src/components.ts` (`ProjectileC`)
- Modify: `packages/simulation/src/systems/skill-cast.ts` (spawn)
- Modify: `packages/simulation/src/systems/projectile.ts` (travel)
- Test: `packages/simulation/src/systems/projectile.test.ts`

**Interfaces:**
- Consumes: `pierceCount` from Task 1.
- Produces: `ProjectileC.pierceLeft?: number` and `ProjectileC.hitIds?: number[]`.

**Why a hit list.** Today a bolt stops on its first target and `newRange = 0` is what prevents a
second hit on the same body. A piercing bolt keeps flying while still overlapping the body it just
hit, so without a list of what it has already struck it deals damage every tick until it clears the
hitbox. `hitIds` is a plain array of entity ids, which `checksum.ts` serializes element by element.

- [ ] **Step 1: Write the failing tests**

Add to `packages/simulation/src/systems/projectile.test.ts`, following the existing setup helpers in
that file (read them first; do not invent a new harness):

```ts
it("a bolt with no pierce is spent on the first body, as it always was", () => {
  // Two monsters in a line. Build with the file's existing helper, then step.
  // Assert: the first takes damage, the second never does, and remainingRange is 0.
});

it("a bolt with pierceLeft 1 hits two bodies in a line and stops at the second", () => {
  // Assert both monsters took damage and the projectile is spent after the second.
});

it("a piercing bolt never hits the same body twice while it is still inside it", () => {
  // One monster, wide body, several ticks of overlap.
  // Assert exactly one damage event for that target.
});
```

Write these out concretely against the helpers already in the file. The third is the one with teeth:
without `hitIds` it fails by dealing damage on every tick of overlap.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/simulation/src/systems/projectile.test.ts`
Expected: FAIL on the two pierce tests.

- [ ] **Step 3: Widen `ProjectileC`**

In `packages/simulation/src/components.ts`, add to `ProjectileC`:

```ts
  /** Bodies this bolt may still pass through. Absent or 0 = spent on the first,
   *  which is every projectile in the game below gem 5. */
  pierceLeft?: number;
  /** Entities already struck, so a bolt still overlapping a body it pierced does
   *  not hit it again every tick. Only ever set on a piercing bolt. */
  hitIds?: number[];
```

- [ ] **Step 4: Spawn it**

In `skill-cast.ts`'s `spawnProjectile` branch, add to the `world.set<ProjectileC>` call:

```ts
          ...(effect.pierceCount ? { pierceLeft: effect.pierceCount, hitIds: [] } : {}),
```

Spread conditionally so a non-piercing bolt's component is byte-identical to what it was, and the
golden replays that only ever fire non-piercing bolts do not move.

- [ ] **Step 5: Fly it**

In `projectile.ts`, replace the hit loop's `newRange = 0; break;` with:

```ts
        if (dist2 <= combinedR2Fn(bodyRadiusOf(world, m))) {
          if (hitIds && hitIds.includes(m)) continue;
          sim.enqueueDamage({
            target: m,
            source: proj.ownerId,
            amountFixed: proj.damageAmount,
            type: proj.damageType,
          });
          if (pierceLeft > 0) {
            pierceLeft--;
            hitIds = [...(hitIds ?? []), m];
            continue; // keeps flying, and may strike a second body this same tick
          }
          newRange = 0; // spent
          break;
        }
```

with, above the loop:

```ts
      let pierceLeft = proj.pierceLeft ?? 0;
      let hitIds = proj.hitIds;
```

and the write at the bottom becoming:

```ts
      world.set<ProjectileC>(e, "projectile", {
        ...proj,
        remainingRange: newRange,
        ...(proj.pierceLeft !== undefined ? { pierceLeft, hitIds: hitIds ?? [] } : {}),
      });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/simulation/src/systems/projectile.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npx vitest run` and `npm run typecheck`
Expected: both green, **including the golden replays**. If a golden checksum moved, stop: it means
the non-piercing path was not left byte-identical, and that is a bug in this task rather than a
checksum to regenerate. Report it.

- [ ] **Step 8: Commit**

```bash
git add packages/simulation/src/components.ts packages/simulation/src/systems/skill-cast.ts packages/simulation/src/systems/projectile.ts packages/simulation/src/systems/projectile.test.ts
git commit -m "feat(sim): projectiles can pierce, tracked per bolt so overlap hits once"
```

---

### Task 5: `SkillsC` — the component, its construction, its persistence

**Files:**
- Modify: `packages/protocol/src/index.ts` (the bar's shape constants)
- Modify: `packages/simulation/src/components.ts`
- Modify: `packages/simulation/src/combat-sim.ts`
- Modify: `packages/simulation/src/persist.ts`
- Test: `packages/simulation/src/persist.test.ts`

**Interfaces:**
- Consumes: `isUnlocked`, `maxGemLevel` from Task 3.
- Produces:

```ts
// @exiled/protocol
export const SKILL_SLOT_COUNT = 8;
export const MOUSE_SLOT_BASE = 5;
export const MOVE_SOCKET = "builtin.move";

// @exiled/simulation components
export interface SkillsC {
  /** skill id -> its gem. Only unlocked skills appear. */
  gems: Record<string, { level: number; xp: number }>;
  /** The action bar, SKILL_SLOT_COUNT long. `null` is empty; MOVE_SOCKET is the
   *  left-click movement sentinel and is not a skill. */
  bar: (string | null)[];
}

// @exiled/simulation persist
export function grantSkills(world: World): void;   // idempotent: adds newly unlocked gems, keeps existing ones
export function defaultBar(classId: string): (string | null)[];
```

**Why the constants move.** The bar is now sim state that rides in the save, so its length is part
of the contract between the worker and the client, not a client preference. `SKILL_SLOT_COUNT`,
`MOUSE_SLOT_BASE` and `MOVE_SOCKET` therefore belong in `@exiled/protocol`. `apps/web/src/settings.ts`
re-exports all three so no client import site has to change in this task.

- [ ] **Step 1: Write the failing tests**

Add to `packages/simulation/src/persist.test.ts` (read its existing world-building helpers first and
use them):

```ts
describe("skills persistence", () => {
  it("a fresh world has a gem for every skill level 1 unlocks and none it does not", () => {
    // Build a world at START_LEVEL. Assert: the class default attack and
    // ember_bolt have gems at level 1 and xp 0; blink, cinder_ground and
    // town_portal have none.
  });

  it("a level-up grants the gems that level opened, leaving the ones already held alone", () => {
    // Set progress.level to 10, call grantSkills, assert blink/cinder_ground/
    // town_portal appeared and an existing gem's level and xp were not reset.
  });

  it("snapshot round-trips gems and the bar", () => {
    // snapshot() then restore() into a fresh world; assert deep equality.
  });

  it("a save written with NO skills field restores with the bar seeded and the gems granted", () => {
    const state = { ...someSnapshot, progress: { level: 12, xp: 0, gold: 0 } };
    delete (state as Record<string, unknown>)["skills"];
    restore(freshWorld, state as PersistedState);
    const skills = freshWorld.get<SkillsC>(sessionOf(freshWorld), "skills")!;
    expect(Object.keys(skills.gems).length).toBeGreaterThan(0);
    expect(skills.bar).toHaveLength(SKILL_SLOT_COUNT);
    // Every id on the seeded bar is either a granted gem or the move sentinel.
    for (const id of skills.bar) {
      if (id === null || id === MOVE_SOCKET) continue;
      expect(Object.hasOwn(skills.gems, id), id).toBe(true);
    }
  });

  it("persist.VERSION is still 2, so no existing character is dropped", () => {
    expect(VERSION).toBe(2);
  });

  it("a gem never restores above what the character level allows", () => {
    // Hand-write a state whose gem is level 20 on a level-3 character; assert the
    // restored gem is clamped to maxGemLevel(3) === 3. A save can be edited, and a
    // gem 20 skill on a level-3 character walks the first map trivially.
  });
});
```

The last one has teeth against a bug no other test can see: `restore` reading a hand-edited save.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/simulation/src/persist.test.ts`
Expected: FAIL — there is no `skills` component.

- [ ] **Step 3: Move the bar constants into the protocol**

In `packages/protocol/src/index.ts`, near `MAP_PORTALS`:

```ts
/**
 * Total action-bar sockets: 5 numbered (keys 1-5) then L, M, R mouse. The HUD
 * draws them as two rows and MUST slice to MOUSE_SLOT_BASE for the numbered row.
 *
 * Protocol-level rather than a client preference since the bar became per-character
 * sim state: gem experience is earned by the SLOT, so its length is part of the
 * contract between worker and client.
 */
export const SKILL_SLOT_COUNT = 8;
export const MOUSE_SLOT_BASE = 5;
/** Left click's default. A sentinel, not null: clearing L gives movement back.
 *  Never a skill id, so it is skipped by the gem experience split. */
export const MOVE_SOCKET = "builtin.move";
```

In `apps/web/src/settings.ts`, delete the three local declarations and re-export instead:

```ts
export { SKILL_SLOT_COUNT, MOUSE_SLOT_BASE, MOVE_SOCKET } from "@exiled/protocol";
```

- [ ] **Step 4: Add `SkillsC`**

In `packages/simulation/src/components.ts`, beside `ProgressC`:

```ts
/**
 * Which skills this character has, what each one has earned, and where they sit.
 *
 * The bar lives here rather than in client settings because experience is earned
 * by the SLOT: a shared, global bar cannot survive characters whose skills differ
 * and whose gems level at different rates. Only unlocked skills appear in `gems`;
 * unlock itself is DERIVED from the character level (`isUnlocked`), never stored.
 */
export interface SkillsC {
  gems: Record<string, { level: number; xp: number }>;
  bar: (string | null)[];
}
```

- [ ] **Step 5: Grant and seed**

In `packages/simulation/src/persist.ts`, add above `restore`:

```ts
/**
 * The bar a character starts with: his class's default attack on left click's
 * neighbour, Ember Bolt on 1, and movement where PoE1 puts it.
 */
export function defaultBar(classId: string): (string | null)[] {
  const bar: (string | null)[] = new Array(SKILL_SLOT_COUNT).fill(null);
  bar[0] = "skill.ember_bolt.v1";
  bar[MOUSE_SLOT_BASE] = MOVE_SOCKET;
  bar[MOUSE_SLOT_BASE + 2] = defaultAttackFor(classId);
  return bar;
}

/**
 * Bring the gem list level with the character. Idempotent and additive: a skill
 * the level now opens gets a gem at 1, a skill already held is left exactly as
 * it is, and nothing is ever taken away. Called on every load and on every
 * character level, which is why unlock can be derived rather than stored.
 */
export function grantSkills(world: World): void {
  const e = world.query("session")[0];
  if (e === undefined) return;
  const level = world.get<ProgressC>(e, "progress")?.level ?? START_LEVEL;
  const classId = world.get<SessionC>(e, "session")?.classId ?? "";
  const current = world.get<SkillsC>(e, "skills");
  const gems = { ...(current?.gems ?? {}) };
  for (const def of SKILLS.values()) {
    if (!isUnlocked(def, level, classId)) continue;
    if (gems[def.id] === undefined) gems[def.id] = { level: 1, xp: 0 };
  }
  world.set<SkillsC>(e, "skills", { gems, bar: current?.bar ?? defaultBar(classId) });
}
```

Add `skills?: SkillsC` to `PersistedState` with the same optional-field comment the neighbours use,
put `skills` into `snapshot()`'s return, and in `restore()`, after the progress line:

```ts
  // Clamp on read: a hand-edited save must not put a gem 20 skill in a level-3
  // character's hand. Then grant, so a save written before gems existed — or one
  // written before the level that opened a skill — comes back complete.
  const cap = maxGemLevel(progress.level);
  const saved = state.skills;
  if (saved) {
    const gems: Record<string, { level: number; xp: number }> = {};
    for (const [id, gem] of Object.entries(saved.gems)) {
      gems[id] = { level: Math.min(gem.level, cap), xp: gem.xp };
    }
    world.set<SkillsC>(e, "skills", { gems, bar: normalizeBar(saved.bar) });
  }
  grantSkills(world);
```

with, beside `defaultBar`:

```ts
/** A saved bar, proven rather than trusted: exactly SKILL_SLOT_COUNT entries,
 *  each a string or null, and no id in two sockets at once. */
function normalizeBar(raw: unknown): (string | null)[] {
  const src = Array.isArray(raw) ? raw : [];
  const out: (string | null)[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < SKILL_SLOT_COUNT; i++) {
    const v = src[i];
    const id = typeof v === "string" && v.length > 0 && !seen.has(v) ? v : null;
    if (id !== null) seen.add(id);
    out.push(id);
  }
  return out;
}
```

Export `normalizeBar` too — Task 6's system needs the same proof for an incoming intent, and two
implementations of "a valid bar" is exactly how the two drift apart.

- [ ] **Step 6: Build it in a fresh world**

In `packages/simulation/src/combat-sim.ts`, after the `ProgressC` line:

```ts
    world.set<SkillsC>(sessionE, "skills", { gems: {}, bar: defaultBar(session.classId ?? "") });
    grantSkills(world);
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run packages/simulation`
Expected: PASS.

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npx vitest run` and `npm run typecheck`
Expected: both green. **The golden replays are the risk here**: `SkillsC` lands on the session
entity, and the goldens run the legacy no-session path, so they should not move. If one does, say so
and do not regenerate it in this task — Task 12 owns any deliberate regeneration.

- [ ] **Step 9: Commit**

```bash
git add packages/protocol/src/index.ts apps/web/src/settings.ts packages/simulation/src/components.ts packages/simulation/src/combat-sim.ts packages/simulation/src/persist.ts packages/simulation/src/persist.test.ts
git commit -m "feat(sim): SkillsC holds the gems and the action bar, granted from the level"
```

---

### Task 6: The `setSkillBar` intent

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/simulation/src/loop.ts` (`Command.bar`)
- Modify: `packages/simulation/src/protocol-bridge.ts` (`intentToCommand`)
- Create: `packages/simulation/src/systems/skills.ts`
- Modify: `packages/simulation/src/combat-sim.ts` (register it)
- Test: `packages/simulation/src/systems/skills.test.ts`, `packages/protocol/src/*.test.ts`

**Interfaces:**
- Consumes: `SkillsC`, `normalizeBar` from Task 5.
- Produces: `{ kind: "setSkillBar"; bar: (string | null)[] }` on `Intent`, `"setSkillBar"` on
  `CommandType`, `Command.bar?: (string | null)[]`, and `registerSkillsSystem(sim)`.

- [ ] **Step 1: Write the failing tests**

In `packages/protocol`, add to the intent-validation test file (find it and follow its shape):

```ts
it("validates setSkillBar and refuses a bar that is not an array of ids", () => {
  expect(validateIntent({ kind: "setSkillBar", bar: ["skill.a.v1", null] }))
    .toEqual({ kind: "setSkillBar", bar: ["skill.a.v1", null] });
  expect(() => validateIntent({ kind: "setSkillBar", bar: "nope" })).toThrow();
  expect(() => validateIntent({ kind: "setSkillBar", bar: [1, 2] })).toThrow();
  expect(() => validateIntent({ kind: "setSkillBar" })).toThrow();
});

it("refuses a bar longer than SKILL_SLOT_COUNT rather than truncating it silently", () => {
  const long = new Array(SKILL_SLOT_COUNT + 1).fill(null);
  expect(() => validateIntent({ kind: "setSkillBar", bar: long })).toThrow();
});
```

Create `packages/simulation/src/systems/skills.test.ts`:

```ts
it("a setSkillBar command replaces the bar and leaves the gems alone", () => {
  // Build a session world, note the gems, issue the command, step one tick.
  // Assert bar changed and gems are the same object contents.
});

it("refuses an id the character has not unlocked, keeping the socket empty", () => {
  // A level-1 character asking for skill.cinder_ground.v1 gets null in that socket.
  // Without this the client could hand itself a locked skill by editing one message.
});

it("keeps MOVE_SOCKET, which is not a skill and never will be", () => {
  // Assert MOVE_SOCKET survives the unlock filter.
});

it("normalizes a short bar up to SKILL_SLOT_COUNT and drops a duplicate id", () => {
  // Assert length is SKILL_SLOT_COUNT and the second copy of an id became null.
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/protocol packages/simulation/src/systems/skills.test.ts`
Expected: FAIL — `setSkillBar` is an unknown kind.

- [ ] **Step 3: Extend the protocol**

Add to the `Intent` union, after `respecPassives`:

```ts
  /**
   * Put the action bar in this order. The bar is sim state now, because gem
   * experience is earned by the slot — so a swap is an intent, not a setting.
   * The sim re-checks every id against what this character has actually
   * unlocked, so a client that offers a locked skill can still only be told no.
   */
  | { kind: "setSkillBar"; bar: (string | null)[] };
```

Add `"setSkillBar"` to `CommandType`. And to `validateIntent`:

```ts
    case "setSkillBar": {
      const bar = obj["bar"];
      if (!Array.isArray(bar) || bar.length > SKILL_SLOT_COUNT)
        throw new Error(`validateIntent setSkillBar: bar must be an array of at most ${SKILL_SLOT_COUNT}`);
      for (const v of bar) {
        if (v !== null && (typeof v !== "string" || v.length === 0))
          throw new Error("validateIntent setSkillBar: each entry must be a non-empty string or null");
      }
      return { kind: "setSkillBar", bar: bar as (string | null)[] };
    }
```

- [ ] **Step 4: Carry it to the sim**

In `packages/simulation/src/loop.ts`, add to `Command`:

```ts
  /** Set when type === "setSkillBar"; kept off `data` since that field is numbers-only. */
  bar?: (string | null)[];
```

In `intentToCommand`:

```ts
    case "setSkillBar":
      return { tick, entity: player, type: "setSkillBar", bar: intent.bar };
```

- [ ] **Step 5: Write the system**

Create `packages/simulation/src/systems/skills.ts`:

```ts
import { isUnlocked } from "@exiled/rules";
import { SKILLS } from "@exiled/content-runtime";
import { MOVE_SOCKET } from "@exiled/protocol";
import { Simulation } from "../loop";
import { normalizeBar } from "../persist";
import type { ProgressC, SessionC, SkillsC } from "../components";

/**
 * The action bar, and nothing else. Kept apart from skillCast because a swap is
 * a durable change to the character and a cast is not, and because the bar is
 * what the experience split reads — putting both in one system would make the
 * order of two unrelated things load-bearing.
 */
export function registerSkillsSystem(sim: Simulation): void {
  sim.register("skills", (world, _tick, commands) => {
    for (const cmd of commands) {
      if (cmd.type !== "setSkillBar" || !cmd.bar) continue;
      const e = world.query("session")[0];
      if (e === undefined) continue;
      const skills = world.get<SkillsC>(e, "skills");
      if (!skills) continue;
      const level = world.get<ProgressC>(e, "progress")?.level ?? 1;
      const classId = world.get<SessionC>(e, "session")?.classId ?? "";
      // The client's list is a request, not a fact: an id this character has not
      // unlocked empties its socket rather than being honoured.
      const bar = normalizeBar(cmd.bar).map((id) => {
        if (id === null || id === MOVE_SOCKET) return id;
        const def = SKILLS.get(id);
        return def && isUnlocked(def, level, classId) ? id : null;
      });
      world.set<SkillsC>(e, "skills", { ...skills, bar });
    }
  });
}
```

Register it in `combat-sim.ts` in the session branch, beside `registerFlaskSystem(sim)`:

```ts
    registerSkillsSystem(sim);
```

Append it after the existing registrations so the canonical ordering of the first twelve systems
(which legacy tests check) is untouched.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run packages/protocol packages/simulation`
Expected: PASS.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npx vitest run` and `npm run typecheck`
Expected: both green.

- [ ] **Step 8: Commit**

```bash
git add packages/protocol/src packages/simulation/src/loop.ts packages/simulation/src/protocol-bridge.ts packages/simulation/src/systems/skills.ts packages/simulation/src/systems/skills.test.ts packages/simulation/src/combat-sim.ts
git commit -m "feat(sim): setSkillBar is an intent, re-checked against what the character unlocked"
```

---

### Task 7: Cast through the fold

**Files:**
- Modify: `packages/simulation/src/systems/skill-cast.ts`
- Test: `packages/simulation/src/systems/skill-cast.test.ts`

**Interfaces:**
- Consumes: `effectiveSkill` (Task 3), `SkillsC` (Task 5).
- Produces: nothing new. This is the point where a gem level becomes damage.

**The one design decision.** `registerSkillCast` is handed the static `SKILLS` map once. Rather than
rebuilding that map, the system looks the caster's gem level up per cast and folds the def there.
The fold is a handful of integer operations over one or two effect nodes; a cast already does far
more work than that, and caching it would need an invalidation rule for every level-up.

- [ ] **Step 1: Write the failing tests**

Add to `packages/simulation/src/systems/skill-cast.test.ts`:

```ts
it("a gem 1 caster spawns exactly the projectile the def describes", () => {
  // Existing behaviour, restated as a pin: without it, a bug in the fold that
  // scales at gem 1 has nothing to fail against.
});

it("a gem 10 caster's bolt hits harder and costs more mana than a gem 1 one", () => {
  // Set the session's SkillsC gem to level 10, cast, read the spawned
  // ProjectileC.damageAmount and the mana actually spent. Assert both rose, and
  // assert damage rose by MORE than mana in ratio.
});

it("a gem 5 caster's bolt pierces, a gem 4 caster's does not", () => {
  // Assert ProjectileC.pierceLeft is 1 at gem 5 and undefined at gem 4. This is
  // the breakpoint reaching the sim, which no rules-level test can prove.
});

it("a caster with no SkillsC casts at gem 1 rather than throwing", () => {
  // Every legacy test world has no session and therefore no SkillsC.
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/simulation/src/systems/skill-cast.test.ts`
Expected: FAIL on the gem 10 and gem 5 tests.

- [ ] **Step 3: Fold in the cast**

At the top of `registerSkillCast`, add:

```ts
  /**
   * The gem level this caster has in this skill, or 1. One lookup per cast: the
   * fold is a handful of integer ops, and caching it would need an invalidation
   * rule for every character level, every load and every respec.
   */
  const gemLevelFor = (world: World, skillId: string): number => {
    const e = world.query("session")[0];
    if (e === undefined) return 1;
    return world.get<SkillsC>(e, "skills")?.gems[skillId]?.level ?? 1;
  };
```

In the command loop, immediately after `const skill = skills.get(cmd.skillId); if (!skill) continue;`
replace `skill` with the folded def for everything downstream:

```ts
      const base = skills.get(cmd.skillId);
      if (!base) continue;
      const skill = effectiveSkill(base, gemLevelFor(world, cmd.skillId));
```

Do the same in the wind-up resolution path at the top of the system, where a completed `CastingC` is
resolved: fold there too, so a cast that started at gem 4 and completed after a level-up still
resolves at the level it was PAID for.

```ts
        const base = skills.get(casting.skillId);
        const skill = base ? effectiveSkill(base, casting.gemLevel ?? 1) : undefined;
```

which needs `gemLevel` recorded on `CastingC` when the wind-up starts:

```ts
  // The level the cast was PAID at. Recorded rather than re-read on resolution:
  // a level-up landing inside a two-second Portal wind-up must not retroactively
  // change what that cast does, and must not change it back either.
  gemLevel?: number;
```

Add that field to `CastingC` in `components.ts` and set it in the `world.set<CastingC>` call.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/simulation`
Expected: PASS.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run` and `npm run typecheck`
Expected: both green. `CastingC.gemLevel` is optional and unset on the legacy path, so it hashes as
absent and the goldens must not move. If one does, report it rather than regenerating.

- [ ] **Step 6: Commit**

```bash
git add packages/simulation/src/systems/skill-cast.ts packages/simulation/src/components.ts packages/simulation/src/systems/skill-cast.test.ts
git commit -m "feat(sim): a cast resolves at the gem level it was paid at"
```

---

### Task 8: Award gem experience on a kill

**Files:**
- Modify: `packages/simulation/src/systems/death.ts`
- Test: `packages/simulation/src/systems/death.test.ts`

**Interfaces:**
- Consumes: `splitGemXp`, `gainGemXp`, `maxGemLevel` (Task 3), `SkillsC` (Task 5), `grantSkills`
  (Task 5).
- Produces: nothing new.

**Where it goes.** Immediately after the character's own experience, inside the same
`s.area === "map"` guard, because a gem is paid on exactly the terms the character is: only in a
map, only where an area level exists to price the kill, and off the same post-waystone `gain`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/simulation/src/systems/death.test.ts`:

```ts
it("splits one kill's experience across every occupied bar slot", () => {
  // A bar with two skills and one MOVE_SOCKET. Kill one monster in a map.
  // Assert both gems gained exactly splitGemXp(gain, 2) and that the move
  // sentinel neither gained nor created a gem.
});

it("pays a skill that is on the bar and never cast", () => {
  // The whole point of the design: assert the uncast skill's xp rose.
});

it("pays nothing to a skill the character owns but has not slotted", () => {
  // Assert an unslotted gem's xp is unchanged.
});

it("a gem levels on a big enough kill, and a boss can carry it past two thresholds", () => {
  // Use a boss and a high area tier so the award is large. Assert level rose by 2.
});

it("a character level grants the skills it opened and pops the gems that were capped", () => {
  // A level-4 character one kill from level 5, with a gem parked at the cap.
  // Assert after the kill: blink exists as a gem, and the parked gem levelled.
  // This is the "a level-up can pay twice" rule; without grantSkills on the
  // level-up path a newly unlocked skill would not appear until the next load.
});

it("pays no gem experience in the hideout, exactly as it pays no character experience", () => {
});
```

The fourth and fifth are the ones with teeth: set the levels and the tier explicitly, because a
level-1 character in a tier-1 map earns single-digit awards and every assertion about levelling
would silently pass on zero.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/simulation/src/systems/death.test.ts`
Expected: FAIL — no gem experience is awarded.

- [ ] **Step 3: Award it**

In `death.ts`, inside the existing `if (s && s.area === "map" && sessionE !== undefined)` block,
after the `world.set<ProgressC>` line and BEFORE the level-up branch:

```ts
          // The gem's share of the same kill. Every occupied slot is paid whether
          // it was cast or not (spec §1): swapping a skill in costs a slot and
          // nothing else, so experimenting stays free.
          const skills = world.get<SkillsC>(sessionE, "skills");
          if (skills) {
            const occupied = skills.bar.filter((id) => id !== null && skills.gems[id] !== undefined);
            const share = splitGemXp(gain, occupied.length);
            if (share > 0) {
              const cap = maxGemLevel(next.level);
              const gems = { ...skills.gems };
              for (const id of occupied) {
                gems[id!] = gainGemXp(gems[id!]!, share, cap);
              }
              world.set<SkillsC>(sessionE, "skills", { ...skills, gems });
            }
          }
```

Note `cap` uses `next.level`, the level AFTER this kill: that is what makes a level-up pay twice.

Then inside the existing `if (next.level !== prog.level)` branch, after `recomputePlayerStats`:

```ts
            // The level may have opened a skill. Granting here rather than only on
            // load is what puts the new icon on the bar in the moment it is earned,
            // which is the whole of docs/09 rule 1 for this track.
            grantSkills(world);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/simulation`
Expected: PASS.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run` and `npm run typecheck`
Expected: both green.

- [ ] **Step 6: Commit**

```bash
git add packages/simulation/src/systems/death.ts packages/simulation/src/systems/death.test.ts
git commit -m "feat(sim): a kill pays every occupied bar slot, cast or not"
```

---

### Task 9: The snapshot tells the truth about a gem

**Files:**
- Modify: `packages/protocol/src/index.ts` (`DisplaySkill`, `Snapshot`)
- Modify: `packages/simulation/src/protocol-bridge.ts`
- Test: `packages/simulation/src/protocol-bridge.test.ts`

**Interfaces:**
- Consumes: `effectiveSkill`, `reachedBreakpoints`, `nextBreakpoint`, `gemXpToNext`, `maxGemLevel`
  (Task 3), `SkillsC` (Task 5).
- Produces, on `DisplaySkill`:

```ts
  /** The gem's level, 1..20. */
  gemLevel: number;
  /** Experience banked toward the next gem level, and what it costs. 0 at the cap. */
  gemXp: number;
  gemXpToNext: number;
  /** Lines for breakpoints already reached, in order. */
  breakpoints: string[];
  /** The one greyed out in the tooltip, absent once there are none left. */
  nextBreakpoint?: { atLevel: number; text: string };
```

and on `Snapshot`:

```ts
  /** The action bar, as the sim holds it. The client renders THIS, never its own copy. */
  skillBar?: (string | null)[];
```

`describeSkills` must now walk `SkillsC.gems` rather than all of `SKILLS`, so a locked skill never
reaches the client at all.

- [ ] **Step 1: Write the failing tests**

Add to `packages/simulation/src/protocol-bridge.test.ts`:

```ts
it("emits only the skills this character has unlocked", () => {
  // A level-1 character: assert cinder_ground and town_portal are absent and
  // ember_bolt is present.
});

it("emits every skill once the level has opened them all", () => {
  // A level-100 character: assert all seven ids appear.
});

it("quotes the gem's numbers, not the def's", () => {
  // Gem 10 ember_bolt: assert manaCost and dps both exceed the gem 1 values, and
  // that manaCost equals toNumber(effectiveSkill(def, 10).manaCostFixed).
});

it("lists the breakpoints reached and greys the next one", () => {
  // Gem 5 ember_bolt: breakpoints is ["Pierces one enemy"], nextBreakpoint is
  // { atLevel: 15, text: "Pierces three enemies" }.
});

it("drops nextBreakpoint once the last one is reached", () => {
  // Gem 15: assert nextBreakpoint is undefined and breakpoints has two entries.
});

it("carries the bar the sim holds", () => {
  // Assert snapshot.skillBar deep-equals the SkillsC bar.
});

it("gemXpToNext is 0 at the gem cap, so the client draws no rail", () => {
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/simulation/src/protocol-bridge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend the protocol types**

Add the fields listed above to `DisplaySkill` and `Snapshot`, each with the comment given.

- [ ] **Step 4: Rewrite `describeSkills`**

Change its signature to take the gems, and drive the loop off them:

```ts
function describeSkills(
  offense: OffenseC | undefined,
  skills: SkillsC | undefined,
): DisplaySkill[] {
  const castSpeedPct = offense?.castSpeedPct ?? 0;
  const timingScale = 100 + castSpeedPct;
  const spellDamagePct = offense?.spellDamagePct ?? 0;
  const out: DisplaySkill[] = [];
  // Driven off the GEMS, not off SKILLS: a locked skill must not reach the client
  // at all, or the bar offers a socket the sim will refuse.
  for (const [id, gem] of Object.entries(skills?.gems ?? {})) {
    const authored = SKILLS.get(id);
    if (!authored) continue;
    const def = effectiveSkill(authored, gem.level);
    // ... the existing body, unchanged, reading `def` ...
    const skill: DisplaySkill = {
      id: def.id,
      name: def.name,
      description: def.description ?? "",
      manaCost: toNumber(def.manaCostFixed),
      castTimeSec,
      cooldownSec: def.cooldownTicks / 30,
      lines,
      gemLevel: gem.level,
      gemXp: gem.xp,
      gemXpToNext: gemXpToNext(gem.level),
      breakpoints: reachedBreakpoints(authored, gem.level).map((b) => b.text),
      ...(nextBreakpoint(authored, gem.level)
        ? { nextBreakpoint: { atLevel: nextBreakpoint(authored, gem.level)!.atLevel,
                              text: nextBreakpoint(authored, gem.level)!.text } }
        : {}),
    };
    // ... the existing dps block, unchanged ...
  }
  // Authored order, not insertion order: a gem granted later must not jump the
  // list and move an icon out from under the cursor.
  const order = [...SKILLS.keys()];
  out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return out;
}
```

Update the call site (`protocol-bridge.ts:445`) to pass `world.get<SkillsC>(sessionE, "skills")`,
and add `skillBar` to the snapshot beside it.

The ordering sort is not decoration: `Object.entries` follows insertion order, so without it a skill
granted at level 8 would appear after one granted at 10 depending on load history, and the HUD's
assign menu would reshuffle between sessions.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/simulation`
Expected: PASS.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run` and `npm run typecheck`
Expected: `apps/web` tests that build a `DisplaySkill` fixture will fail to typecheck on the new
required fields. Fix each fixture with `gemLevel: 1, gemXp: 0, gemXpToNext: 60, breakpoints: []`
and list every file you touched.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/index.ts packages/simulation/src/protocol-bridge.ts packages/simulation/src/protocol-bridge.test.ts apps/web/src
git commit -m "feat(protocol): the snapshot carries the gem, the bar and the next breakpoint"
```

---

### Task 10: The client reads the bar from the sim

**Files:**
- Modify: `apps/web/src/settings.ts`
- Modify: `apps/web/src/GameView.tsx`
- Modify: `apps/web/src/hud/Hud.tsx`
- Test: `apps/web/src/hud/Hud.test.tsx`, and the settings test file

**Interfaces:**
- Consumes: `Snapshot.skillBar` and the `setSkillBar` intent.
- Produces: nothing new.

**What has to go.** `UiSettings.skillBar` and its `skillBar()` sanitizer are deleted. A bar in the
settings blob is a bar shared by every character, which is the exact thing gem experience cannot
survive. Settings written before this change carry a stale `skillBar` key; it is simply ignored,
which needs no migration because settings are a preference blob rather than durable state.

- [ ] **Step 1: Write the failing tests**

In the settings test file:

```ts
it("no longer carries a skill bar, because the bar is the character's", () => {
  expect("skillBar" in DEFAULT_SETTINGS.ui).toBe(false);
});

it("ignores a stale skillBar key in a saved settings blob without throwing", () => {
  const parsed = parseSettings({ ui: { skillBar: ["skill.a.v1"] } });
  expect(parsed.ui).not.toHaveProperty("skillBar");
});
```

(Use the actual parser name from that file.)

In `apps/web/src/hud/Hud.test.tsx`:

```ts
it("draws the bar the snapshot carries, not a prop default", () => {
  // Render with a snapshot whose skillBar puts a skill in socket 3; assert the
  // tile in socket 3 shows it.
});

it("dispatches setSkillBar when two sockets are swapped", () => {
  // Assert the callback fired with the swapped array, not with a settings object.
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/web`
Expected: FAIL.

- [ ] **Step 3: Delete the setting**

In `apps/web/src/settings.ts`: remove `skillBar` from `UiSettings`, from `DEFAULT_SETTINGS.ui`, from
the parser, and delete the `skillBar()` sanitizer function. Keep the three re-exports Task 5 added.

- [ ] **Step 4: Rewire `Hud`**

`HudProps.skillBar` keeps its name but its default becomes an empty array, and its source becomes
`snapshot.skillBar`. `onSkillBarChange` keeps its `(bar: (string | null)[]) => void` signature.
Inside `Hud`, replace `skillBar = DEFAULT_SETTINGS.ui.skillBar` with `skillBar = []` and leave the
length-normalising `useMemo` exactly as it is — it already handles a short array, which is now the
first-frame case before the snapshot arrives.

- [ ] **Step 5: Rewire `GameView`**

Replace `skillBarRef.current = settings.ui.skillBar` with a ref fed from the latest snapshot:

```ts
  const skillBarRef = useRef<(string | null)[]>([]);
  skillBarRef.current = snapshot?.skillBar ?? [];
```

(Use whatever the component's existing snapshot state variable is called.)

Replace the `onSkillBarChange` handler with an intent dispatch, using the same path every other
intent in this file takes:

```ts
        onSkillBarChange={(bar) => sendIntent({ kind: "setSkillBar", bar })}
```

and pass `skillBar={snapshot?.skillBar ?? []}`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run apps/web`
Expected: PASS.

- [ ] **Step 7: Run the full suite, typecheck and build**

Run: `npx vitest run`, `npm run typecheck`, `npm run build -w apps/web`
Expected: all three green. The build matters here specifically: the menu bundle must not have
grown a simulation import.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): the action bar comes from the sim, not from global settings"
```

---

### Task 11: The player can see and hear a gem level

**Files:**
- Modify: `apps/web/src/hud/SkillTooltip.tsx`
- Modify: `apps/web/src/hud/Hud.tsx`
- Test: `apps/web/src/hud/Hud.test.tsx`, and a new `apps/web/src/hud/SkillTooltip.test.tsx`

**Interfaces:**
- Consumes: the `DisplaySkill` gem fields from Task 9.
- Produces: nothing new.

**Read `docs/09-reward-psychology.md` before starting.** Rule 1: a reward the player cannot hear and
see did not happen. Rule 3: concentrate rather than spread.

**Reuse, do not build.** `Hud.tsx` already has exactly the machine this needs: a snapshot-diff
effect keyed on `level` and `stones` that raises a `reward-banner` and calls `playDropSound`. Gem
levels and breakpoints join that same effect and that same banner. Do not add a second toast system,
a second timer, or a second sound path.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/hud/SkillTooltip.test.tsx`:

```ts
it("shows the gem level in the header", () => {
  // Render with gemLevel 7; assert "Level 7" is on screen.
});

it("draws an experience rail whose width is gemXp over gemXpToNext", () => {
  // gemXp 30, gemXpToNext 60 -> the fill element's width style is "50%".
});

it("draws no rail at the gem cap, where gemXpToNext is 0", () => {
  // A zero denominator must not render NaN%.
});

it("lists reached breakpoints in the modifier colour and the next one greyed", () => {
  // Assert the next-breakpoint element exists, names its level, and carries a
  // different colour from the reached ones. That grey line is the anticipation
  // device; a test that only checks the text would pass on a line rendered
  // identically to a reached one.
});

it("shows nothing about breakpoints for a skill that has none", () => {
});
```

In `apps/web/src/hud/Hud.test.tsx`:

```ts
it("raises the banner when a gem levels", () => {
  // Two snapshots, the second with gemLevel 2 on one skill. Assert the banner
  // names the skill and the new level.
});

it("raises the banner naming what changed when a breakpoint is crossed", () => {
  // Second snapshot adds a breakpoint line. Assert the banner carries that TEXT,
  // not just the level, because the text is the only thing that says what changed.
});

it("does not congratulate on the first snapshot", () => {
  // A reload must not celebrate the gem level the character already had.
});

it("shares one banner when a character level and a gem level land on the same kill", () => {
  // docs/09 rule 3: concentrate. Assert exactly one banner element.
});

it("flashes the bar slot the gem that levelled sits in, and only that one", () => {
  // Two snapshots, the second with gemLevel 2 on the skill in socket 2.
  // Assert the socket-2 tile carries the flash marker and socket 0 does not.
  // A banner alone says WHAT levelled; the flash says WHERE, which is the half
  // that puts the player's eye on the icon he is about to press (docs/09 rule 1).
});

it("stops flashing after the flash duration", () => {
  // Advance fake timers past it; assert the marker is gone. A flash that never
  // clears is a permanently lit bar, which reads as a bug rather than a reward.
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/web/src/hud`
Expected: FAIL.

- [ ] **Step 3: Extend the tooltip**

In `SkillTooltip.tsx`, add a `Stat` for the level, an experience rail under the header, and a
breakpoint block under the modifier lines:

```tsx
        <Stat label="Gem" value={`Level ${skill.gemLevel}`} />
```

```tsx
      {skill.gemXpToNext > 0 && (
        <div data-testid="gem-xp-rail" style={{ height: 3, background: "#1a1a1a" }}>
          <div
            data-testid="gem-xp-fill"
            style={{
              height: "100%",
              width: `${Math.min(100, Math.round((skill.gemXp * 100) / skill.gemXpToNext))}%`,
              background: GOLD_DIM,
            }}
          />
        </div>
      )}
```

```tsx
      {(skill.breakpoints.length > 0 || skill.nextBreakpoint) && (
        <>
          <div style={{ height: 1, background: GOLD_DIM, opacity: 0.6 }} />
          <div style={{ padding: "8px 12px", fontSize: 13, lineHeight: 1.4 }}>
            {skill.breakpoints.map((text) => (
              <div key={text} style={{ color: MODIFIER }}>{text}</div>
            ))}
            {/* The grey line is where the anticipation lives (docs/09 rule 1):
                it is the cheapest device in the whole design, so it is shown
                even before the first breakpoint is reached. */}
            {skill.nextBreakpoint && (
              <div data-testid="next-breakpoint" style={{ color: "#5a5a5a" }}>
                {`Level ${skill.nextBreakpoint.atLevel}: ${skill.nextBreakpoint.text}`}
              </div>
            )}
          </div>
        </>
      )}
```

- [ ] **Step 4: Extend the banner effect**

In `Hud.tsx`, widen the existing `last` ref and its effect. Keep it ONE effect and ONE banner:

```ts
  const gems = React.useMemo(() => {
    const m: Record<string, { level: number; breakpoints: number }> = {};
    for (const s of snapshot?.skills ?? []) m[s.id] = { level: s.gemLevel, breakpoints: s.breakpoints.length };
    return m;
  }, [snapshot?.skills]);
  const skillNameById = skillNames; // already built above
  const last = React.useRef<{ level: number; stones: number; gems: typeof gems } | null>(null);
```

and inside the effect, after the existing `won` lines:

```ts
    // A breakpoint outranks the level it arrived with: the level is a number and
    // the breakpoint is the thing that says what changed (docs/09 rule 1). Both
    // ride the one banner rather than queueing two.
    for (const [id, now] of Object.entries(gems)) {
      const before = was.gems[id];
      if (!before) continue; // newly unlocked: the level-up line already covers it
      if (now.breakpoints > before.breakpoints) {
        const text = snapshot?.skills?.find((s) => s.id === id)?.breakpoints.at(-1);
        if (text) lines.push(`${skillNameById.get(id) ?? id}: ${text}`);
      } else if (now.level > before.level) {
        lines.push(`${skillNameById.get(id) ?? id} Level ${now.level}`);
      }
    }
```

and make the sound choice reflect the loudest thing that happened:

```ts
    // A breakpoint is the loudest of the three, then a character level, then a gem.
    const crossed = Object.entries(gems).some(([id, now]) => (was.gems[id]?.breakpoints ?? now.breakpoints) < now.breakpoints);
    playDropSound(crossed || level > was.level ? "unique" : "rare");
```

Add `gems` to the effect's dependency array and to the `last.current` write.

- [ ] **Step 5: Flash the slot**

The banner says what levelled; the flash says where. In the same effect, record which skill ids
levelled, and clear them on the same 2400ms the banner already uses so there is one timer rather
than two:

```ts
  const [flashing, setFlashing] = React.useState<ReadonlySet<string>>(new Set());
```

Set it from the effect (`setFlashing(new Set(levelledIds))`, empty when nothing levelled), clear it
in the existing banner-dismissal effect alongside `setBanner(null)`, and pass it down to the tile:

```tsx
              <SkillTile
                slot={socketFor(bar, i, skillNames)}
                flash={bar[i] !== null && flashing.has(bar[i]!)}
                ...
```

In `SkillTile`, take `flash?: boolean` and add it to the existing `boxShadow` expression as an extra
term rather than a new element — the tile already computes a glow from `slot.glow`, and a second
absolutely-positioned overlay would sit over the cooldown sweep:

```tsx
        boxShadow: flash
          ? `0 0 14px 3px #d9b04a, inset 0 0 10px rgba(0,0,0,0.75)`
          : over ? ... /* the existing expression, unchanged */,
```

Give the tile `data-flash={flash ? "1" : undefined}` so the tests above have something to assert on
that is not a colour string.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run apps/web/src/hud`
Expected: PASS.

- [ ] **Step 7: Run the full suite, typecheck and build**

Run: `npx vitest run`, `npm run typecheck`, `npm run build -w apps/web`
Expected: all three green.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/hud
git commit -m "feat(web): gem level, its rail, the greyed next breakpoint and the slot flash"
```

---

### Task 12: Re-measure balance and settle the goldens

**Files:**
- Modify: `packages/simulation/src/balance.test.ts`
- Modify: `packages/replay/src/scenarios/*` (only if a golden genuinely moved)
- Modify: `CHANGELOG.md`
- Modify: `docs/specs/2026-08-05-current-implementation-contract.md`

**Interfaces:** none. This task closes the spec's §7 verification list.

**The rule for the bands.** `balance.test.ts` measures kill and death times against bands. Gem levels
change what a character kills with, so the bands are **re-measured against the same rig**, never
re-argued. Run the rig, read the numbers, write them down. If a measured number lands outside a band
you cannot justify from the design (damage rising 6% per level compounding, mana 4%), that is a bug
in the implementation, not a band to widen — say so and stop.

- [ ] **Step 1: Add the two gem measurements the spec asks for**

The spec (§7) requires gem 1 and gem 20 both inside their bands. Read `balance.test.ts` first: it
runs `createCombatSim(7, { monsters: false })` at a fixed 1000/1000, so it does not currently vary
the gem level at all. Add a parameter for the gem level to whatever helper builds its rig, and two
cases: the same fight at gem 1 and at gem 20.

```ts
it("a gem 1 character kills the reference pack inside the band", () => {
  // The existing band, restated for gem 1 explicitly.
});

it("a gem 20 character kills it about three times faster, and still spends mana", () => {
  // Assert time-to-kill fell by a factor between 2.5 and 3.5 (1.06^19 is 3.03),
  // and that mana is still the cap on sustained damage: assert the character
  // runs dry at gem 20 sooner in CASTS than at gem 1, because cost rose too.
});
```

The mana assertion is the load-bearing one: it is what keeps the design's claim that mana rises with
damage from being decorative.

- [ ] **Step 2: Run it and read the numbers**

Run: `npx vitest run packages/simulation/src/balance.test.ts`
Write the measured numbers into the bands. Record what you measured in the commit message.

- [ ] **Step 3: Check the goldens**

Run: `npx vitest run packages/replay`
Expected: **green with no regeneration.** Every change in this plan is either optional-and-absent on
the legacy path or lives on the session entity, which the goldens do not build. If a golden did
move, find out which task moved it before you regenerate anything, and put the reason in the commit
message. A checksum regenerated without a stated reason is a divergence nobody will ever find again.

- [ ] **Step 4: Update the docs**

In `docs/specs/2026-08-05-current-implementation-contract.md`, update the status date and add gem
levels to the progression section: unlock by character level, gem cap `min(20, charLevel)`, the
shared bar-wide split, +6%/+4% per level, breakpoints at 5 and 15.

Add a `CHANGELOG.md` entry.

- [ ] **Step 5: Run the full suite, typecheck and build**

Run: `npx vitest run`, `npm run typecheck`, `npm run build -w apps/web`
Expected: all three green.

- [ ] **Step 6: Commit**

```bash
git add packages/simulation/src/balance.test.ts CHANGELOG.md docs/specs/2026-08-05-current-implementation-contract.md
git commit -m "test(balance): re-measure kill and death bands at gem 1 and gem 20"
```

---

## What this plan does not do

Named here so a reviewer does not have to work out whether they were forgotten.

- **Support gems, gem quality, a swap cost, and the class skill kits.** Spec §8 puts all four in the
  second spec, written against a system that already runs.
- **Class restriction is authored and enforced but unused.** Every skill today is classless (spec
  §5). `isUnlocked`'s class path is tested with a fixture, not with shipped content.
- **Cinder Ground's two breakpoints are radius, not behaviour.** Every other skill's are real
  (Strike's arc reaches 360, three projectiles gain pierce), and Blink and Portal have none. A ground
  patch that changes behaviour rather than size needs a mechanism that does not exist yet — an area
  that spreads, or one that leaves something behind — and inventing one inside this plan would be a
  content design nobody approved. **Ruled by the owner on 2026-08-10: ship as radius.** Behaviour
  breakpoints wait for a ground mechanism to exist.
- **The gem cues reuse `playDropSound`, not new audio masters.** Masters are curated from Sonniss
  (`SOURCES` in `tools/import_sfx.py`), so a genuinely distinct gem-level cue needs a file chosen by
  hand. Until then a gem level rides the existing "rare" drop sound and a breakpoint the "unique"
  one, which is a real difference in loudness rather than silence, and the upgrade is one `VOICES`
  entry away.
- **`monsterTierScale`'s steepened slopes are still unmeasured above tier 0** (carried over from the
  level-1-100 rescale). Task 12 measures the gem's effect against the same fixed 1000/1000 rig the
  balance lab already uses, which does not touch that question either. Still awaiting the owner's
  ruling.
