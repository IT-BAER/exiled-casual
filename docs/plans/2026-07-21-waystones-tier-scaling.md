# Waystones + Tier Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Map Device's instant auto-open with a real choice — pick an Atlas node and a Waystone (seed + tier), see the resulting area level and revives, activate — where tier raises area level and scales monster life/damage.

**Architecture:** Waystone/node/tier math is pure functions in `@pact/rules` (deterministic, shared by sim and client). The authoritative sim gains four `SessionC` fields and an `activateMap` intent handler; monsters scale at spawn. The client renders a Preparation Panel that computes the same offers from an `atlasSeed` exposed in the snapshot, and sends `activateMap`.

**Tech Stack:** TypeScript, npm workspaces, ECS sim (30 Hz, fixed-point), React + Babylon client, Vitest.

## Global Constraints

- Area level = `64 + tier`, tier ∈ 1..15 (docs/01:308). Tier XVI/corruption deferred.
- Portals fixed at `MAP_PORTALS = 6`, unaffected by tier (revives are affix-driven; no affixes this slice).
- Tier → monster stats via integer per-mille: `lifeMilli = 1000 + 150*tier`, `dmgMilli = 1000 + 100*tier`; `scaled = Math.trunc(base * milli / 1000)`. Tier 0 → factor 1000 → no-op.
- All sim math deterministic (fixed-point integers); offers are a pure function of `atlasSeed` so the replay checksum stays stable.
- Commit workflow: direct-to-main, one commit per task, **no attribution trailers, no emdashes in messages**.
- Run tests with `npx vitest run` from repo root.
- Node/Waystone are plain data, NOT ECS components.

---

### Task 1: Pure atlas rules in `@pact/rules`

**Files:**
- Create: `packages/rules/src/atlas.ts`
- Modify: `packages/rules/src/index.ts`
- Test: `packages/rules/src/atlas.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module; no imports from other `@pact` packages).
- Produces:
  - `interface Waystone { id: string; seed: number; tier: number }`
  - `interface AtlasNode { id: string; name: string }`
  - `const WAYSTONE_OFFER_COUNT = 3`
  - `function atlasNodes(): AtlasNode[]`
  - `function offerWaystones(atlasSeed: number, count: number): Waystone[]`
  - `function areaLevel(tier: number): number`
  - `function monsterTierScale(tier: number): { lifeMilli: number; dmgMilli: number }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules/src/atlas.test.ts
import { describe, it, expect } from "vitest";
import {
  areaLevel, monsterTierScale, offerWaystones, atlasNodes, WAYSTONE_OFFER_COUNT,
} from "./atlas.js";

