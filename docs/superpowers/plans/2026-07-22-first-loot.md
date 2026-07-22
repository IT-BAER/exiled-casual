# First Loot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The map boss and rare monsters drop an item on death; the player picks it up into a 12×5 grid inventory whose tooltips read from the rolls the sim committed at drop time, with item level and rarity odds scaling by area tier.

**Architecture:** Item generation is a pure deterministic function in the `@pact/rules` leaf (`rollItem`), fed hand-authored base/affix pools from `@pact/content-runtime`, with shared types in `@pact/content-schema`. The sim drops a ground-item entity on qualifying deaths, and a new pickup system validates range + first-fit grid placement authoritatively. The client renders ground markers, an inventory panel, and a keypress pickup, all from a display-ready snapshot projection so `@pact/protocol` stays free of item internals.

**Tech Stack:** TypeScript, npm workspaces, Vitest, React + Babylon (apps/web), fixed-point deterministic ECS sim.

## Global Constraints

- Sim math is deterministic; item fields are plain integers/strings/booleans only (no floats) so `checksum.ts` `stableValue` accepts them and replay checksums stay stable.
- `@pact/rules` is a pure leaf: **no imports from other `@pact` packages** except **type-only** imports from `@pact/content-schema` (matches `rare.ts`). Inline its own PRNG (mulberry32) like `atlas.ts` does.
- Rarity this slice is **`"normal" | "magic"`** only. Magic has 1–2 affixes. No Rare/Unique.
- Inventory is a **12×5** grid (60 cells), auto **first-fit** placement, no drag/reorder.
- `ilvl = 64 + areaTier` (reuse `@pact/rules` `areaLevel`). Rarity odds rise with `ilvl` + `monsterRarity`; centralize in one place with a `ponytail:` calibration comment.
- Items drop **identified** (no unidentified state this slice).
- Inventory is in-memory on the session singleton; not saved across reload.
- Test: `rtk proxy npx vitest run <scope>` from repo root (plain vitest under RTK flakes). Typecheck: `npm run typecheck` (mandatory — vitest strips types). Web build: `npm run build -w apps/web`.
- Commit direct-to-main, one commit per task. **No attribution trailers, no emdashes** in messages.
- **Verification runs against `packages/replay` (or the full suite), not just the touched package** (the waystones slice masked a checksum break by scoping too narrowly).

---

### Task 1: Item domain types (content-schema)

**Files:**
- Modify: `packages/content-schema/src/index.ts`
- Test: `packages/content-schema/src/items.test.ts` (create)

**Interfaces:**
- Consumes: existing `ValidationResult` (`{ ok: true } | { ok: false; errors: string[] }`), existing `validateMonsterDef` pattern.
- Produces:
  - `type Rarity = "normal" | "magic"`
  - `interface ItemBase { id: string; name: string; itemClass: string; w: number; h: number }`
  - `interface Affix { id: string; stat: string; label: string; minItemLevel: number; min: number; max: number }`
  - `interface ItemAffix { affixId: string; value: number }`
  - `interface Item { baseId: string; rarity: Rarity; itemLevel: number; affixes: ItemAffix[] }`
  - `interface ItemPools { bases: ItemBase[]; affixes: Affix[] }`
  - `function validateItemBase(v: unknown): ValidationResult`
  - `function validateAffix(v: unknown): ValidationResult`

- [ ] **Step 1: Write the failing test**

Create `packages/content-schema/src/items.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateItemBase, validateAffix } from "./index.js";

describe("validateItemBase", () => {
  it("accepts a well-formed base", () => {
    const r = validateItemBase({ id: "base.wand", name: "Wand", itemClass: "wand", w: 1, h: 3 });
    expect(r.ok).toBe(true);
  });
  it("rejects non-positive dimensions", () => {
    const r = validateItemBase({ id: "base.wand", name: "Wand", itemClass: "wand", w: 0, h: 3 });
    expect(r.ok).toBe(false);
  });
  it("rejects a missing id", () => {
    const r = validateItemBase({ name: "Wand", itemClass: "wand", w: 1, h: 3 });
    expect(r.ok).toBe(false);
  });
});

describe("validateAffix", () => {
  it("accepts a well-formed affix", () => {
    const r = validateAffix({ id: "affix.life", stat: "maxLife", label: "to maximum Life", minItemLevel: 1, min: 5, max: 20 });
    expect(r.ok).toBe(true);
  });
  it("rejects min greater than max", () => {
    const r = validateAffix({ id: "affix.life", stat: "maxLife", label: "to maximum Life", minItemLevel: 1, min: 30, max: 20 });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run packages/content-schema/src/items.test.ts`
Expected: FAIL (`validateItemBase`/`validateAffix` are not exported).

- [ ] **Step 3: Write minimal implementation**

Append to `packages/content-schema/src/index.ts` (the `ValidationResult` type already exists near the top; reuse it):

```ts
// ── Items (First Loot slice) ────────────────────────────────────────────────
export type Rarity = "normal" | "magic";

export interface ItemBase { id: string; name: string; itemClass: string; w: number; h: number }
export interface Affix { id: string; stat: string; label: string; minItemLevel: number; min: number; max: number }
export interface ItemAffix { affixId: string; value: number }
export interface Item { baseId: string; rarity: Rarity; itemLevel: number; affixes: ItemAffix[] }
export interface ItemPools { bases: ItemBase[]; affixes: Affix[] }

export function validateItemBase(v: unknown): ValidationResult {
  const errors: string[] = [];
  const o = v as Record<string, unknown>;
  if (typeof o?.["id"] !== "string" || (o["id"] as string).length === 0) errors.push("id must be a non-empty string");
  if (typeof o?.["name"] !== "string" || (o["name"] as string).length === 0) errors.push("name must be a non-empty string");
  if (typeof o?.["itemClass"] !== "string" || (o["itemClass"] as string).length === 0) errors.push("itemClass must be a non-empty string");
  if (!Number.isInteger(o?.["w"]) || (o["w"] as number) < 1) errors.push("w must be a positive integer");
  if (!Number.isInteger(o?.["h"]) || (o["h"] as number) < 1) errors.push("h must be a positive integer");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

export function validateAffix(v: unknown): ValidationResult {
  const errors: string[] = [];
  const o = v as Record<string, unknown>;
  if (typeof o?.["id"] !== "string" || (o["id"] as string).length === 0) errors.push("id must be a non-empty string");
  if (typeof o?.["stat"] !== "string" || (o["stat"] as string).length === 0) errors.push("stat must be a non-empty string");
  if (typeof o?.["label"] !== "string" || (o["label"] as string).length === 0) errors.push("label must be a non-empty string");
  if (!Number.isInteger(o?.["minItemLevel"]) || (o["minItemLevel"] as number) < 1) errors.push("minItemLevel must be a positive integer");
  if (!Number.isInteger(o?.["min"])) errors.push("min must be an integer");
  if (!Number.isInteger(o?.["max"])) errors.push("max must be an integer");
  if (Number.isInteger(o?.["min"]) && Number.isInteger(o?.["max"]) && (o["min"] as number) > (o["max"] as number))
    errors.push("min must be <= max");
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
```

If `ValidationResult` is not already exported/shaped as `{ ok: true } | { ok: false; errors: string[] }`, match its actual shape (see `validateMonsterDef` in the same file) rather than introducing a new one.

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk proxy npx vitest run packages/content-schema/src/items.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck
git add packages/content-schema/src/index.ts packages/content-schema/src/items.test.ts
git commit -m "feat(content-schema): item domain types + validators (First Loot)"
```

---

### Task 2: Item pools + display (content-runtime)

**Files:**
- Create: `packages/content-runtime/src/items.ts`
- Modify: `packages/content-runtime/src/index.ts` (re-export)
- Test: `packages/content-runtime/src/items.test.ts` (create)

**Interfaces:**
- Consumes: `ItemBase`, `Affix`, `Item`, `ItemPools`, `Rarity`, `validateItemBase`, `validateAffix` from `@pact/content-schema` (Task 1).
- Produces:
  - `const ITEM_POOLS: ItemPools`
  - `function baseOf(baseId: string): ItemBase` (throws if unknown)
  - `function describeItem(item: Item): { name: string; rarity: Rarity; lines: string[] }`

- [ ] **Step 1: Write the failing test**

Create `packages/content-runtime/src/items.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ITEM_POOLS, baseOf, describeItem } from "./items.js";

describe("ITEM_POOLS", () => {
  it("has bases and affixes with positive base dimensions", () => {
    expect(ITEM_POOLS.bases.length).toBeGreaterThan(0);
    expect(ITEM_POOLS.affixes.length).toBeGreaterThan(0);
    for (const b of ITEM_POOLS.bases) {
      expect(b.w).toBeGreaterThan(0);
      expect(b.h).toBeGreaterThan(0);
    }
  });
});

describe("describeItem", () => {
  it("names a normal item by its base and lists no affix lines", () => {
    const base = ITEM_POOLS.bases[0]!;
    const d = describeItem({ baseId: base.id, rarity: "normal", itemLevel: 65, affixes: [] });
    expect(d.name).toBe(base.name);
    expect(d.rarity).toBe("normal");
    expect(d.lines).toEqual([]);
  });
  it("formats magic affix lines as value + label", () => {
    const base = ITEM_POOLS.bases[0]!;
    const affix = ITEM_POOLS.affixes[0]!;
    const d = describeItem({ baseId: base.id, rarity: "magic", itemLevel: 65, affixes: [{ affixId: affix.id, value: 12 }] });
    expect(d.lines).toEqual([`+12 ${affix.label}`]);
  });
});