describe("atlas rules", () => {
  it("areaLevel is 64 + tier", () => {
    expect(areaLevel(1)).toBe(65);
    expect(areaLevel(15)).toBe(79);
  });

  it("monsterTierScale is per-mille, 1.0 at tier 0", () => {
    expect(monsterTierScale(0)).toEqual({ lifeMilli: 1000, dmgMilli: 1000 });
    expect(monsterTierScale(10)).toEqual({ lifeMilli: 2500, dmgMilli: 2000 });
  });

  it("offerWaystones is deterministic for a seed", () => {
    const a = offerWaystones(42, WAYSTONE_OFFER_COUNT);
    const b = offerWaystones(42, WAYSTONE_OFFER_COUNT);
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    for (const w of a) {
      expect(w.tier).toBeGreaterThanOrEqual(1);
      expect(w.tier).toBeLessThanOrEqual(15);
      expect(Number.isInteger(w.seed)).toBe(true);
    }
    expect(new Set(a.map((w) => w.id)).size).toBe(3); // ids unique
  });

  it("different seeds usually differ", () => {
    expect(offerWaystones(1, 3)).not.toEqual(offerWaystones(2, 3));
  });

  it("atlasNodes is a fixed non-empty list with unique ids", () => {
    const n = atlasNodes();
    expect(n.length).toBeGreaterThanOrEqual(3);
    expect(new Set(n.map((x) => x.id)).size).toBe(n.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/rules/src/atlas.test.ts`
Expected: FAIL — cannot find module `./atlas.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/rules/src/atlas.ts
// Pure, deterministic Waystone/Atlas rules. No @pact imports so both the sim and
// the client can compute identical offers from the same seed (replay-stable).

export interface Waystone { id: string; seed: number; tier: number }
export interface AtlasNode { id: string; name: string }

export const WAYSTONE_OFFER_COUNT = 3;

// Fixed node list for this slice. Nodes are named destinations; tier comes from
// the Waystone, not the node. Real per-node tiers/biomes are Phase 5.
const NODES: readonly AtlasNode[] = [
  { id: "node.ashen_glade", name: "Ashen Glade" },
  { id: "node.emberfall", name: "Emberfall" },
  { id: "node.cinder_vault", name: "Cinder Vault" },
];

export function atlasNodes(): AtlasNode[] {
  return NODES.map((n) => ({ ...n }));
}

// Natural area level per docs/01:308.
export function areaLevel(tier: number): number {
  return 64 + tier;
}

// ponytail: linear per-mille scaling is a calibration placeholder (docs/01:780
// says monster-vs-level needs empirical tuning). Two knobs; adjust here only.
export function monsterTierScale(tier: number): { lifeMilli: number; dmgMilli: number } {
  return { lifeMilli: 1000 + 150 * tier, dmgMilli: 1000 + 100 * tier };
}

// Mulberry32 (same family as the sim PRNG, but inlined so this leaf module keeps
// zero @pact deps and cannot form an import cycle with @pact/simulation).
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

export function offerWaystones(atlasSeed: number, count: number): Waystone[] {
  const rnd = mulberry32(atlasSeed);
  const out: Waystone[] = [];
  for (let i = 0; i < count; i++) {
    const seed = rnd();
    const tier = 1 + (rnd() % 15); // 1..15
    out.push({ id: `ws-${i}`, seed, tier });
  }
  return out;
}
```

- [ ] **Step 4: Add the barrel export**

```ts
// packages/rules/src/index.ts — append
export * from "./atlas.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/rules/src/atlas.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/rules/src/atlas.ts packages/rules/src/atlas.test.ts packages/rules/src/index.ts
git commit -m "feat(rules): waystone offers, atlas nodes, area-level + tier scaling"
```

---

### Task 2: Session fields for atlas seed, tier, active node, completed nodes

**Files:**
- Modify: `packages/simulation/src/components.ts:10-18` (`SessionC`)
- Modify: `packages/simulation/src/combat-sim.ts:91-97` (session init)
- Modify (fixtures): `packages/simulation/src/systems/interact.test.ts` (SessionC literals ~lines 20, 100, 116), `packages/simulation/src/systems/death.test.ts` (~line 77), `packages/simulation/src/systems/area-transition.test.ts` (~lines 30, 106, 153, 174), `packages/simulation/src/protocol-bridge.test.ts` (~line 237)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SessionC` now has `atlasSeed: number`, `areaTier: number`, `activeNodeId: string`, `completedNodes: string[]`.

- [ ] **Step 1: Extend the interface**

```ts
// packages/simulation/src/components.ts — replace the SessionC interface body
export interface SessionC {
  area: AreaKind;
  /** Stable per-session seed that drives the Waystone offers. Never overwritten. */
  atlasSeed: number;
  /** Seed of the currently-activated Waystone; drives area generation. */
  mapSeed: number;
  /** Tier of the open map. 0 = no map open. areaLevel = 64 + areaTier. */
  areaTier: number;
  /** Atlas node the open map belongs to; "" when none. */
  activeNodeId: string;
  /** Atlas node ids completed this session (in-memory only). */
  completedNodes: string[];
  /** Retry budget for the open map. See MAP_PORTALS in @pact/protocol. */
  portalsLeft: number;
  mapOpen: 0 | 1;
  /** Area to build at the end of this tick; "" means stay put. */
  pendingArea: AreaKind | "";
}
```

- [ ] **Step 2: Initialise the new fields at session creation**

```ts
// packages/simulation/src/combat-sim.ts — replace the session literal (~line 91)
    const session: SessionC = {
      area: opts.area,
      atlasSeed: seed,
      mapSeed: seed,
      areaTier: 0,
      activeNodeId: "",
      completedNodes: [],
      portalsLeft: 0,
      mapOpen: 0,
      pendingArea: "",
    };
```

- [ ] **Step 3: Update every SessionC test fixture**

In each file/line listed under **Files**, add these four properties to every `SessionC` object literal (place them right after `area`):

```ts
      atlasSeed: 0, areaTier: 0, activeNodeId: "", completedNodes: [],
```

(Property order is irrelevant; the typecheck fails until every literal has all four. Do not change existing values.)

- [ ] **Step 4: Run typecheck to confirm every literal is updated**

Run: `npm run typecheck`
Expected: rc=0 (any missed fixture surfaces here as a missing-property error).

- [ ] **Step 5: Run the sim suite to confirm no behaviour changed**

Run: `npx vitest run packages/simulation`
Expected: PASS (same count as before, fixtures only gained inert fields).

- [ ] **Step 6: Commit**

```bash
git add packages/simulation/src/components.ts packages/simulation/src/combat-sim.ts packages/simulation/src/systems/interact.test.ts packages/simulation/src/systems/death.test.ts packages/simulation/src/systems/area-transition.test.ts packages/simulation/src/protocol-bridge.test.ts
git commit -m "feat(sim): session carries atlasSeed, areaTier, activeNode, completedNodes"
```

---

### Task 3: Scale map monsters by tier at spawn

**Files:**
- Modify: `packages/simulation/src/areas.ts` (`spawnMonster` signature + map branch of `buildArea`)
- Test: `packages/simulation/src/areas.test.ts` (new; or append if it exists — a `combat-sim.test.ts` already imports areas, but add a focused unit test)

**Interfaces:**
- Consumes: `monsterTierScale` from `@pact/rules` (Task 1); `SessionC.areaTier` (Task 2).
- Produces: `spawnMonster(world, def, x, y, rare, scale?)` where `scale?: { lifeMilli: number; dmgMilli: number }` (default `{ lifeMilli: 1000, dmgMilli: 1000 }`, i.e. unchanged).

- [ ] **Step 1: Write the failing test**

```ts
// packages/rules is pure; this test drives the sim spawn. Create packages/simulation/src/areas.test.ts
import { describe, it, expect } from "vitest";
import { generateArea } from "@pact/mapgen";
import { CONTENT_VERSION, MONSTERS } from "@pact/content-runtime";
import { monsterTierScale } from "@pact/rules";
import { World } from "./ecs.js";
import { buildArea } from "./areas.js";
import type { SessionC, Health, MonsterC } from "./components.js";

function mapSessionAtTier(tier: number): SessionC {
  return {
    area: "map", atlasSeed: 0, mapSeed: 7, areaTier: tier, activeNodeId: "node.ashen_glade",
    completedNodes: [], portalsLeft: 6, mapOpen: 1, pendingArea: "",
  };
}

describe("tier scaling on map spawn", () => {
  it("scales imp life and attack damage by the tier per-mille", () => {
    const tier = 10;
    const world = new World();
    const session = mapSessionAtTier(tier);
    const layout = generateArea(session.mapSeed, CONTENT_VERSION);
    buildArea(world, "map", session, layout);

    const impDef = MONSTERS.get("monster.cinder_imp.v1")!;
    const { lifeMilli, dmgMilli } = monsterTierScale(tier);
    const expectedLife = Math.trunc(impDef.maxLifeFixed * lifeMilli / 1000);
    const expectedDmg = Math.trunc(impDef.attackDamage.amountFixed * dmgMilli / 1000);

    // Find a non-rare imp (rare life is templated separately).
    const imps = world.query("monster", "health").filter((e) => {
      const m = world.get<MonsterC>(e, "monster")!;
      return m.defId === impDef.id && m.rare === 0;
    });
    expect(imps.length).toBeGreaterThan(0);
    const h = world.get<Health>(imps[0]!, "health")!;
    const m = world.get<MonsterC>(imps[0]!, "monster")!;
    expect(h.maxLife).toBe(expectedLife);
    expect(m.attackDamage).toBe(expectedDmg);
  });

  it("tier 0 leaves stats unchanged", () => {
    const world = new World();
    const session = mapSessionAtTier(0);
    const layout = generateArea(session.mapSeed, CONTENT_VERSION);
    buildArea(world, "map", session, layout);
    const impDef = MONSTERS.get("monster.cinder_imp.v1")!;
    const imp = world.query("monster", "health").find((e) => {
      const m = world.get<MonsterC>(e, "monster")!;
      return m.defId === impDef.id && m.rare === 0;
    })!;
    expect(world.get<Health>(imp, "health")!.maxLife).toBe(impDef.maxLifeFixed);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/simulation/src/areas.test.ts`
Expected: FAIL — scaled life differs from base (scaling not applied yet).

- [ ] **Step 3: Implement scaling in areas.ts**

Add the import at the top of `packages/simulation/src/areas.ts`:

```ts
import { monsterTierScale } from "@pact/rules";
```

Change the map branch of `buildArea` (the `else` block) to compute the scale once and pass it to every map spawn:

```ts
  } else {
    // Map monsters scale with the map tier (life + attack damage).
    const scale = monsterTierScale(session.areaTier);
    const impDef = MONSTERS.get("monster.cinder_imp.v1")!;
    const spawns = layout.spawnSockets;
    for (let i = 0; i < spawns.length; i++) {
      const s = spawns[i]!;
      const rare = i === spawns.length - 1;
      const def = rare ? makeRare(impDef, RARE_TEMPLATE) : impDef;
      spawnMonster(world, def, fp(s.x), fp(s.y), rare, scale);
    }

    const boss = anchor(layout, "boss");
    spawnMonster(world, MONSTERS.get("monster.cinder_warden.v1")!, fp(boss.x), fp(boss.y), false, scale);

    // Return portal so the map can be exited without dying.
    const exit = anchor(layout, "exit");
    const portalE = world.create();
    world.set<Position>(portalE, "position", { x: fp(exit.x), y: fp(exit.y) });
    world.set<InteractableC>(portalE, "interactable", {
      kind: "portal",
      radius: fp(2.5),
      yaw: 3.1416,
    });
  }
```

Update `spawnMonster` to accept and apply the scale:

```ts
export function spawnMonster(
  world: World,
  def: MonsterDef,
  x: number,
  y: number,
  rare: boolean,
  scale: { lifeMilli: number; dmgMilli: number } = { lifeMilli: 1000, dmgMilli: 1000 },
): Entity {
  const scaledLife = Math.trunc(def.maxLifeFixed * scale.lifeMilli / 1000);
  const scaledDmg = Math.trunc(def.attackDamage.amountFixed * scale.dmgMilli / 1000);
  const e = world.create();
  world.set<Position>(e, "position", { x, y });
  world.set<Health>(e, "health", { life: scaledLife, maxLife: scaledLife });
  world.set<Faction>(e, "faction", { team: 1 });
  world.set<MonsterC>(e, "monster", {
    defId: def.id,
    moveSpeed: Math.trunc(def.moveSpeedFixed / 30),
    bodyRadius: def.radiusFixed,
    attackRange: def.attackRangeFixed,
    attackCooldownTicks: def.attackCooldownTicks,
    attackDamage: scaledDmg,
    attackType: def.attackDamage.type === "fire" ? 0 : 1,
    attackReadyTick: 0,
    state: "idle",
    rare: rare ? 1 : 0,
    summoned: 0,
  });
  world.set<DefensesC>(e, "defenses", {
    fireResPct: def.defenses.fireResPct,
    armour: def.defenses.armourFixed,
  });
  if (def.boss) {
    world.set<BossC>(e, "boss", {
      phase: 1,
      nextAbilityTick: 0,
      spawnX: x,
      spawnY: y,
      rootedUntilTick: 0,
    });
  }
  return e;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/simulation`
Expected: PASS. The hideout/legacy paths call `spawnMonster` without `scale` → default 1000 → unchanged, so existing tests and the boss golden stay green.

- [ ] **Step 5: Commit**

```bash
git add packages/simulation/src/areas.ts packages/simulation/src/areas.test.ts
git commit -m "feat(sim): scale map monster life and damage by area tier"
```

---

### Task 4: Protocol — activateMap intent + snapshot fields

**Files:**
- Modify: `packages/protocol/src/index.ts` (`Intent`, `CommandType` in sim, `Snapshot`, `validateIntent`)
- Modify: `packages/simulation/src/loop.ts` (add `"activateMap"` to the `Command` type if it enumerates types — see Step 3)
- Modify: `packages/simulation/src/protocol-bridge.ts` (`intentToCommand`, `buildSnapshot`)
- Test: `packages/protocol/src/protocol.test.ts` (validateIntent), `packages/simulation/src/protocol-bridge.test.ts` (snapshot fields)

**Interfaces:**
- Consumes: `SessionC` fields (Task 2).
- Produces:
  - `Intent` union gains `{ kind: "activateMap"; atlasNodeId: string; waystoneId: string }`.
  - `Snapshot` gains `areaTier: number`, `atlasSeed: number`, `completedNodes: string[]`.
  - A `Command` with `type: "activateMap"` and `data: { atlasNodeId, waystoneId }`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/protocol/src/protocol.test.ts — add
import { validateIntent } from "./index.js";

it("validates activateMap", () => {
  expect(validateIntent({ kind: "activateMap", atlasNodeId: "node.ashen_glade", waystoneId: "ws-0" }))
    .toEqual({ kind: "activateMap", atlasNodeId: "node.ashen_glade", waystoneId: "ws-0" });
});
it("rejects activateMap with empty ids", () => {
  expect(() => validateIntent({ kind: "activateMap", atlasNodeId: "", waystoneId: "ws-0" })).toThrow();
  expect(() => validateIntent({ kind: "activateMap", atlasNodeId: "n", waystoneId: 5 })).toThrow();
});
```

```ts
// packages/simulation/src/protocol-bridge.test.ts — add inside the
// "buildSnapshot — session fields and interactables" describe block. Uses the same
// makeMinimalWorld() the file already imports.
it("snapshot carries areaTier, atlasSeed, completedNodes from session", () => {
  const { world } = makeMinimalWorld();
  const sessionE = world.create();
  world.set<SessionC>(sessionE, "session", {
    area: "map", atlasSeed: 42, mapSeed: 7, areaTier: 3, activeNodeId: "node.emberfall",
    completedNodes: ["node.emberfall"], portalsLeft: 6, mapOpen: 1, pendingArea: "",
  });
  const snap = buildSnapshot(world, {} as never, 0, "test");
  expect(snap.areaTier).toBe(3);
  expect(snap.atlasSeed).toBe(42);
  expect(snap.completedNodes).toEqual(["node.emberfall"]);
});

it("defaults areaTier=0, atlasSeed=0, completedNodes=[] when no session (legacy sim)", () => {
  const { world } = makeMinimalWorld();
  const snap = buildSnapshot(world, {} as never, 0, "test");
  expect(snap.areaTier).toBe(0);
  expect(snap.atlasSeed).toBe(0);
  expect(snap.completedNodes).toEqual([]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/protocol packages/simulation/src/protocol-bridge.test.ts`
Expected: FAIL — activateMap not in the union; snapshot has no `areaTier`.

- [ ] **Step 3: Extend the protocol types**

In `packages/protocol/src/index.ts`, add to the `Intent` union (after the `interact` member):

```ts
  /** Activate the map device with a chosen node + waystone. Sim re-validates both. */
  | { kind: "activateMap"; atlasNodeId: string; waystoneId: string };
```

Add `"activateMap"` to `CommandType`:

```ts
export type CommandType = "moveTo" | "moveDir" | "useSkill" | "stop" | "interact" | "activateMap";
```

Add the three fields to `Snapshot` (after `mapOpen: boolean;`):

```ts
  /** Tier of the open map; 0 when no map is open. areaLevel = 64 + areaTier. */
  areaTier: number;
  /** Stable session seed the client uses to compute the Waystone offers. */
  atlasSeed: number;
  /** Atlas node ids already completed this session. */
  completedNodes: string[];
```

Add the `validateIntent` case (before the `default:`):

```ts
    case "activateMap": {
      if (typeof obj["atlasNodeId"] !== "string" || obj["atlasNodeId"].length === 0)
        throw new Error("validateIntent activateMap: atlasNodeId must be a non-empty string");
      if (typeof obj["waystoneId"] !== "string" || obj["waystoneId"].length === 0)
        throw new Error("validateIntent activateMap: waystoneId must be a non-empty string");
      return {
        kind: "activateMap",
        atlasNodeId: obj["atlasNodeId"] as string,
        waystoneId: obj["waystoneId"] as string,
      };
    }
```

> Note: if `packages/simulation/src/loop.ts` defines `Command["type"]` independently of protocol's `CommandType`, add `"activateMap"` there too. If it re-uses `CommandType`, no change needed. Verify with: `rg "type:.*moveTo|CommandType" packages/simulation/src/loop.ts`.

- [ ] **Step 4: Wire intentToCommand + buildSnapshot**

`packages/simulation/src/protocol-bridge.ts` — add to the `intentToCommand` switch (after the `interact` case):

```ts
    case "activateMap":
      return {
        tick, entity: player, type: "activateMap",
        data: { atlasNodeId: intent.atlasNodeId, waystoneId: intent.waystoneId },
      };
```

In `buildSnapshot`, add the three fields to the returned object (next to `mapOpen`):

```ts
    areaTier: session?.areaTier ?? 0,
    atlasSeed: session?.atlasSeed ?? 0,
    completedNodes: session?.completedNodes ?? [],
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run packages/protocol packages/simulation && npm run typecheck`
Expected: PASS + typecheck rc=0.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/index.ts packages/protocol/src/protocol.test.ts packages/simulation/src/protocol-bridge.ts packages/simulation/src/protocol-bridge.test.ts packages/simulation/src/loop.ts
git commit -m "feat(protocol): activateMap intent + areaTier/atlasSeed/completedNodes snapshot"
```

---

### Task 5: Sim activation handler (replace auto-open)

**Files:**
- Modify: `packages/simulation/src/systems/interact.ts`
- Test: `packages/simulation/src/systems/interact.test.ts`

**Interfaces:**
- Consumes: `activateMap` command (Task 4); `offerWaystones`, `atlasNodes`, `WAYSTONE_OFFER_COUNT` from `@pact/rules`; `MAP_PORTALS` from `@pact/protocol`.
- Produces: on a valid `activateMap`, sets `session { mapSeed, areaTier, activeNodeId, portalsLeft: MAP_PORTALS, mapOpen: 1 }` and spawns the portal ring. The `mapDevice` interact becomes a no-op.

**First, convert the two obsolete device tests.** In `interact.test.ts` the tests "in-range click on map device opens the map" (~line 39) and "clicking the device again while already open is a no-op" (~line 52) assert the *old* auto-open behaviour, which Task 5 removes. Delete both — their coverage moves to the new `activateMap` tests below. The "out-of-range" and both "portal click" tests stay as-is (still valid).

- [ ] **Step 1: Write the failing test**

The file's `makeWorld()` helper already builds a hideout session (its literal gains the four Task-2 fields, including `atlasSeed: 0`). Add an `activateMap` command helper and these tests:

```ts
// packages/simulation/src/systems/interact.test.ts — add imports at top
import { offerWaystones, WAYSTONE_OFFER_COUNT } from "@pact/rules";
import { MAP_PORTALS } from "@pact/protocol";

// helper alongside interactCmd
function activateCmd(player: number, atlasNodeId: string, waystoneId: string) {
  return { tick: 0, entity: player, type: "activateMap", data: { atlasNodeId, waystoneId } };
}

// makeWorld() builds session with atlasSeed: 0 (see Task 2), so offers derive from seed 0.
it("activateMap opens the chosen waystone's map: sets seed/tier/node, six portals", () => {
  const { sim, world, sessionE } = makeWorld();
  const player = world.query("player")[0]!;
  const ws = offerWaystones(0, WAYSTONE_OFFER_COUNT)[0]!;

  sim.step([activateCmd(player, "node.ashen_glade", ws.id)]);

  const session = world.get<SessionC>(sessionE, "session")!;
  expect(session.mapOpen).toBe(1);
  expect(session.mapSeed).toBe(ws.seed);
  expect(session.areaTier).toBe(ws.tier);
  expect(session.activeNodeId).toBe("node.ashen_glade");
  expect(session.portalsLeft).toBe(MAP_PORTALS);
  expect(world.query("interactable").filter((e) =>
    world.get<InteractableC>(e, "interactable")!.kind === "portal",
  )).toHaveLength(MAP_PORTALS);
});

it("activateMap is rejected for an unknown node", () => {
  const { sim, world, sessionE } = makeWorld();
  const player = world.query("player")[0]!;
  const ws = offerWaystones(0, WAYSTONE_OFFER_COUNT)[0]!;
  sim.step([activateCmd(player, "node.nope", ws.id)]);
  expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(0);
});

it("activateMap is rejected for a waystone not in the offers", () => {
  const { sim, world, sessionE } = makeWorld();
  const player = world.query("player")[0]!;
  sim.step([activateCmd(player, "node.ashen_glade", "ws-999")]);
  expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(0);
});

it("activateMap is a no-op when a map is already open", () => {
  const { sim, world, sessionE } = makeWorld();
  const player = world.query("player")[0]!;
  const ws = offerWaystones(0, WAYSTONE_OFFER_COUNT)[0]!;
  sim.step([activateCmd(player, "node.ashen_glade", ws.id)]); // open once
  const seedAfterFirst = world.get<SessionC>(sessionE, "session")!.mapSeed;
  const ws2 = offerWaystones(0, WAYSTONE_OFFER_COUNT)[1]!;
  sim.step([activateCmd(player, "node.emberfall", ws2.id)]); // ignored
  expect(world.get<SessionC>(sessionE, "session")!.mapSeed).toBe(seedAfterFirst);
});

it("activateMap is rejected for an already-completed node", () => {
  const { sim, world, sessionE } = makeWorld();
  const player = world.query("player")[0]!;
  const s = world.get<SessionC>(sessionE, "session")!;
  world.set<SessionC>(sessionE, "session", { ...s, completedNodes: ["node.ashen_glade"] });
  const ws = offerWaystones(0, WAYSTONE_OFFER_COUNT)[0]!;
  sim.step([activateCmd(player, "node.ashen_glade", ws.id)]);
  expect(world.get<SessionC>(sessionE, "session")!.mapOpen).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/simulation/src/systems/interact.test.ts`
Expected: FAIL — map does not open (handler not implemented).

- [ ] **Step 3: Implement the handler**

Replace `packages/simulation/src/systems/interact.ts` with:

```ts
import { MAP_PORTALS } from "@pact/protocol";
import { offerWaystones, atlasNodes, WAYSTONE_OFFER_COUNT } from "@pact/rules";
import { Simulation } from "../loop";
import type { Position, InteractableC, SessionC } from "../components";
import { spawnPortalRing } from "../areas";
import { inRangeOf } from "../protocol-bridge";

export function registerInteractSystem(sim: Simulation): void {
  sim.register("interact", (world, _tick, commands) => {
    // Require a session singleton; legacy sims without one are no-ops.
    const sessionEntities = world.query("session");
    if (sessionEntities.length === 0) return;
    const sessionE = sessionEntities[0]!;

    for (const cmd of commands) {
      // ── Map activation: pick a node + waystone from the preparation panel ──
      if (cmd.type === "activateMap") {
        const session = world.get<SessionC>(sessionE, "session")!;
        if (session.mapOpen !== 0) continue;      // already open
        if (session.area !== "hideout") continue; // only from the hideout device
        const atlasNodeId = cmd.data?.["atlasNodeId"] as string | undefined;
        const waystoneId = cmd.data?.["waystoneId"] as string | undefined;
        if (!atlasNodeId || !waystoneId) continue;
        if (!atlasNodes().some((n) => n.id === atlasNodeId)) continue;
        if (session.completedNodes.includes(atlasNodeId)) continue;
        const ws = offerWaystones(session.atlasSeed, WAYSTONE_OFFER_COUNT)
          .find((w) => w.id === waystoneId);
        if (!ws) continue;
        world.set<SessionC>(sessionE, "session", {
          ...session,
          mapSeed: ws.seed,
          areaTier: ws.tier,
          activeNodeId: atlasNodeId,
          portalsLeft: MAP_PORTALS,
          mapOpen: 1,
        });
        spawnPortalRing(world, MAP_PORTALS);
        continue;
      }

      if (cmd.type !== "interact" || cmd.entity === undefined) continue;

      const targetId = cmd.data?.["targetId"];
      if (targetId === undefined) continue;

      // Entity must be alive with interactable + position.
      if (!world.alive.has(targetId as number)) continue;
      if (!world.has(targetId as number, "interactable") || !world.has(targetId as number, "position")) continue;

      // Range re-check: the sim is authoritative (client is untrusted).
      const playerPos = world.get<Position>(cmd.entity, "position");
      if (!playerPos) continue;

      const ia = world.get<InteractableC>(targetId as number, "interactable")!;
      const pos = world.get<Position>(targetId as number, "position")!;
      if (!inRangeOf(playerPos.x, playerPos.y, pos.x, pos.y, ia.radius)) continue;

      const session = world.get<SessionC>(sessionE, "session")!;

      if (ia.kind === "mapDevice") {
        // The device no longer auto-opens; the client opens the preparation panel
        // and sends activateMap. Kept as a no-op so a stale device click does nothing.
        continue;
      } else if (ia.kind === "portal") {
        world.set<SessionC>(sessionE, "session", {
          ...session,
          pendingArea: session.area === "hideout" ? "map" : "hideout",
        });
      }
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/simulation/src/systems/interact.test.ts`
Expected: PASS (the two old device-open tests were deleted in this task's preamble; the five new `activateMap` tests and the surviving portal/out-of-range tests pass).

- [ ] **Step 5: Commit**

```bash
git add packages/simulation/src/systems/interact.ts packages/simulation/src/systems/interact.test.ts
git commit -m "feat(sim): activateMap handler opens chosen waystone, device no longer auto-opens"
```

---

### Task 6: Complete the Atlas node on boss death

**Files:**
- Modify: `packages/simulation/src/systems/death.ts`
- Test: `packages/simulation/src/systems/death.test.ts`

**Interfaces:**
- Consumes: `SessionC.activeNodeId`, `SessionC.completedNodes` (Task 2); the `boss` component.
- Produces: when a boss monster reaches ≤0 life in the map, `activeNodeId` is appended to `completedNodes` (once).

- [ ] **Step 1: Write the failing test**

```ts
// packages/simulation/src/systems/death.test.ts — add. Mirrors the file's existing
// session-aware setup, plus a dead boss monster.
function makeBossDeath(area: "hideout" | "map", activeNodeId: string, completedNodes: string[]) {
  const sim = new Simulation();
  registerDeath(sim);
  const { world } = sim;

  const sessionE = world.create();
  world.set<SessionC>(sessionE, "session", {
    area, atlasSeed: 0, mapSeed: 0, areaTier: 5, activeNodeId, completedNodes,
    portalsLeft: 6, mapOpen: 1, pendingArea: "",
  });

  const boss = world.create();
  world.set(boss, "monster", { defId: "boss", state: "idle", moveSpeed: 0, bodyRadius: 0,
    attackRange: 0, attackCooldownTicks: 0, attackDamage: 0, attackType: 1, attackReadyTick: 0, rare: 0, summoned: 0 });
  world.set(boss, "health", { life: 0, maxLife: fp(500) });
  world.set(boss, "boss", { phase: 1, nextAbilityTick: 0, spawnX: 0, spawnY: 0, rootedUntilTick: 0 });

  return { sim, world, sessionE, boss };
}

it("marks the active node completed when the map boss dies", () => {
  const { sim, world, sessionE } = makeBossDeath("map", "node.ashen_glade", []);
  sim.step();
  expect(world.get<SessionC>(sessionE, "session")!.completedNodes).toContain("node.ashen_glade");
});

it("does not double-add an already-completed node", () => {
  const { sim, world, sessionE } = makeBossDeath("map", "node.ashen_glade", ["node.ashen_glade"]);
  sim.step();
  expect(world.get<SessionC>(sessionE, "session")!.completedNodes).toEqual(["node.ashen_glade"]);
});

it("does not complete a node when a non-boss monster dies", () => {
  const { sim, world, sessionE } = makeBossDeath("map", "node.ashen_glade", []);
  world.remove(world.query("boss")[0]!, "boss"); // now an ordinary monster at 0 life
  sim.step();
  expect(world.get<SessionC>(sessionE, "session")!.completedNodes).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/simulation/src/systems/death.test.ts`
Expected: FAIL — completedNodes stays empty.

- [ ] **Step 3: Implement completion in the monster-death loop**

In `packages/simulation/src/systems/death.ts`, replace the monster loop at the top of the system with:

```ts
    for (const e of world.query("monster", "health")) {
      if ((world.get<Health>(e, "health")?.life ?? 1) > 0) continue;
      // A dying map boss completes the active Atlas node before it is destroyed.
      if (world.has(e, "boss")) {
        const sessionE = world.query("session")[0];
        if (sessionE !== undefined) {
          const s = world.get<SessionC>(sessionE, "session")!;
          if (s.area === "map" && s.activeNodeId !== "" && !s.completedNodes.includes(s.activeNodeId)) {
            world.set<SessionC>(sessionE, "session", {
              ...s,
              completedNodes: [...s.completedNodes, s.activeNodeId],
            });
          }
        }
      }
      world.destroy(e);
    }
```

(The rest of the death system — player revive + portal spend — is unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/simulation`
Expected: PASS (including the boss golden — its legacy sim has no session, so the `sessionE === undefined` guard skips completion).

- [ ] **Step 5: Commit**

```bash
git add packages/simulation/src/systems/death.ts packages/simulation/src/systems/death.test.ts
git commit -m "feat(sim): boss death completes the active atlas node"
```

---

### Task 7: Preparation Panel component

**Files:**
- Create: `apps/web/src/hud/PreparationPanel.tsx`
- Modify: `apps/web/package.json` (add `@pact/rules` dependency)
- Test: `apps/web/src/hud/PreparationPanel.test.tsx`

**Interfaces:**
- Consumes: `offerWaystones`, `atlasNodes`, `areaLevel`, `WAYSTONE_OFFER_COUNT` from `@pact/rules`; `MAP_PORTALS` from `@pact/protocol`.
- Produces: `PreparationPanel(props: { atlasSeed: number; completedNodes: string[]; onActivate: (atlasNodeId: string, waystoneId: string) => void; onClose: () => void })`.

- [ ] **Step 1: Add the workspace dependency**

```jsonc
// apps/web/package.json — add to "dependencies"
    "@pact/rules": "*",
```

Run: `npm install`
Expected: rc=0 (links the workspace package).

- [ ] **Step 2: Write the failing test**

```tsx
// apps/web/src/hud/PreparationPanel.test.tsx
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { offerWaystones, areaLevel, atlasNodes, WAYSTONE_OFFER_COUNT } from "@pact/rules";
import { PreparationPanel } from "./PreparationPanel.js";

describe("PreparationPanel", () => {
  const atlasSeed = 42;

  it("activates with the selected node and waystone, and shows its area level", () => {
    const onActivate = vi.fn();
    render(
      <PreparationPanel atlasSeed={atlasSeed} completedNodes={[]} onActivate={onActivate} onClose={() => {}} />,
    );
    const node = atlasNodes()[0]!;
    const ws = offerWaystones(atlasSeed, WAYSTONE_OFFER_COUNT)[0]!;

    fireEvent.click(screen.getByTestId(`prep-node-${node.id}`));
    fireEvent.click(screen.getByTestId(`prep-ws-${ws.id}`));

    expect(screen.getByTestId("prep-arealevel").textContent).toContain(String(areaLevel(ws.tier)));

    fireEvent.click(screen.getByTestId("prep-activate"));
    expect(onActivate).toHaveBeenCalledWith(node.id, ws.id);
  });

  it("disables activate until both a node and a waystone are chosen", () => {
    render(
      <PreparationPanel atlasSeed={atlasSeed} completedNodes={[]} onActivate={() => {}} onClose={() => {}} />,
    );
    expect((screen.getByTestId("prep-activate") as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables a completed node", () => {
    const done = atlasNodes()[0]!.id;
    render(
      <PreparationPanel atlasSeed={atlasSeed} completedNodes={[done]} onActivate={() => {}} onClose={() => {}} />,
    );
    expect((screen.getByTestId(`prep-node-${done}`) as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run apps/web/src/hud/PreparationPanel.test.tsx`
Expected: FAIL — cannot find `./PreparationPanel.js`.

- [ ] **Step 4: Implement the component**

```tsx
// apps/web/src/hud/PreparationPanel.tsx
import React, { useState } from "react";
import { offerWaystones, atlasNodes, areaLevel, WAYSTONE_OFFER_COUNT } from "@pact/rules";
import { MAP_PORTALS } from "@pact/protocol";

interface Props {
  atlasSeed: number;
  completedNodes: string[];
  onActivate: (atlasNodeId: string, waystoneId: string) => void;
  onClose: () => void;
}

const GOLD = "#9c7b3a";
const PANEL_BG = "#12151b";

export function PreparationPanel({ atlasSeed, completedNodes, onActivate, onClose }: Props) {
  const nodes = atlasNodes();
  const waystones = offerWaystones(atlasSeed, WAYSTONE_OFFER_COUNT);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [wsId, setWsId] = useState<string | null>(null);
  const ws = waystones.find((w) => w.id === wsId);
  const canActivate = nodeId !== null && ws !== undefined;

  return (
    <div
      data-testid="prep-panel"
      style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center",
        justifyContent: "center", background: "rgba(0,0,0,0.55)", pointerEvents: "auto",
        fontFamily: "system-ui, sans-serif", color: "#f4f0e6",
      }}
    >
      <div style={{ width: 520, background: PANEL_BG, border: `2px solid ${GOLD}`, borderRadius: 8, padding: 20, boxShadow: "0 8px 32px rgba(0,0,0,0.7)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ color: "#c9a84c", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Map Device</span>
          <button data-testid="prep-close" onClick={onClose} style={{ background: "none", border: "none", color: "#9aa0a8", cursor: "pointer", fontSize: 18 }}>×</button>
        </div>

        <div style={{ fontSize: 12, color: "#9aa0a8", marginBottom: 6 }}>Destination</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {nodes.map((n) => {
            const done = completedNodes.includes(n.id);
            const selected = n.id === nodeId;
            return (
              <button
                key={n.id}
                data-testid={`prep-node-${n.id}`}
                disabled={done}
                onClick={() => setNodeId(n.id)}
                style={{
                  padding: "8px 12px", borderRadius: 6, cursor: done ? "default" : "pointer",
                  background: selected ? "#2a3140" : "#1b1f27",
                  border: `2px solid ${selected ? GOLD : "#3a4048"}`,
                  color: done ? "#565c64" : "#f4f0e6", opacity: done ? 0.5 : 1,
                }}
              >
                {n.name}{done ? " ✓" : ""}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 12, color: "#9aa0a8", marginBottom: 6 }}>Waystone</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {waystones.map((w) => {
            const selected = w.id === wsId;
            return (
              <button
                key={w.id}
                data-testid={`prep-ws-${w.id}`}
                onClick={() => setWsId(w.id)}
                style={{
                  padding: "8px 12px", borderRadius: 6, cursor: "pointer",
                  background: selected ? "#2a3140" : "#1b1f27",
                  border: `2px solid ${selected ? GOLD : "#3a4048"}`, color: "#f4f0e6",
                }}
              >
                Tier {w.tier}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 16 }}>
          <span data-testid="prep-arealevel">Area Level: {ws ? areaLevel(ws.tier) : "—"}</span>
          <span data-testid="prep-revives">Portals: {MAP_PORTALS}</span>
        </div>

        <button
          data-testid="prep-activate"
          disabled={!canActivate}
          onClick={() => { if (canActivate && nodeId && ws) onActivate(nodeId, ws.id); }}
          style={{
            width: "100%", padding: "10px 0", borderRadius: 6, fontWeight: 700, letterSpacing: 1,
            cursor: canActivate ? "pointer" : "default",
            background: canActivate ? "linear-gradient(to bottom, #b8933f, #6d5220)" : "#2a2e36",
            border: `2px solid ${canActivate ? GOLD : "#3a4048"}`,
            color: canActivate ? "#12151b" : "#565c64", textTransform: "uppercase",
          }}
        >
          Activate
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/hud/PreparationPanel.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/src/hud/PreparationPanel.tsx apps/web/src/hud/PreparationPanel.test.tsx package-lock.json
git commit -m "feat(web): map-device preparation panel (nodes, waystones, area level)"
```

---

### Task 8: Wire the panel into the app

**Files:**
- Modify: `apps/web/src/input/bindings.ts` (`attachBindings` gains `onOpenPanel`)
- Modify: `apps/web/src/App.tsx` (worker ref, panel state, render panel, send `activateMap`)
- Test: `apps/web/src/input/bindings.test.ts` (onOpenPanel fires for a mapDevice in range)

**Interfaces:**
- Consumes: `Snapshot.atlasSeed`, `Snapshot.completedNodes`, `Snapshot.mapOpen` (Task 4); `PreparationPanel` (Task 7).
- Produces: `attachBindings(..., onOpenPanel?: () => void)`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/input/bindings.test.ts — add. Follow the file's existing pattern for
// a fake worker + scene + firing a pointerdown that picks a mapDevice mesh, then
// feeding an onSnapshot where that entity reports inRange:true.
it("opens the panel instead of interacting when a mapDevice is in range", () => {
  const onOpenPanel = vi.fn();
  // attachBindings(canvas, worker, scene, undefined, undefined, onOpenPanel)
  // Simulate: pointerdown picks device entity (id=7, kind mapDevice) → pendingInteractId=7
  // Feed onSnapshot({ ...snap, entities: [{ id:7, kind:"mapDevice", inRange:true, ... }] })
  // Expect: onOpenPanel called once; worker NOT posted an { kind:"interact" } intent.
});
```

> Mirror the existing bindings test that exercises `onSnapshot` + `pendingInteractId`. If that harness does not yet pick interactables, assert at the `onSnapshot` seam by pre-seeding `pendingInteractId` via a pointerdown on a stubbed pick that returns a mesh named `entity-7` with `metadata.interactKind`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/input/bindings.test.ts`
Expected: FAIL — `onOpenPanel` param does not exist.

- [ ] **Step 3: Add onOpenPanel to bindings**

In `apps/web/src/input/bindings.ts`, add the param to the signature:

```ts
export function attachBindings(
  canvas: HTMLCanvasElement,
  worker: Worker,
  scene: Scene,
  onCycleOutfit?: () => void,
  onHoverInteractable?: (entityId: number | null) => void,
  onOpenPanel?: () => void,
): { detach: () => void; onSnapshot: (snap: Snapshot) => void } {
```

Replace the in-range branch inside `onSnapshot` (the `else if (entity.inRange)` block) with:

```ts
      } else if (entity.inRange) {
        if (entity.kind === "mapDevice") {
          // The device opens the preparation panel; activation is a separate intent.
          onOpenPanel?.();
        } else {
          post({ kind: "interact", targetId: pendingInteractId });
        }
        // Halt at interaction range so the player stops at the device/portal.
        post({ kind: "stop" });
        pendingInteractId = null;
      }
```

- [ ] **Step 4: Run the bindings test to verify it passes**

Run: `npx vitest run apps/web/src/input/bindings.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire App.tsx**

Add the import:

```tsx
import { PreparationPanel } from "./hud/PreparationPanel";
```

Inside `App`, add a worker ref and panel state alongside the existing state:

```tsx
  const workerRef = useRef<Worker | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
```

In the effect, store the worker and pass `onOpenPanel`:

```tsx
    const worker = new Worker(
      new URL("./worker/sim-worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    worker.postMessage({ type: "init", seed: LAB_SEED });
```

```tsx
    const { detach, onSnapshot } = attachBindings(
      canvas,
      worker,
      scene,
      () => renderer.cyclePlayerOutfit(),
      (id) => {
        renderer.setHoveredEntity(id);
        setHoveredEntityId(id);
      },
      () => setPanelOpen(true),
    );
```

Close the panel automatically once the map opens (the snapshot handler already runs per tick):

```tsx
      if (msg.type === "snapshot") {
        prevSnap = curSnap;
        curSnap = msg.snapshot;
        prevTickTime = performance.now();
        setSnapshot(msg.snapshot);
        if (msg.snapshot.mapOpen) setPanelOpen(false);
        onSnapshot(msg.snapshot);
      } else if (msg.type === "area") {
```

In the effect cleanup, clear the ref:

```tsx
    return () => {
      unmounted = true;
      detach();
      resetPlayerRig();
      engine.dispose();
      worker.terminate();
      workerRef.current = null;
    };
```

Render the panel below the HUD:

```tsx
      <Hud snapshot={snapshot} hoveredEntityId={hoveredEntityId} />
      {panelOpen && snapshot && (
        <PreparationPanel
          atlasSeed={snapshot.atlasSeed}
          completedNodes={snapshot.completedNodes}
          onClose={() => setPanelOpen(false)}
          onActivate={(atlasNodeId, waystoneId) => {
            workerRef.current?.postMessage({
              type: "intent",
              intent: { kind: "activateMap", atlasNodeId, waystoneId },
            });
            setPanelOpen(false);
          }}
        />
      )}
```

- [ ] **Step 6: Run the web suite + typecheck + build**

Run: `npx vitest run apps/web && npm run typecheck && npm run build -w apps/web`
Expected: PASS; typecheck rc=0; build rc=0 (pre-existing Babylon chunk-size warning only).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/input/bindings.ts apps/web/src/input/bindings.test.ts apps/web/src/App.tsx
git commit -m "feat(web): open preparation panel from the device, send activateMap"
```

---

### Task 9: Full-suite verification + devlog screenshot

**Files:** none (verification only).

- [ ] **Step 1: Run the entire suite green**

Run: `npm run typecheck && npx vitest run && npm run build -w apps/web`
Expected: typecheck rc=0; all vitest files pass (prior baseline 391 tests / 46 files, now higher); build rc=0.

- [ ] **Step 2: Manual run + screenshot for the devlog**

Use the `run` skill (or `npm run dev -w apps/web`) to launch the app. Walk to the Map Device, confirm the panel opens, pick a node + a Tier-N waystone, Activate, enter a portal, and confirm monsters feel tougher at higher tiers. Screenshot the panel and the map into `devlog/` per the devlog-screenshots memory ("Day N" series). Kill any stray vite servers (5173→5177) when done.

- [ ] **Step 3: Commit the devlog assets (if any were added)**

```bash
git add devlog
git commit -m "docs(devlog): waystone preparation panel + tier scaling"
```

---

## Known simplifications (flagged, not bugs)

- **Node completion is in-memory** — reload resets `completedNodes`. Whole session is in-memory this slice.
- **No device-range recheck on activateMap** — the handler only requires `area === "hideout"` + `mapOpen === 0`; the panel is client-gated by proximity. A stricter re-check against the device entity's position is a later hardening.
- **All nodes identical + finite** — once every node is completed the panel offers no accessible destination (no reset). Acceptable end-state for the slice; node re-run / more nodes is future work.
- **Scaling constants are placeholders** — `monsterTierScale` centralizes the two knobs; expect calibration once loot/reward pressure exists (docs/01:780).