describe("baseOf", () => {
  it("throws on an unknown base id", () => {
    expect(() => baseOf("base.nope")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run packages/content-runtime/src/items.test.ts`
Expected: FAIL (`./items.js` has no such exports).

- [ ] **Step 3: Write minimal implementation**

Create `packages/content-runtime/src/items.ts`:

```ts
import { validateItemBase, validateAffix, type ItemBase, type Affix, type Item, type ItemPools, type Rarity } from "@pact/content-schema";

// Tiny hand-authored pool for the First Loot slice. Grid dims (w×h) follow the
// 12×5 inventory. Real 45-base / 120-affix content is Phase 4 proper.
const ITEM_BASES: ItemBase[] = [
  { id: "base.emberwand", name: "Ember Wand", itemClass: "wand", w: 1, h: 2 },
  { id: "base.ashen_focus", name: "Ashen Focus", itemClass: "focus", w: 2, h: 2 },
  { id: "base.cinder_cap", name: "Cinder Cap", itemClass: "helmet", w: 2, h: 2 },
  { id: "base.emberweave_robe", name: "Emberweave Robe", itemClass: "body", w: 2, h: 3 },
];

const AFFIXES: Affix[] = [
  { id: "affix.life", stat: "maxLife", label: "to maximum Life", minItemLevel: 1, min: 5, max: 40 },
  { id: "affix.mana", stat: "maxMana", label: "to maximum Mana", minItemLevel: 1, min: 4, max: 30 },
  { id: "affix.fire_dmg", stat: "fireDamage", label: "to Fire Damage", minItemLevel: 1, min: 2, max: 18 },
  { id: "affix.fire_res", stat: "fireResPct", label: "% to Fire Resistance", minItemLevel: 1, min: 5, max: 25 },
  { id: "affix.armour", stat: "armour", label: "to Armour", minItemLevel: 8, min: 10, max: 60 },
  { id: "affix.cast_speed", stat: "castSpeedPct", label: "% increased Cast Speed", minItemLevel: 12, min: 3, max: 12 },
];

// Validate at module load; bad content is a programmer error, fail fast.
for (const b of ITEM_BASES) {
  const r = validateItemBase(b);
  if (!r.ok) throw new Error(`[content-runtime] Invalid item base "${(b as ItemBase).id}": ${r.errors.join("; ")}`);
}
for (const a of AFFIXES) {
  const r = validateAffix(a);
  if (!r.ok) throw new Error(`[content-runtime] Invalid affix "${(a as Affix).id}": ${r.errors.join("; ")}`);
}

export const ITEM_POOLS: ItemPools = { bases: ITEM_BASES, affixes: AFFIXES };

const BASE_BY_ID = new Map(ITEM_BASES.map((b) => [b.id, b]));
const AFFIX_BY_ID = new Map(AFFIXES.map((a) => [a.id, a]));

export function baseOf(baseId: string): ItemBase {
  const b = BASE_BY_ID.get(baseId);
  if (!b) throw new Error(`unknown item base: ${baseId}`);
  return b;
}

// Render-ready projection: base name + one line per committed affix roll.
export function describeItem(item: Item): { name: string; rarity: Rarity; lines: string[] } {
  const lines = item.affixes.map((ia) => {
    const a = AFFIX_BY_ID.get(ia.affixId);
    return a ? `+${ia.value} ${a.label}` : `+${ia.value} ${ia.affixId}`;
  });
  return { name: baseOf(item.baseId).name, rarity: item.rarity, lines };
}
```

- [ ] **Step 4: Re-export from the package index**

Add to `packages/content-runtime/src/index.ts`:

```ts
export { ITEM_POOLS, baseOf, describeItem } from "./items.js";
```

- [ ] **Step 5: Run test + typecheck**

Run: `rtk proxy npx vitest run packages/content-runtime/src/items.test.ts`
Expected: PASS (5 tests).
Run: `npm run typecheck`
Expected: rc=0.

- [ ] **Step 6: Commit**

```bash
git add packages/content-runtime/src/items.ts packages/content-runtime/src/items.test.ts packages/content-runtime/src/index.ts
git commit -m "feat(content-runtime): item base/affix pools + describeItem (First Loot)"
```

---

### Task 3: rollItem generator (@pact/rules)

**Files:**
- Create: `packages/rules/src/items.ts`
- Modify: `packages/rules/src/index.ts` (re-export)
- Test: `packages/rules/src/items.test.ts` (create)

**Interfaces:**
- Consumes: `ItemPools`, `Item`, `ItemAffix`, `Rarity` (type-only) from `@pact/content-schema`.
- Produces: `function rollItem(pools: ItemPools, seed: number, ilvl: number, monsterRarity: number): Item`
  - Deterministic. `monsterRarity`: pass `1` for a rare monster, `2` for the boss.
  - Magic items carry 1–2 affixes, each with `minItemLevel <= ilvl`; normal items carry none.

- [ ] **Step 1: Write the failing test**

Create `packages/rules/src/items.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { rollItem } from "./items.js";
import type { ItemPools } from "@pact/content-schema";

const POOLS: ItemPools = {
  bases: [
    { id: "b0", name: "B0", itemClass: "wand", w: 1, h: 2 },
    { id: "b1", name: "B1", itemClass: "focus", w: 2, h: 2 },
  ],
  affixes: [
    { id: "a.low", stat: "maxLife", label: "life", minItemLevel: 1, min: 5, max: 20 },
    { id: "a.mid", stat: "maxMana", label: "mana", minItemLevel: 1, min: 4, max: 10 },
    { id: "a.high", stat: "armour", label: "armour", minItemLevel: 90, min: 10, max: 60 },
  ],
};

describe("rollItem", () => {
  it("is deterministic for the same inputs", () => {
    const a = rollItem(POOLS, 12345, 70, 1);
    const b = rollItem(POOLS, 12345, 70, 1);
    expect(a).toEqual(b);
  });

  it("differs for different seeds (at least sometimes)", () => {
    const items = new Set(Array.from({ length: 20 }, (_, i) => JSON.stringify(rollItem(POOLS, i + 1, 70, 1))));
    expect(items.size).toBeGreaterThan(1);
  });

  it("magic items have 1..2 affixes, normal have 0", () => {
    for (let s = 1; s <= 200; s++) {
      const it = rollItem(POOLS, s, 70, 1);
      if (it.rarity === "magic") {
        expect(it.affixes.length).toBeGreaterThanOrEqual(1);
        expect(it.affixes.length).toBeLessThanOrEqual(2);
      } else {
        expect(it.affixes.length).toBe(0);
      }
    }
  });

  it("never rolls an affix above the item level", () => {
    for (let s = 1; s <= 200; s++) {
      const it = rollItem(POOLS, s, 70, 2);
      expect(it.affixes.some((x) => x.affixId === "a.high")).toBe(false);
    }
  });

  it("rolls more magic at higher ilvl / monsterRarity", () => {
    const magicAt = (ilvl: number, mr: number) =>
      Array.from({ length: 400 }, (_, s) => rollItem(POOLS, s + 1, ilvl, mr))
        .filter((x) => x.rarity === "magic").length;
    expect(magicAt(79, 2)).toBeGreaterThan(magicAt(65, 1));
  });

  it("affix values fall within the affix range", () => {
    for (let s = 1; s <= 200; s++) {
      const it = rollItem(POOLS, s, 70, 2);
      for (const ia of it.affixes) {
        const a = POOLS.affixes.find((x) => x.id === ia.affixId)!;
        expect(ia.value).toBeGreaterThanOrEqual(a.min);
        expect(ia.value).toBeLessThanOrEqual(a.max);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run packages/rules/src/items.test.ts`
Expected: FAIL (`rollItem` not defined).

- [ ] **Step 3: Write minimal implementation**

Create `packages/rules/src/items.ts`:

```ts
// Pure, deterministic item generation. Type-only content-schema import keeps this
// a leaf (matches rare.ts). PRNG inlined like atlas.ts so there is no @pact dep.
import type { ItemPools, Item, ItemAffix } from "@pact/content-schema";

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

// ponytail: rarity odds are a calibration placeholder (docs/01:780 says empirical).
// One formula, monotonic in ilvl and monsterRarity; tune here only.
function magicPercent(ilvl: number, monsterRarity: number): number {
  const pct = 20 + Math.trunc(ilvl / 4) + monsterRarity * 15;
  return Math.max(0, Math.min(90, pct));
}

export function rollItem(pools: ItemPools, seed: number, ilvl: number, monsterRarity: number): Item {
  const rnd = mulberry32(seed);
  const base = pools.bases[rnd() % pools.bases.length]!;
  const rarity = (rnd() % 100) < magicPercent(ilvl, monsterRarity) ? "magic" : "normal";

  const affixes: ItemAffix[] = [];
  if (rarity === "magic") {
    const eligible = pools.affixes.filter((a) => a.minItemLevel <= ilvl);
    if (eligible.length > 0) {
      const want = 1 + (rnd() % 2); // 1 or 2
      const picked = new Set<string>();
      // Bounded attempts to pick `want` distinct affixes; deterministic order.
      for (let attempt = 0; attempt < want * 4 && picked.size < want && picked.size < eligible.length; attempt++) {
        const a = eligible[rnd() % eligible.length]!;
        if (picked.has(a.id)) continue;
        picked.add(a.id);
        const value = a.min + (rnd() % (a.max - a.min + 1));
        affixes.push({ affixId: a.id, value });
      }
    }
  }

  return { baseId: base.id, rarity, itemLevel: ilvl, affixes };
}
```

- [ ] **Step 4: Re-export**

Add to `packages/rules/src/index.ts`:

```ts
export * from "./items.js";
```

- [ ] **Step 5: Run test + typecheck**

Run: `rtk proxy npx vitest run packages/rules/src/items.test.ts`
Expected: PASS (6 tests).
Run: `npm run typecheck`
Expected: rc=0.

- [ ] **Step 6: Commit**

```bash
git add packages/rules/src/items.ts packages/rules/src/items.test.ts packages/rules/src/index.ts
git commit -m "feat(rules): deterministic rollItem generator (First Loot)"
```

---

### Task 4: Inventory components + first-fit placement (simulation)

**Files:**
- Modify: `packages/simulation/src/components.ts`
- Create: `packages/simulation/src/inventory.ts`
- Modify: `packages/simulation/src/index.ts` (re-export types + helper)
- Test: `packages/simulation/src/inventory.test.ts` (create)

**Interfaces:**
- Consumes: `Item` (type-only) from `@pact/content-schema`.
- Produces:
  - `interface ItemC { item: Item; w: number; h: number }`
  - `interface PlacedItem { x: number; y: number; w: number; h: number; item: Item }`
  - `interface InventoryC { cols: number; rows: number; items: PlacedItem[] }`
  - `function placeFirstFit(inv: InventoryC, w: number, h: number): { x: number; y: number } | null`

- [ ] **Step 1: Write the failing test**

Create `packages/simulation/src/inventory.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { placeFirstFit } from "./inventory";
import type { InventoryC } from "./components";
import type { Item } from "@pact/content-schema";

const ITEM: Item = { baseId: "b0", rarity: "normal", itemLevel: 65, affixes: [] };
const empty = (): InventoryC => ({ cols: 12, rows: 5, items: [] });

describe("placeFirstFit", () => {
  it("places the first item at the top-left", () => {
    expect(placeFirstFit(empty(), 2, 2)).toEqual({ x: 0, y: 0 });
  });

  it("places the next item beside an occupied one", () => {
    const inv = empty();
    inv.items.push({ x: 0, y: 0, w: 2, h: 2, item: ITEM });
    expect(placeFirstFit(inv, 2, 2)).toEqual({ x: 2, y: 0 });
  });

  it("does not place a piece that would overflow the width", () => {
    const inv: InventoryC = { cols: 3, rows: 5, items: [] };
    expect(placeFirstFit(inv, 4, 1)).toBeNull();
  });

  it("returns null when the grid is full", () => {
    const inv: InventoryC = { cols: 2, rows: 2, items: [{ x: 0, y: 0, w: 2, h: 2, item: ITEM }] };
    expect(placeFirstFit(inv, 1, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run packages/simulation/src/inventory.test.ts`
Expected: FAIL (`./inventory` missing).

- [ ] **Step 3: Add components**

Append to `packages/simulation/src/components.ts` (add a type-only import at the top of the file: `import type { Item } from "@pact/content-schema";`):

```ts
/** A committed item lying on the ground; lives on an entity with Position. */
export interface ItemC { item: Item; w: number; h: number }
/** One placed stack in the grid inventory. */
export interface PlacedItem { x: number; y: number; w: number; h: number; item: Item }
/** Grid inventory on the session singleton. In-memory only this slice. */
export interface InventoryC { cols: number; rows: number; items: PlacedItem[] }
```

- [ ] **Step 4: Write the placement helper**

Create `packages/simulation/src/inventory.ts`:

```ts
import type { InventoryC } from "./components";

function overlaps(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/**
 * First-fit top-left placement for a w×h piece. Scans rows then columns and
 * returns the first free rectangle, or null if none fits. Deterministic.
 */
export function placeFirstFit(inv: InventoryC, w: number, h: number): { x: number; y: number } | null {
  if (w > inv.cols || h > inv.rows) return null;
  for (let y = 0; y <= inv.rows - h; y++) {
    for (let x = 0; x <= inv.cols - w; x++) {
      const clash = inv.items.some((p) => overlaps(x, y, w, h, p.x, p.y, p.w, p.h));
      if (!clash) return { x, y };
    }
  }
  return null;
}
```

- [ ] **Step 5: Re-export**

Add to `packages/simulation/src/index.ts`:

```ts
export type { ItemC, PlacedItem, InventoryC } from "./components";
export { placeFirstFit } from "./inventory";
```

- [ ] **Step 6: Run test + typecheck**

Run: `rtk proxy npx vitest run packages/simulation/src/inventory.test.ts`
Expected: PASS (4 tests).
Run: `npm run typecheck`
Expected: rc=0.

- [ ] **Step 7: Commit**

```bash
git add packages/simulation/src/components.ts packages/simulation/src/inventory.ts packages/simulation/src/inventory.test.ts packages/simulation/src/index.ts
git commit -m "feat(sim): inventory components + first-fit placement (First Loot)"
```

---

### Task 5: Drops on boss/rare death + inventory init (simulation)

**Files:**
- Modify: `packages/simulation/src/systems/death.ts`
- Modify: `packages/simulation/src/combat-sim.ts:90-102` (init `InventoryC` on the session entity)
- Test: `packages/simulation/src/systems/death.test.ts` (extend)

**Interfaces:**
- Consumes: `rollItem` (`@pact/rules`), `ITEM_POOLS` + `baseOf` (`@pact/content-runtime`), `areaLevel` (`@pact/rules`), `fnv1a32` (`../rng`), `ItemC`, `Position`, `SessionC`, `MonsterC`, `BossC`.
- Produces: on a boss or `rare===1` monster death while `session.area === "map"`, one ground entity with `ItemC` + `Position` at the corpse. Drop seed = `fnv1a32(\`${mapSeed}:${tick}:${entity}\`)`, ilvl = `areaLevel(areaTier)`, monsterRarity = boss ? 2 : 1.

- [ ] **Step 1: Write the failing test**

Add to `packages/simulation/src/systems/death.test.ts` (import helpers as the file already does; add `ITEM_POOLS` usage as needed). These tests build a minimal world with a session in "map", a dying rare monster and a dying boss, run the death system, and assert a ground item entity appears:

```ts
import { ITEM_POOLS } from "@pact/content-runtime";
// ...existing imports (Simulation, registerDeath, component setters used by this file)...

it("drops one ground item when a rare monster dies in a map", () => {
  const sim = new Simulation();
  registerDeath(sim);
  const w = sim.world;
  const s = w.create();
  w.set(s, "session", { area: "map", atlasSeed: 1, mapSeed: 7, areaTier: 5, activeNodeId: "node.ashen_glade", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "" });
  const m = w.create();
  w.set(m, "position", { x: 100, y: 200 });
  w.set(m, "health", { life: 0, maxLife: 40 });
  w.set(m, "monster", { defId: "d", moveSpeed: 0, bodyRadius: 0, attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, state: "idle", rare: 1, summoned: 0 });
  sim.step([]);
  const groundItems = w.query("item", "position");
  expect(groundItems.length).toBe(1);
  const ic = w.get(groundItems[0]!, "item") as { item: { itemLevel: number }; w: number; h: number };
  expect(ic.item.itemLevel).toBe(69); // 64 + tier 5
  expect(ic.w).toBeGreaterThan(0);
});

it("does not drop when an ordinary (non-rare, non-boss) monster dies", () => {
  const sim = new Simulation();
  registerDeath(sim);
  const w = sim.world;
  const s = w.create();
  w.set(s, "session", { area: "map", atlasSeed: 1, mapSeed: 7, areaTier: 5, activeNodeId: "n", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "" });
  const m = w.create();
  w.set(m, "position", { x: 0, y: 0 });
  w.set(m, "health", { life: 0, maxLife: 40 });
  w.set(m, "monster", { defId: "d", moveSpeed: 0, bodyRadius: 0, attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, state: "idle", rare: 0, summoned: 0 });
  sim.step([]);
  expect(w.query("item", "position").length).toBe(0);
});
```

(If the existing test file uses helper constructors for these components, reuse them instead of the inline literals above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run packages/simulation/src/systems/death.test.ts`
Expected: FAIL (no `item` entities are created).

- [ ] **Step 3: Implement the drop in death.ts**

In `packages/simulation/src/systems/death.ts`, add imports at the top:

```ts
import { fnv1a32 } from "../rng";
import { rollItem, areaLevel } from "@pact/rules";
import { ITEM_POOLS, baseOf } from "@pact/content-runtime";
import type { ItemC, Position } from "../components";
```

Inside the monster-death loop, replace the boss-only block with a block that (a) still completes the node for a boss and (b) drops for boss **or** rare. Keep the existing node-completion logic; add the drop before `world.destroy(e)`:

```ts
for (const e of world.query("monster", "health")) {
  if ((world.get<Health>(e, "health")?.life ?? 1) > 0) continue;

  const sessionE = world.query("session")[0];
  const s = sessionE !== undefined ? world.get<SessionC>(sessionE, "session") : undefined;
  const isBoss = world.has(e, "boss");
  const isRare = world.get<MonsterC>(e, "monster")?.rare === 1;

  // A dying map boss completes the active Atlas node before it is destroyed.
  if (isBoss && s && s.area === "map" && s.activeNodeId !== "" && !s.completedNodes.includes(s.activeNodeId)) {
    world.set<SessionC>(sessionE!, "session", { ...s, completedNodes: [...s.completedNodes, s.activeNodeId] });
  }

  // Boss and rare monsters drop one committed item where they die.
  if (s && s.area === "map" && (isBoss || isRare)) {
    const pos = world.get<Position>(e, "position");
    if (pos) {
      const seed = fnv1a32(`${s.mapSeed}:${tick}:${e}`);
      const item = rollItem(ITEM_POOLS, seed, areaLevel(s.areaTier), isBoss ? 2 : 1);
      const base = baseOf(item.baseId);
      const ge = world.create();
      world.set<Position>(ge, "position", { x: pos.x, y: pos.y });
      world.set<ItemC>(ge, "item", { item, w: base.w, h: base.h });
    }
  }

  world.destroy(e);
}
```

Ensure `MonsterC` and `Position` are imported in the file's type imports. The system callback already receives `tick` (second parameter) — confirm the signature is `(world, tick, _commands)`; if `tick` is currently named `_tick`, rename it to `tick`.

- [ ] **Step 4: Init an empty inventory on the session**

In `packages/simulation/src/combat-sim.ts`, right after `world.set<SessionC>(sessionE, "session", session);` (line ~102), add:

```ts
world.set<InventoryC>(sessionE, "inventory", { cols: 12, rows: 5, items: [] });
```

Add `InventoryC` to the component type import at the top of `combat-sim.ts`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `rtk proxy npx vitest run packages/simulation/src/systems/death.test.ts`
Expected: PASS (existing death tests + 2 new).

- [ ] **Step 6: Verify replay + checksum stability (the waystones lesson)**

Run: `rtk proxy npx vitest run packages/simulation packages/replay`
Expected: PASS, including boss golden replays (item objects + affix arrays serialize through `stableValue`'s existing recursive object/array handling — no checksum.ts change).
Run: `npm run typecheck`
Expected: rc=0.

- [ ] **Step 7: Commit**

```bash
git add packages/simulation/src/systems/death.ts packages/simulation/src/systems/death.test.ts packages/simulation/src/combat-sim.ts
git commit -m "feat(sim): boss and rare monsters drop a committed item on death"
```

---

### Task 6: pickupItem intent + snapshot projection (protocol + bridge)

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/simulation/src/protocol-bridge.ts`
- Test: `packages/protocol/src/protocol.test.ts` (extend), `packages/simulation/src/protocol-bridge.test.ts` (extend)

**Interfaces:**
- Consumes: existing `Intent`, `validateIntent`, `Snapshot`, `intentToCommand`, `buildSnapshot`, `inRangeOf`; `describeItem` (`@pact/content-runtime`); `ItemC`, `InventoryC`, `Position`, `SessionC`.
- Produces:
  - Intent `{ kind: "pickupItem"; entityId: number }`; `CommandType` gains `"pickupItem"`; `intentToCommand` emits `data: { entityId }`.
  - `type ItemRarity = "normal" | "magic"` (protocol-local; no content-schema import).
  - `SnapshotEntity.kind` gains `"groundItem"`; ground items reported with `rarity` + `inRange`.
  - `Snapshot.inventory: { cols: number; rows: number; items: { x: number; y: number; w: number; h: number; rarity: ItemRarity; name: string; lines: string[] }[] }`.
  - Ground items also expose a display `name` and `lines` for hover.
  - `PICKUP_RADIUS` constant exported from protocol.

- [ ] **Step 1: Write the failing tests**

Add to `packages/protocol/src/protocol.test.ts`:

```ts
it("validates a pickupItem intent", () => {
  expect(validateIntent({ kind: "pickupItem", entityId: 7 })).toEqual({ kind: "pickupItem", entityId: 7 });
});
it("rejects pickupItem with a non-integer entityId", () => {
  expect(() => validateIntent({ kind: "pickupItem", entityId: "x" })).toThrow();
});
```

Add to `packages/simulation/src/protocol-bridge.test.ts` (a world with a session + one ground item near the player):

Build a world with a player, a session (with an empty `InventoryC`), and one ground-item entity whose `position` is within `PICKUP_RADIUS` of the player (reuse the file's existing world/setup helpers; roll the item with `rollItem(ITEM_POOLS, 1, 65, 1)` and read `baseOf(item.baseId)` for `w`/`h`):

```ts
it("reports ground items and an empty inventory in the snapshot", () => {
  const item = rollItem(ITEM_POOLS, 1, 65, 1);
  const base = baseOf(item.baseId);
  const ge = world.create();
  world.set(ge, "position", playerPos);              // same cell as player → in range
  world.set(ge, "item", { item, w: base.w, h: base.h });
  const snap = buildSnapshot(world, sim, 1, "test");
  const gi = snap.entities.find((e) => e.kind === "groundItem");
  expect(gi).toBeDefined();
  expect(gi!.rarity).toBe(item.rarity);
  expect(gi!.name).toBe(base.name);
  expect(gi!.inRange).toBe(true);
  expect(snap.inventory).toEqual({ cols: 12, rows: 5, items: [] });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy npx vitest run packages/protocol packages/simulation/src/protocol-bridge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend the protocol**

In `packages/protocol/src/index.ts`:

Add to the `Intent` union:

```ts
  /** Pick up a ground item. Sim re-checks range + placement. */
  | { kind: "pickupItem"; entityId: number };
```

Extend `CommandType`:

```ts
export type CommandType = "moveTo" | "moveDir" | "useSkill" | "stop" | "interact" | "activateMap" | "pickupItem";
```

Add a rarity type + pickup radius:

```ts
export type ItemRarity = "normal" | "magic";
/** Interaction range for picking up a ground item, Fixed units (matches device/portal radius). */
export const PICKUP_RADIUS = 2.5;
```

Extend `SnapshotEntity` (add fields; `kind` gains `"groundItem"`):

```ts
  kind: "monster" | "projectile" | "groundArea" | "telegraph" | "portal" | "mapDevice" | "groundItem";
  // ...existing optional fields...
  /** groundItem only: rarity tint, display name, affix lines, and pickup range. */
  rarity?: ItemRarity;
  name?: string;
  lines?: string[];
```

(Note `inRange` already exists on `SnapshotEntity`; reuse it for ground items.)

Extend `Snapshot`:

```ts
  /** Grid inventory (session singleton), display-ready. Empty when no session. */
  inventory: { cols: number; rows: number; items: { x: number; y: number; w: number; h: number; rarity: ItemRarity; name: string; lines: string[] }[] };
```

Add the `validateIntent` case (before `default`):

```ts
    case "pickupItem": {
      if (!Number.isInteger(obj["entityId"]))
        throw new Error("validateIntent pickupItem: entityId must be an integer");
      return { kind: "pickupItem", entityId: obj["entityId"] as number };
    }
```

- [ ] **Step 4: Extend the bridge**

In `packages/simulation/src/protocol-bridge.ts`:

Add imports:

```ts
import { PICKUP_RADIUS } from "@pact/protocol";
import { describeItem } from "@pact/content-runtime";
import type { ItemC, InventoryC } from "./components";
```

Add the `intentToCommand` case:

```ts
    case "pickupItem":
      return { tick, entity: player, type: "pickupItem", data: { entityId: intent.entityId } };
```

In `buildSnapshot`, after the interactable loop and before `entities.sort(...)`, add a ground-item loop:

```ts
  for (const e of world.query("item", "position")) {
    const ip = world.get<Position>(e, "position")!;
    const ic = world.get<ItemC>(e, "item")!;
    const d = describeItem(ic.item);
    entities.push({
      id: e,
      kind: "groundItem",
      x: toNumber(ip.x), y: toNumber(ip.y),
      rarity: d.rarity,
      name: d.name,
      lines: d.lines,
      inRange: inRangeOf(pp.x, pp.y, ip.x, ip.y, PICKUP_RADIUS),
    });
  }
```

Build the `inventory` field (read the session's `InventoryC`, default empty):

```ts
  const invC = sessionE !== undefined ? world.get<InventoryC>(sessionE, "inventory") : undefined;
  const inventory = {
    cols: invC?.cols ?? 12,
    rows: invC?.rows ?? 5,
    items: (invC?.items ?? []).map((p) => {
      const d = describeItem(p.item);
      return { x: p.x, y: p.y, w: p.w, h: p.h, rarity: d.rarity, name: d.name, lines: d.lines };
    }),
  };
```

Add `inventory,` to the returned `Snapshot` object literal.

- [ ] **Step 5: Run tests + typecheck**

Run: `rtk proxy npx vitest run packages/protocol packages/simulation/src/protocol-bridge.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: rc=0 (fix any web/HUD callers that destructure `Snapshot` and now need the `inventory` field — the `Hud`/render tests build `Snapshot` fixtures; add `inventory: { cols: 12, rows: 5, items: [] }` to those fixtures if the compiler flags them).

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/index.ts packages/protocol/src/protocol.test.ts packages/simulation/src/protocol-bridge.ts packages/simulation/src/protocol-bridge.test.ts
git commit -m "feat(protocol): pickupItem intent + ground-item/inventory snapshot projection"
```

---

### Task 7: pickup system (simulation)

**Files:**
- Create: `packages/simulation/src/systems/pickup.ts`
- Modify: `packages/simulation/src/index.ts` (export `registerPickupSystem`)
- Modify: `packages/simulation/src/combat-sim.ts` (register the system in the area-based path, after `registerInteractSystem`)
- Test: `packages/simulation/src/systems/pickup.test.ts` (create)

**Interfaces:**
- Consumes: `inRangeOf` (protocol-bridge), `placeFirstFit` (`../inventory`), `PICKUP_RADIUS` (`@pact/protocol`), `ItemC`, `InventoryC`, `Position`, `SessionC`.
- Produces: `function registerPickupSystem(sim: Simulation): void`. On a `pickupItem` command whose target ground entity is in range, first-fit-places the item into the session `InventoryC` and destroys the ground entity. Out of range, missing target, or no room → no-op (no ownership change).

- [ ] **Step 1: Write the failing test**

Create `packages/simulation/src/systems/pickup.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Simulation } from "../loop";
import { registerPickupSystem } from "./pickup";
import type { Item } from "@pact/content-schema";

const ITEM: Item = { baseId: "b0", rarity: "normal", itemLevel: 65, affixes: [] };

function setup(playerXY: [number, number], itemXY: [number, number], invItems: unknown[] = []) {
  const sim = new Simulation();
  registerPickupSystem(sim);
  const w = sim.world;
  const player = w.create();
  w.set(player, "position", { x: playerXY[0], y: playerXY[1] });
  const s = w.create();
  w.set(s, "session", { area: "map", atlasSeed: 1, mapSeed: 7, areaTier: 5, activeNodeId: "n", completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "" });
  w.set(s, "inventory", { cols: 12, rows: 5, items: invItems });
  const ge = w.create();
  w.set(ge, "position", { x: itemXY[0], y: itemXY[1] });
  w.set(ge, "item", { item: ITEM, w: 2, h: 2 });
  return { sim, w, player, sessionE: s, ge };
}

const pickup = (player: number, entityId: number) => ({ tick: 0, entity: player, type: "pickupItem", data: { entityId } });

describe("registerPickupSystem", () => {
  it("moves an in-range ground item into the inventory and destroys it", () => {
    const { sim, w, player, sessionE, ge } = setup([1000, 1000], [1001, 1001]);
    sim.step([pickup(player, ge)]);
    expect(w.alive.has(ge)).toBe(false);
    const inv = w.get(sessionE, "inventory") as { items: unknown[] };
    expect(inv.items.length).toBe(1);
  });

  it("is a no-op when the item is out of range", () => {
    const { sim, w, player, sessionE, ge } = setup([0, 0], [1_000_000, 1_000_000]);
    sim.step([pickup(player, ge)]);
    expect(w.alive.has(ge)).toBe(true);
    expect((w.get(sessionE, "inventory") as { items: unknown[] }).items.length).toBe(0);
  });

  it("is a no-op with no ownership change when the grid is full", () => {
    const full = [{ x: 0, y: 0, w: 12, h: 5, item: ITEM }];
    const { sim, w, player, sessionE, ge } = setup([1000, 1000], [1001, 1001], full);
    sim.step([pickup(player, ge)]);
    expect(w.alive.has(ge)).toBe(true);
    expect((w.get(sessionE, "inventory") as { items: unknown[] }).items.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run packages/simulation/src/systems/pickup.test.ts`
Expected: FAIL (`./pickup` missing).

- [ ] **Step 3: Implement the system**

Create `packages/simulation/src/systems/pickup.ts`:

```ts
import { PICKUP_RADIUS } from "@pact/protocol";
import { Simulation } from "../loop";
import { inRangeOf } from "../protocol-bridge";
import { placeFirstFit } from "../inventory";
import type { Position, ItemC, InventoryC } from "../components";

export function registerPickupSystem(sim: Simulation): void {
  sim.register("pickup", (world, _tick, commands) => {
    const sessionE = world.query("session")[0];
    if (sessionE === undefined) return;

    for (const cmd of commands) {
      if (cmd.type !== "pickupItem" || cmd.entity === undefined) continue;
      const targetId = cmd.data?.["entityId"];
      if (targetId === undefined) continue;
      if (!world.alive.has(targetId)) continue;
      if (!world.has(targetId, "item") || !world.has(targetId, "position")) continue;

      const playerPos = world.get<Position>(cmd.entity, "position");
      const itemPos = world.get<Position>(targetId, "position");
      if (!playerPos || !itemPos) continue;
      if (!inRangeOf(playerPos.x, playerPos.y, itemPos.x, itemPos.y, PICKUP_RADIUS)) continue;

      const ic = world.get<ItemC>(targetId, "item")!;
      const inv = world.get<InventoryC>(sessionE, "inventory")!;
      const slot = placeFirstFit(inv, ic.w, ic.h);
      if (slot === null) continue; // no room: no-op, no ownership change

      world.set<InventoryC>(sessionE, "inventory", {
        ...inv,
        items: [...inv.items, { x: slot.x, y: slot.y, w: ic.w, h: ic.h, item: ic.item }],
      });
      world.destroy(targetId);
    }
  });
}
```

- [ ] **Step 4: Register + export**

Add to `packages/simulation/src/index.ts`:

```ts
export { registerPickupSystem } from "./systems/pickup";
```

In `packages/simulation/src/combat-sim.ts`, in the area-based path (after `registerInteractSystem(sim);`), add:

```ts
    registerPickupSystem(sim);
```

Import `registerPickupSystem` in `combat-sim.ts`.

- [ ] **Step 5: Run tests + replay + typecheck**

Run: `rtk proxy npx vitest run packages/simulation/src/systems/pickup.test.ts`
Expected: PASS (3 tests).
Run: `rtk proxy npx vitest run packages/simulation packages/replay`
Expected: PASS (system order changed — the pickup system is appended after interact, so legacy golden replays that assert the first-N system order are unaffected; if any order-snapshot test fails, confirm the append position and update the expected order only if it is an area-based ordering check, not a legacy one).
Run: `npm run typecheck`
Expected: rc=0.

- [ ] **Step 6: Commit**

```bash
git add packages/simulation/src/systems/pickup.ts packages/simulation/src/systems/pickup.test.ts packages/simulation/src/index.ts packages/simulation/src/combat-sim.ts
git commit -m "feat(sim): pickup system moves in-range ground items into the grid inventory"
```

---

### Task 8: Client render for ground items (apps/web)

**Files:**
- Modify: `apps/web/src/render/meshes.ts` (add `"groundItem"` to `MeshKind`, `Y_LIFT`, and `makeMesh`)
- Modify: `apps/web/src/render/renderer.ts` (`kindOf` maps `"groundItem"`)
- Test: `apps/web/src/render/renderer.test.ts` if a `kindOf` unit test exists; otherwise add a small test file `apps/web/src/render/ground-item.test.ts`

**Interfaces:**
- Consumes: `SnapshotEntity.kind === "groundItem"`.
- Produces: a small rarity-neutral marker mesh for ground items; the renderer creates/positions it like any other entity.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/render/ground-item.test.ts` (jsdom not required — pure function):

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { Y_LIFT } from "./meshes";

describe("ground item mesh", () => {
  it("has a Y_LIFT entry so it renders on the floor", () => {
    expect(typeof Y_LIFT["groundItem"]).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy npx vitest run apps/web/src/render/ground-item.test.ts`
Expected: FAIL (`Y_LIFT["groundItem"]` is `undefined`).

- [ ] **Step 3: Extend meshes.ts**

In `apps/web/src/render/meshes.ts`:

- Add `"groundItem"` to the `MeshKind` union (line 11).
- Add a `Y_LIFT` entry, e.g. `groundItem: 0.15,` (sits just above the floor).
- In `makeMesh` (the `switch (kind)`), add a case that builds a small emissive marker. Follow the existing primitive-mesh idiom in that function (reuse `MeshBuilder` the way the `projectile`/`groundArea` cases do). Minimal example:

```ts
    case "groundItem": {
      const m = MeshBuilder.CreateCylinder(name, { diameter: 0.5, height: 0.3, tessellation: 6 }, scene);
      const mat = new StandardMaterial(`${name}-mat`, scene);
      mat.emissiveColor = new Color3(0.55, 0.7, 1.0); // magic-blue-ish beacon
      m.material = mat;
      return m;
    }
```

Use whatever `MeshBuilder`/`StandardMaterial`/`Color3` imports the file already has; do not add new imports if they exist.

- [ ] **Step 4: Map it in the renderer**

In `apps/web/src/render/renderer.ts`, `kindOf` (line 25), add before the final `return "groundArea"`:

```ts
  if (e.kind === "groundItem") return "groundItem";
```

- [ ] **Step 5: Run test + typecheck + build**

Run: `rtk proxy npx vitest run apps/web/src/render/ground-item.test.ts`
Expected: PASS.
Run: `npm run typecheck`
Expected: rc=0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/render/meshes.ts apps/web/src/render/renderer.ts apps/web/src/render/ground-item.test.ts
git commit -m "feat(web): ground-item marker mesh"
```

---

### Task 9: Inventory panel + pickup binding + App wiring (apps/web)

**Files:**
- Create: `apps/web/src/hud/InventoryPanel.tsx`
- Test: `apps/web/src/hud/InventoryPanel.test.tsx` (create)
- Modify: `apps/web/src/input/bindings.ts` (pickup keypress; track latest snapshot)
- Test: `apps/web/src/input/bindings.test.ts` (extend)
- Modify: `apps/web/src/App.tsx` (inventory toggle + render panel)

**Interfaces:**
- Consumes: `Snapshot.inventory`, `Snapshot.entities` (`kind === "groundItem"` with `inRange`, `name`, `lines`, `rarity`).
- Produces:
  - `InventoryPanel({ inventory, onClose })` — a 12×5 grid; each item drawn at its `w×h` footprint, rarity-tinted, `title`/tooltip showing name + affix lines. Testids: `inventory-panel`, `inventory-cell-<x>-<y>`, `inventory-item-<index>`.
  - bindings: a new optional `onPickupNearest?: () => void`-style behavior driven internally — on `g` keydown, if a ground item with `inRange` exists in the latest snapshot, post `{ kind: "pickupItem", entityId }` for the nearest one.

- [ ] **Step 1: Write the failing panel test**

Create `apps/web/src/hud/InventoryPanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { InventoryPanel } from "./InventoryPanel";

afterEach(cleanup);

const inv = {
  cols: 12,
  rows: 5,
  items: [{ x: 0, y: 0, w: 2, h: 2, rarity: "magic" as const, name: "Ember Wand", lines: ["+12 to maximum Life"] }],
};

describe("InventoryPanel", () => {
  it("renders the grid and a placed item with its tooltip text", () => {
    render(<InventoryPanel inventory={inv} onClose={() => {}} />);
    expect(screen.getByTestId("inventory-panel")).toBeTruthy();
    const item = screen.getByTestId("inventory-item-0");
    expect(item.getAttribute("title")).toContain("Ember Wand");
    expect(item.getAttribute("title")).toContain("+12 to maximum Life");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `rtk proxy npx vitest run apps/web/src/hud/InventoryPanel.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the panel**

Create `apps/web/src/hud/InventoryPanel.tsx` (follow the PoE-styled idiom of `PreparationPanel.tsx` — dark carved frame, gilt border; keep it small):

```tsx
import React from "react";
import type { Snapshot } from "@pact/protocol";

type Inventory = Snapshot["inventory"];

const CELL = 44;
const RARITY_BORDER: Record<string, string> = { normal: "#6b6b6b", magic: "#4a6bd6" };
const RARITY_TEXT: Record<string, string> = { normal: "#c8c8c8", magic: "#8ab0ff" };

export function InventoryPanel({ inventory, onClose }: { inventory: Inventory; onClose: () => void }) {
  const { cols, rows, items } = inventory;
  return (
    <div
      data-testid="inventory-panel"
      style={{
        position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        padding: 16, background: "linear-gradient(#1a140e,#0d0a07)",
        border: "2px solid #9c7b3a", boxShadow: "0 0 0 2px #4a3a1c, 0 8px 24px rgba(0,0,0,0.7)",
        borderRadius: 6, pointerEvents: "auto",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ color: "#c9a84c", fontVariant: "small-caps", letterSpacing: 1, fontWeight: 700 }}>Inventory</span>
        <button data-testid="inventory-close" onClick={onClose} style={{ background: "none", border: "1px solid #4a3a1c", color: "#c9a84c", cursor: "pointer", padding: "2px 8px" }}>Close</button>
      </div>
      <div style={{ position: "relative", width: cols * CELL, height: rows * CELL, background: "#0b0d11", border: "1px solid #2a2118" }}>
        {/* grid cells */}
        {Array.from({ length: rows }).map((_, y) =>
          Array.from({ length: cols }).map((__, x) => (
            <div key={`${x}-${y}`} data-testid={`inventory-cell-${x}-${y}`}
              style={{ position: "absolute", left: x * CELL, top: y * CELL, width: CELL, height: CELL, border: "1px solid #1c1710" }} />
          )),
        )}
        {/* placed items */}
        {items.map((it, i) => (
          <div key={i} data-testid={`inventory-item-${i}`}
            title={`${it.name}${it.lines.length ? "\n" + it.lines.join("\n") : ""}`}
            style={{
              position: "absolute", left: it.x * CELL + 2, top: it.y * CELL + 2,
              width: it.w * CELL - 4, height: it.h * CELL - 4,
              border: `2px solid ${RARITY_BORDER[it.rarity] ?? "#6b6b6b"}`,
              background: "rgba(20,26,40,0.85)", color: RARITY_TEXT[it.rarity] ?? "#c8c8c8",
              fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center",
              textAlign: "center", padding: 2, boxSizing: "border-box",
            }}>
            {it.name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run panel test**

Run: `rtk proxy npx vitest run apps/web/src/hud/InventoryPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing bindings test**

Add to `apps/web/src/input/bindings.test.ts` a case: after attaching bindings, feed a snapshot (via the returned `onSnapshot`) that contains a `groundItem` with `inRange: true`, dispatch a `keydown` for `g`, and assert the worker received `{ type: "intent", intent: { kind: "pickupItem", entityId: <id> } }`. Reuse the file's existing worker mock + attach helper. Example core assertion:

```ts
onSnapshot({ /* ...minimal snapshot... */, entities: [{ id: 55, kind: "groundItem", x: 0, y: 0, inRange: true }] } as any);
window.dispatchEvent(new KeyboardEvent("keydown", { key: "g" }));
expect(postedIntents).toContainEqual({ kind: "pickupItem", entityId: 55 });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `rtk proxy npx vitest run apps/web/src/input/bindings.test.ts`
Expected: FAIL (no `g` handler yet).

- [ ] **Step 7: Implement the pickup keypress in bindings.ts**

In `apps/web/src/input/bindings.ts`:

- Add a module-level captured latest snapshot inside `attachBindings`: `let latestSnap: Snapshot | null = null;` and set it at the top of `onSnapshot`: `latestSnap = snap;`.
- In `onKeyDown`, after the existing `o` handler and before the `MOVE_KEYS` block, add:

```ts
    // g = pick up the nearest in-range ground item (sim re-checks range).
    if (k === "g" && latestSnap) {
      const items = latestSnap.entities.filter((e) => e.kind === "groundItem" && e.inRange);
      if (items.length > 0) {
        const px = latestSnap.player.x, py = latestSnap.player.y;
        const nearest = items.reduce((a, b) =>
          (a.x - px) ** 2 + (a.y - py) ** 2 <= (b.x - px) ** 2 + (b.y - py) ** 2 ? a : b);
        post({ kind: "pickupItem", entityId: nearest.id });
      }
      return;
    }
```

- [ ] **Step 8: Run bindings test**

Run: `rtk proxy npx vitest run apps/web/src/input/bindings.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire the panel into App.tsx**

In `apps/web/src/App.tsx`:

- Add state: `const [inventoryOpen, setInventoryOpen] = useState(false);`
- Add a keydown listener (in the effect, alongside the others, or via a small `window.addEventListener("keydown", ...)` that toggles on `i`), remembering to remove it in cleanup:

```ts
    const onInvKey = (ev: KeyboardEvent) => { if (ev.key.toLowerCase() === "i") setInventoryOpen((v) => !v); };
    window.addEventListener("keydown", onInvKey);
```
and in the cleanup return, `window.removeEventListener("keydown", onInvKey);`.

- Render the panel near the `PreparationPanel` block:

```tsx
      {inventoryOpen && snapshot && (
        <InventoryPanel inventory={snapshot.inventory} onClose={() => setInventoryOpen(false)} />
      )}
```
and import it: `import { InventoryPanel } from "./hud/InventoryPanel";`.

- [ ] **Step 10: Run the web suite + typecheck + build**

Run: `rtk proxy npx vitest run apps/web`
Expected: PASS (existing + new).
Run: `npm run typecheck`
Expected: rc=0.
Run: `npm run build -w apps/web`
Expected: rc=0 (Babylon chunk-size warning is pre-existing and fine).

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/hud/InventoryPanel.tsx apps/web/src/hud/InventoryPanel.test.tsx apps/web/src/input/bindings.ts apps/web/src/input/bindings.test.ts apps/web/src/App.tsx
git commit -m "feat(web): inventory panel, ground-item pickup keybind, App wiring"
```

---

### Task 10: Full verification + devlog + branch review

**Files:**
- Create: `devlog/2026-07-22-first-loot.jpeg` (or next Day-N image)

- [ ] **Step 1: Full green gate**

Run: `npm run typecheck`
Expected: rc=0.
Run: `rtk proxy npx vitest run`
Expected: all packages green, including `packages/replay` golden replays (boss drop is now part of the boss golden path).
Run: `npm run build -w apps/web`
Expected: rc=0.

- [ ] **Step 2: Manual run (per the run skill or `npm run dev -w apps/web`)**

Walk to the map device, open the Preparation Panel, activate a mid/high-tier waystone, enter the map, kill the rare imp and the boss, confirm ground-item markers appear, press `g` near one to pick it up, press `i` to open the inventory and confirm the item sits in the grid with a tooltip. Reload with chrome-devtools `ignoreCache: true` (the sim worker changed). Kill stray vite ports (5173-5177) afterward. Consult `poe2-screenshots/` for the inventory look and adjust `InventoryPanel` styling to match before the screenshot.

- [ ] **Step 3: Devlog screenshot**

Capture the inventory panel + a ground drop into `devlog/2026-07-22-first-loot.jpeg` (per the devlog-screenshots "Day N" convention).

- [ ] **Step 4: Commit the devlog**

```bash
git add devlog/2026-07-22-first-loot.jpeg
git commit -m "docs(devlog): first loot (drops + grid inventory)"
```

- [ ] **Step 5: Whole-slice review**

Build a review package from the slice base to HEAD (base = the commit before Task 1; use `git log --oneline` to confirm — it is the current `main` HEAD before this plan started) and run the requesting-code-review reviewer against the diff + this plan + the spec on the most capable model. Fix any Critical/Important findings in one fix pass, note Minor as deferred with reasons, then run superpowers:finishing-a-development-branch (direct-to-main, no remote → the slice is already integrated; nothing to merge/push).

---

## Self-Review

**Spec coverage:**
- Item types (schema) → Task 1. Pools + display → Task 2. `rollItem` (deterministic, ilvl gating, rarity weighting) → Task 3. Grid inventory + first-fit → Task 4. Boss/rare drops + ilvl=64+tier + tier rarity weighting → Tasks 3+5. Protocol `pickupItem` + snapshot ground items/inventory → Task 6. Authoritative pickup (range + placement, no-op on failure) → Task 7. Client ground render → Task 8. Inventory panel + pickup input → Task 9. Determinism/checksum via replay → Tasks 5,7,10. Devlog + review → Task 10. All spec §In-scope items are covered.
- Out-of-scope items (identification, equipping, stash, currencies, filter, ordinary-monster drops, drag-reorder, quality/sockets, persistence) are implemented by no task, as intended.

**Placeholder scan:** No "TBD"/"implement later". Test bodies and implementations are concrete. The two spots that say "reuse the file's existing helpers" (death.test, bindings.test, protocol-bridge.test) reference real existing test scaffolding rather than leaving logic unwritten; the assertions and the production code are fully specified.

**Type consistency:** `Item`, `ItemBase`, `Affix`, `ItemAffix`, `ItemPools`, `Rarity` defined in Task 1 and used verbatim thereafter. `rollItem(pools, seed, ilvl, monsterRarity)` signature is identical in Tasks 3 and 5. `ItemC { item, w, h }` / `InventoryC { cols, rows, items }` / `PlacedItem { x, y, w, h, item }` defined in Task 4 and used identically in Tasks 5-7. `describeItem` returns `{ name, rarity, lines }` in Task 2 and is consumed that way in Task 6. Snapshot `inventory` shape matches between Task 6 (producer) and Task 9 (consumer). `PICKUP_RADIUS` defined once in Task 6, used in Tasks 6-7. `pickupItem` command carries `data.entityId` in Task 6 and is read as `cmd.data["entityId"]` in Task 7.
