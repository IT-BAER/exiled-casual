# Milestone 1: Deterministic Kernel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic simulation foundation — a fixed-point math lib, seeded RNG streams, an ECS, a canonical world checksum, a fixed-step loop with a command model, and a replay runner — proven by a headless scenario that reproduces an identical checksum across repeated runs and replays.

**Architecture:** A TypeScript monorepo (npm workspaces) of pure, framework-free packages. `@exiled/fixed-point` provides scaled-integer math. `@exiled/simulation` holds the ECS, RNG, checksum, and fixed-step loop. `@exiled/replay` records command logs and re-runs scenarios to prove determinism. No rendering, no Babylon, no network, no persistence in this milestone — everything is headless and exercised by Vitest.

**Tech Stack:** TypeScript (strict, ESM), npm workspaces, Vitest, Node 20+. Cross-package imports resolve through workspace symlinks and each package's `exports` pointing at `./src/index.ts` (Vitest/Vite transpiles TS directly — no build step).

## Global Constraints

Every task's requirements implicitly include these (from `docs/specs/2026-07-19-first-descent-design.md` §3 and §2):

- Authoritative numeric values (spatial, time, resource, percent) are **fixed-point scaled integers**. IEEE floats are forbidden in simulation code; allowed only in rendering (not present this milestone).
- **One documented system order per tick.** Execution order equals system registration order and is queryable.
- Every random outcome comes from a **named deterministic RNG stream** with a recorded draw ordinal. Never use `Math.random`, `Date`, `performance.now`, or unseeded state in simulation code.
- World serialization is **canonical** (sorted component names, sorted entity ids, sorted keys) and hashes to a rolling checksum. A scenario replays from `{ seed, contentVersion, commandLog }` to an identical checksum sequence.
- No reliance on object-property or `Map`/`Set` insertion order in authoritative code — always sort before iterating for output.
- Node floor: **20+**. Language: **TypeScript strict**, module type **ESM** (`"type": "module"`).
- Clean-room: original identifiers only; no PoE asset, data, or protocol references in code.

---

### Task 1: Monorepo scaffold and toolchain

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.github/workflows/ci.yml`
- Create: `packages/.gitkeep`
- Test: `smoke.test.ts` (temporary, deleted in Step 6)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: working `npm run typecheck` and `npm test` commands; the `packages/*` workspace layout; `tsconfig.base.json` for packages to extend.

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "exiled-casual",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
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

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 3: Create root `tsconfig.json`, `vitest.config.ts`, CI workflow, and workspace dir**

`tsconfig.json`:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["packages/*/src", "*.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "*.test.ts"],
    environment: "node",
  },
});
```

`.github/workflows/ci.yml`:

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
```

Create an empty `packages/.gitkeep` file so the workspace directory exists.

- [ ] **Step 4: Write a temporary smoke test**

`smoke.test.ts` (repo root):

```ts
import { expect, test } from "vitest";

test("toolchain runs", () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 5: Install and verify the toolchain**

Run: `npm install`
Then run: `npm run typecheck`
Expected: no output, exit code 0.
Then run: `npm test`
Expected: Vitest reports `1 passed` for `smoke.test.ts`.

- [ ] **Step 6: Delete the smoke test and commit**

Delete `smoke.test.ts`, then:

```bash
git add -A
git commit -m "chore: monorepo scaffold, typescript, vitest, ci"
```

Note: commit the generated `package-lock.json` — CI's `npm ci` requires it.

---

### Task 2: Fixed-point math library

**Files:**
- Create: `packages/fixed-point/package.json`
- Create: `packages/fixed-point/tsconfig.json`
- Create: `packages/fixed-point/src/index.ts`
- Test: `packages/fixed-point/src/fixed-point.test.ts`

**Interfaces:**
- Consumes: nothing from other packages.
- Produces (all exported from `@exiled/fixed-point`):
  - `FP_SCALE: number` (= 1000)
  - `type Fixed = number` (an integer equal to real × FP_SCALE)
  - `fp(n: number): Fixed`
  - `toNumber(a: Fixed): number` (rendering only)
  - `fpAdd(a: Fixed, b: Fixed): Fixed`
  - `fpSub(a: Fixed, b: Fixed): Fixed`
  - `fpMul(a: Fixed, b: Fixed): Fixed`
  - `fpDiv(a: Fixed, b: Fixed): Fixed`
  - `fpClamp(v: Fixed, lo: Fixed, hi: Fixed): Fixed`
  - `fpAbs(a: Fixed): Fixed`
  - `fpSign(a: Fixed): -1 | 0 | 1`

- [ ] **Step 1: Create the package manifest and tsconfig**

`packages/fixed-point/package.json`:

```json
{
  "name": "@exiled/fixed-point",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

`packages/fixed-point/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 2: Write the failing test**

`packages/fixed-point/src/fixed-point.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  FP_SCALE, fp, toNumber, fpAdd, fpSub, fpMul, fpDiv, fpClamp, fpAbs, fpSign,
} from "./index";

describe("fixed-point", () => {
  test("fp scales to integers and toNumber inverts", () => {
    expect(fp(1.5)).toBe(1500);
    expect(FP_SCALE).toBe(1000);
    expect(Number.isInteger(fp(3.14159))).toBe(true);
    expect(toNumber(fp(2.5))).toBe(2.5);
  });

  test("add/sub are exact", () => {
    expect(fpAdd(fp(2), fp(3))).toBe(fp(5));
    expect(fpSub(fp(3), fp(5))).toBe(fp(-2));
  });

  test("mul/div stay integer and round toward zero", () => {
    expect(fpMul(fp(2), fp(3))).toBe(fp(6));
    expect(fpDiv(fp(6), fp(2))).toBe(fp(3));
    expect(Number.isInteger(fpMul(fp(1.234), fp(5.678)))).toBe(true);
    expect(fpMul(fp(-0.001), fp(1.5))).toBe(-1); // trunc toward zero, not floor's -2
  });

  test("clamp, abs, sign", () => {
    expect(fpClamp(fp(5), fp(0), fp(3))).toBe(fp(3));
    expect(fpClamp(fp(-1), fp(0), fp(3))).toBe(fp(0));
    expect(fpAbs(fp(-4))).toBe(fp(4));
    expect(fpSign(fp(-4))).toBe(-1);
    expect(fpSign(fp(0))).toBe(0);
    expect(fpSign(fp(4))).toBe(1);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- packages/fixed-point`
Expected: FAIL — cannot resolve `./index` (module not created yet).

- [ ] **Step 4: Write the implementation**

`packages/fixed-point/src/index.ts`:

```ts
// Fixed-point scaled-integer math for deterministic simulation.
// A Fixed value is an integer equal to (real * FP_SCALE).
// ponytail: FP_SCALE=1000 gives 3 decimal places; product magnitude must stay
// under 2^53, so keep any single operand's real value under ~9e6. Widen SCALE
// or move hot math to BigInt only if a real range demands it.
export const FP_SCALE = 1000;

export type Fixed = number;

export const fp = (n: number): Fixed => Math.round(n * FP_SCALE);
export const toNumber = (a: Fixed): number => a / FP_SCALE;

export const fpAdd = (a: Fixed, b: Fixed): Fixed => a + b;
export const fpSub = (a: Fixed, b: Fixed): Fixed => a - b;
export const fpMul = (a: Fixed, b: Fixed): Fixed => Math.trunc((a * b) / FP_SCALE);
export const fpDiv = (a: Fixed, b: Fixed): Fixed => Math.trunc((a * FP_SCALE) / b);

export const fpClamp = (v: Fixed, lo: Fixed, hi: Fixed): Fixed =>
  v < lo ? lo : v > hi ? hi : v;

export const fpAbs = (a: Fixed): Fixed => (a < 0 ? -a : a);

export const fpSign = (a: Fixed): -1 | 0 | 1 => (a < 0 ? -1 : a > 0 ? 1 : 0);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- packages/fixed-point`
Expected: PASS — all four tests green.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck` (expect exit 0), then:

```bash
git add packages/fixed-point
git commit -m "feat(fixed-point): scaled-integer math library"
```

---

### Task 3: Deterministic named RNG streams

**Files:**
- Create: `packages/simulation/package.json`
- Create: `packages/simulation/tsconfig.json`
- Create: `packages/simulation/src/rng.ts`
- Create: `packages/simulation/src/index.ts`
- Test: `packages/simulation/src/rng.test.ts`

**Interfaces:**
- Consumes: nothing from other packages yet.
- Produces (exported from `@exiled/simulation`):
  - `interface RandomStream { nextU32(): number; nextInt(minInclusive: number, maxInclusive: number): number; ordinal(): number; }`
  - `createStream(masterSeed: number, name: string): RandomStream`
  - `fnv1a32(input: string): number` (also reused by the checksum task)

- [ ] **Step 1: Create the package manifest and tsconfig**

`packages/simulation/package.json`:

```json
{
  "name": "@exiled/simulation",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@exiled/fixed-point": "*"
  }
}
```

`packages/simulation/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

Then run `npm install` so the new workspace dependency is symlinked.

- [ ] **Step 2: Write the failing test**

`packages/simulation/src/rng.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { createStream, fnv1a32 } from "./index";

describe("rng", () => {
  test("same seed and name produce the same sequence", () => {
    const a = createStream(12345, "loot");
    const b = createStream(12345, "loot");
    const seqA = [a.nextU32(), a.nextU32(), a.nextU32()];
    const seqB = [b.nextU32(), b.nextU32(), b.nextU32()];
    expect(seqA).toEqual(seqB);
  });

  test("different stream names diverge", () => {
    const loot = createStream(12345, "loot");
    const move = createStream(12345, "movement");
    expect(loot.nextU32()).not.toBe(move.nextU32());
  });

  test("ordinal counts draws", () => {
    const s = createStream(1, "x");
    expect(s.ordinal()).toBe(0);
    s.nextU32();
    s.nextInt(0, 10);
    expect(s.ordinal()).toBe(2);
  });

  test("nextInt stays within inclusive bounds", () => {
    const s = createStream(7, "y");
    for (let i = 0; i < 1000; i++) {
      const v = s.nextInt(3, 6);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  test("fnv1a32 is stable and unsigned", () => {
    expect(fnv1a32("loot")).toBe(fnv1a32("loot"));
    expect(fnv1a32("loot")).toBeGreaterThanOrEqual(0);
    expect(fnv1a32("loot")).not.toBe(fnv1a32("movement"));
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- packages/simulation/src/rng`
Expected: FAIL — `./index` does not export `createStream`/`fnv1a32`.

- [ ] **Step 4: Write the implementation**

`packages/simulation/src/rng.ts`:

```ts
// Deterministic, integer-only PRNG (Mulberry32) with named streams.
// Named streams derive independent state from a master seed so loot, movement,
// AI, etc. never share a sequence. Draw count (ordinal) is recorded for audit.

export function fnv1a32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export interface RandomStream {
  nextU32(): number;
  nextInt(minInclusive: number, maxInclusive: number): number;
  ordinal(): number;
}

export function createStream(masterSeed: number, name: string): RandomStream {
  let state = (masterSeed ^ fnv1a32(name)) >>> 0;
  let count = 0;

  const nextU32 = (): number => {
    count++;
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };

  // ponytail: modulo introduces negligible bias for small ranges; replace with
  // rejection sampling only if a fairness-sensitive system needs it.
  const nextInt = (minInclusive: number, maxInclusive: number): number => {
    const span = maxInclusive - minInclusive + 1;
    return minInclusive + (nextU32() % span);
  };

  return { nextU32, nextInt, ordinal: () => count };
}
```

`packages/simulation/src/index.ts`:

```ts
export { createStream, fnv1a32 } from "./rng";
export type { RandomStream } from "./rng";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- packages/simulation/src/rng`
Expected: PASS — all five tests green.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck` (expect exit 0), then:

```bash
git add packages/simulation package-lock.json
git commit -m "feat(simulation): deterministic named rng streams"
```

---

### Task 4: ECS core

**Files:**
- Create: `packages/simulation/src/ecs.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/src/ecs.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (exported from `@exiled/simulation`):
  - `type Entity = number`
  - `class World` with:
    - `create(): Entity`
    - `destroy(e: Entity): void`
    - `set<T extends Record<string, unknown>>(e: Entity, comp: string, data: T): void`
    - `get<T>(e: Entity, comp: string): T | undefined`
    - `has(e: Entity, comp: string): boolean`
    - `remove(e: Entity, comp: string): void`
    - `query(...comps: string[]): Entity[]` (ascending entity id)
    - `componentNames(): string[]` (sorted)
    - `entitiesWith(comp: string): Entity[]` (ascending entity id)

- [ ] **Step 1: Write the failing test**

`packages/simulation/src/ecs.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { World } from "./index";

describe("ecs World", () => {
  test("create assigns unique ids and tracks liveness", () => {
    const w = new World();
    const a = w.create();
    const b = w.create();
    expect(a).not.toBe(b);
    w.destroy(a);
    expect(w.has(a, "anything")).toBe(false);
  });

  test("set/get/has/remove components", () => {
    const w = new World();
    const e = w.create();
    w.set(e, "position", { x: 1, y: 2 });
    expect(w.get<{ x: number; y: number }>(e, "position")).toEqual({ x: 1, y: 2 });
    expect(w.has(e, "position")).toBe(true);
    w.remove(e, "position");
    expect(w.has(e, "position")).toBe(false);
  });

  test("query returns entities with all components in ascending id order", () => {
    const w = new World();
    const e1 = w.create();
    const e2 = w.create();
    const e3 = w.create();
    w.set(e1, "position", { x: 0, y: 0 });
    w.set(e1, "motion", { vx: 0, vy: 0 });
    w.set(e2, "position", { x: 0, y: 0 });
    w.set(e3, "position", { x: 0, y: 0 });
    w.set(e3, "motion", { vx: 0, vy: 0 });
    expect(w.query("position", "motion")).toEqual([e1, e3]);
  });

  test("destroy clears the entity from every store", () => {
    const w = new World();
    const e = w.create();
    w.set(e, "position", { x: 0, y: 0 });
    w.destroy(e);
    expect(w.entitiesWith("position")).toEqual([]);
  });

  test("componentNames is sorted", () => {
    const w = new World();
    const e = w.create();
    w.set(e, "zeta", { a: 1 });
    w.set(e, "alpha", { a: 1 });
    expect(w.componentNames()).toEqual(["alpha", "zeta"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- packages/simulation/src/ecs`
Expected: FAIL — `World` is not exported.

- [ ] **Step 3: Write the implementation**

`packages/simulation/src/ecs.ts`:

```ts
// Minimal ECS. Component data are plain flat records. All iteration used for
// output (query, componentNames, entitiesWith) is sorted for determinism.
// ponytail: Map-of-Maps storage, not structure-of-arrays. Swap to SoA only when
// a profiler shows a hot component loop is the bottleneck.

export type Entity = number;

export class World {
  private next = 1;
  readonly alive = new Set<Entity>();
  private readonly stores = new Map<string, Map<Entity, unknown>>();

  create(): Entity {
    const e = this.next++;
    this.alive.add(e);
    return e;
  }

  destroy(e: Entity): void {
    this.alive.delete(e);
    for (const store of this.stores.values()) store.delete(e);
  }

  set<T extends Record<string, unknown>>(e: Entity, comp: string, data: T): void {
    let store = this.stores.get(comp);
    if (!store) {
      store = new Map<Entity, unknown>();
      this.stores.set(comp, store);
    }
    store.set(e, data);
  }

  get<T>(e: Entity, comp: string): T | undefined {
    return this.stores.get(comp)?.get(e) as T | undefined;
  }

  has(e: Entity, comp: string): boolean {
    return this.stores.get(comp)?.has(e) ?? false;
  }

  remove(e: Entity, comp: string): void {
    this.stores.get(comp)?.delete(e);
  }

  query(...comps: string[]): Entity[] {
    const result: Entity[] = [];
    for (const e of this.alive) {
      if (comps.every((c) => this.has(e, c))) result.push(e);
    }
    return result.sort((a, b) => a - b);
  }

  componentNames(): string[] {
    return [...this.stores.keys()].sort();
  }

  entitiesWith(comp: string): Entity[] {
    const store = this.stores.get(comp);
    return store ? [...store.keys()].sort((a, b) => a - b) : [];
  }
}
```

Append to `packages/simulation/src/index.ts`:

```ts
export { World } from "./ecs";
export type { Entity } from "./ecs";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- packages/simulation/src/ecs`
Expected: PASS — all five tests green.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` (expect exit 0), then:

```bash
git add packages/simulation
git commit -m "feat(simulation): deterministic ecs world"
```

---

### Task 5: Canonical serialization and rolling checksum

**Files:**
- Create: `packages/simulation/src/checksum.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/src/checksum.test.ts`

**Interfaces:**
- Consumes: `World` (Task 4), `fnv1a32` (Task 3).
- Produces (exported from `@exiled/simulation`):
  - `serializeWorld(world: World): string` (canonical)
  - `checksumWorld(world: World): number` (uint32)

- [ ] **Step 1: Write the failing test**

`packages/simulation/src/checksum.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { World, serializeWorld, checksumWorld } from "./index";

describe("checksum", () => {
  test("serialization is canonical regardless of insertion order", () => {
    const a = new World();
    const e1 = a.create();
    const e2 = a.create();
    a.set(e1, "position", { y: 2, x: 1 });
    a.set(e2, "position", { x: 3, y: 4 });

    const b = new World();
    const f1 = b.create();
    const f2 = b.create();
    b.set(f2, "position", { x: 3, y: 4 });
    b.set(f1, "position", { x: 1, y: 2 });

    expect(serializeWorld(a)).toBe(serializeWorld(b));
    expect(checksumWorld(a)).toBe(checksumWorld(b));
  });

  test("different state produces a different checksum", () => {
    const a = new World();
    const e = a.create();
    a.set(e, "position", { x: 1, y: 2 });

    const b = new World();
    const f = b.create();
    b.set(f, "position", { x: 1, y: 3 });

    expect(checksumWorld(a)).not.toBe(checksumWorld(b));
  });

  test("checksum is an unsigned 32-bit integer", () => {
    const w = new World();
    const e = w.create();
    w.set(e, "position", { x: 1, y: 2 });
    const c = checksumWorld(w);
    expect(Number.isInteger(c)).toBe(true);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(0xffffffff);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- packages/simulation/src/checksum`
Expected: FAIL — `serializeWorld`/`checksumWorld` not exported.

- [ ] **Step 3: Write the implementation**

`packages/simulation/src/checksum.ts`:

```ts
import { World } from "./ecs";
import { fnv1a32 } from "./rng";

// Canonical serialization: component names sorted, entities ascending, keys
// sorted. Component data must be flat records of number | string | boolean.
function stableValue(v: unknown): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`non-finite value in world state: ${v}`);
    return `n:${v}`;
  }
  if (typeof v === "boolean") return `b:${v ? 1 : 0}`;
  if (typeof v === "string") return `s:${v}`;
  throw new Error(`unsupported component value type: ${typeof v}`);
}

export function serializeWorld(world: World): string {
  const parts: string[] = [];
  for (const comp of world.componentNames()) {
    parts.push(`#${comp}`);
    for (const e of world.entitiesWith(comp)) {
      const data = world.get<Record<string, unknown>>(e, comp);
      if (!data) continue;
      parts.push(`@${e}`);
      for (const key of Object.keys(data).sort()) {
        parts.push(`${key}=${stableValue(data[key])}`);
      }
    }
  }
  return parts.join("|");
}

export function checksumWorld(world: World): number {
  return fnv1a32(serializeWorld(world));
}
```

Append to `packages/simulation/src/index.ts`:

```ts
export { serializeWorld, checksumWorld } from "./checksum";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- packages/simulation/src/checksum`
Expected: PASS — all three tests green.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` (expect exit 0), then:

```bash
git add packages/simulation
git commit -m "feat(simulation): canonical world serialization and checksum"
```

---

### Task 6: Fixed-step loop and command model

**Files:**
- Create: `packages/simulation/src/loop.ts`
- Modify: `packages/simulation/src/index.ts`
- Test: `packages/simulation/src/loop.test.ts`

**Interfaces:**
- Consumes: `World` (Task 4).
- Produces (exported from `@exiled/simulation`):
  - `interface Command { tick: number; entity?: Entity; type: string; data?: Record<string, number>; }`
  - `type System = (world: World, tick: number, commands: readonly Command[]) => void`
  - `class Simulation` with: `readonly world: World`, `tick: number`, `register(name: string, fn: System): void`, `systemOrder(): string[]`, `step(commands?: readonly Command[]): void`

- [ ] **Step 1: Write the failing test**

`packages/simulation/src/loop.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { Simulation, type Command } from "./index";

describe("Simulation loop", () => {
  test("systems run in registration order every tick", () => {
    const sim = new Simulation();
    const log: string[] = [];
    sim.register("first", () => log.push("first"));
    sim.register("second", () => log.push("second"));
    sim.step();
    expect(log).toEqual(["first", "second"]);
    expect(sim.systemOrder()).toEqual(["first", "second"]);
  });

  test("tick increments after each step", () => {
    const sim = new Simulation();
    expect(sim.tick).toBe(0);
    sim.step();
    sim.step();
    expect(sim.tick).toBe(2);
  });

  test("commands are passed to systems for the current step", () => {
    const sim = new Simulation();
    const seen: Command[][] = [];
    sim.register("recorder", (_w, _t, cmds) => seen.push([...cmds]));
    const cmd: Command = { tick: 0, type: "impulse", data: { dvx: 5 } };
    sim.step([cmd]);
    expect(seen[0]).toEqual([cmd]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- packages/simulation/src/loop`
Expected: FAIL — `Simulation` not exported.

- [ ] **Step 3: Write the implementation**

`packages/simulation/src/loop.ts`:

```ts
import { World, type Entity } from "./ecs";

export interface Command {
  tick: number;
  entity?: Entity;
  type: string;
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
  private readonly systems: { name: string; fn: System }[] = [];

  register(name: string, fn: System): void {
    this.systems.push({ name, fn });
  }

  systemOrder(): string[] {
    return this.systems.map((s) => s.name);
  }

  step(commands: readonly Command[] = []): void {
    for (const s of this.systems) s.fn(this.world, this.tick, commands);
    this.tick++;
  }
}
```

Append to `packages/simulation/src/index.ts`:

```ts
export { Simulation } from "./loop";
export type { Command, System } from "./loop";
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- packages/simulation/src/loop`
Expected: PASS — all three tests green.

- [ ] **Step 5: Typecheck and commit**

Run: `npm run typecheck` (expect exit 0), then:

```bash
git add packages/simulation
git commit -m "feat(simulation): fixed-step loop and command model"
```

---

### Task 7: Replay runner and first-difference tool

**Files:**
- Create: `packages/replay/package.json`
- Create: `packages/replay/tsconfig.json`
- Create: `packages/replay/src/index.ts`
- Test: `packages/replay/src/replay.test.ts`

**Interfaces:**
- Consumes: `Simulation`, `Command`, `checksumWorld` (from `@exiled/simulation`).
- Produces (exported from `@exiled/replay`):
  - `interface Scenario { seed: number; contentVersion: string; ticks: number; commandsByTick: Command[][]; build: (sim: Simulation, seed: number) => void; }`
  - `interface ReplayResult { checksums: number[]; final: number; systemOrder: string[]; world: World; }`
  - `runScenario(scenario: Scenario): ReplayResult`
  - `firstDifference(a: readonly number[], b: readonly number[]): number | null`

- [ ] **Step 1: Create the package manifest and tsconfig**

`packages/replay/package.json`:

```json
{
  "name": "@exiled/replay",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@exiled/fixed-point": "*",
    "@exiled/simulation": "*"
  }
}
```

`packages/replay/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

Then run `npm install` so `@exiled/simulation` is symlinked into `@exiled/replay`.

- [ ] **Step 2: Write the failing test**

`packages/replay/src/replay.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { fpAdd } from "@exiled/fixed-point";
import type { Simulation } from "@exiled/simulation";
import { runScenario, firstDifference, type Scenario } from "./index";

// A trivial scenario: one entity whose counter increments by 1 (fixed-point)
// each tick via a system.
function makeScenario(): Scenario {
  return {
    seed: 42,
    contentVersion: "test.v1",
    ticks: 5,
    commandsByTick: [],
    build: (sim: Simulation) => {
      const e = sim.world.create();
      sim.world.set(e, "counter", { n: 0 });
      sim.register("increment", (world) => {
        for (const id of world.query("counter")) {
          const c = world.get<{ n: number }>(id, "counter")!;
          world.set(id, "counter", { n: fpAdd(c.n, 1000) });
        }
      });
    },
  };
}

describe("replay", () => {
  test("same scenario reproduces the same checksum sequence", () => {
    const a = runScenario(makeScenario());
    const b = runScenario(makeScenario());
    expect(a.checksums).toEqual(b.checksums);
    expect(a.checksums.length).toBe(5);
    expect(firstDifference(a.checksums, b.checksums)).toBeNull();
  });

  test("systemOrder is reported", () => {
    const r = runScenario(makeScenario());
    expect(r.systemOrder).toEqual(["increment"]);
  });

  test("firstDifference finds the first divergent index", () => {
    expect(firstDifference([1, 2, 3], [1, 9, 3])).toBe(1);
    expect(firstDifference([1, 2], [1, 2, 3])).toBe(2);
    expect(firstDifference([1, 2, 3], [1, 2, 3])).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- packages/replay`
Expected: FAIL — `./index` does not export `runScenario`.

- [ ] **Step 4: Write the implementation**

`packages/replay/src/index.ts`:

```ts
import { Simulation, checksumWorld, type Command, type World } from "@exiled/simulation";

export interface Scenario {
  seed: number;
  contentVersion: string;
  ticks: number;
  commandsByTick: Command[][];
  build: (sim: Simulation, seed: number) => void;
}

export interface ReplayResult {
  checksums: number[];
  final: number;
  systemOrder: string[];
  world: World;
}

export function runScenario(scenario: Scenario): ReplayResult {
  const sim = new Simulation();
  scenario.build(sim, scenario.seed);
  const checksums: number[] = [];
  for (let t = 0; t < scenario.ticks; t++) {
    sim.step(scenario.commandsByTick[t] ?? []);
    checksums.push(checksumWorld(sim.world));
  }
  return {
    checksums,
    final: checksums.length > 0 ? checksums[checksums.length - 1]! : 0,
    systemOrder: sim.systemOrder(),
    world: sim.world,
  };
}

export function firstDifference(
  a: readonly number[],
  b: readonly number[],
): number | null {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- packages/replay`
Expected: PASS — all three tests green.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run typecheck` (expect exit 0), then:

```bash
git add packages/replay package-lock.json
git commit -m "feat(replay): scenario runner and first-difference tool"
```

---

### Task 8: Headless determinism proof (milestone gate)

**Files:**
- Create: `packages/simulation/src/movement.ts`
- Modify: `packages/simulation/src/index.ts`
- Create: `packages/replay/src/scenarios/wander.ts`
- Test: `packages/replay/src/scenarios/wander.test.ts`

**Interfaces:**
- Consumes: `Simulation`, `World`, `createStream`, `Command` (`@exiled/simulation`); fixed-point math (`@exiled/fixed-point`); `runScenario`, `firstDifference` (`@exiled/replay`).
- Produces (exported from `@exiled/simulation`):
  - `WORLD_MIN: Fixed`, `WORLD_MAX: Fixed` (arena bounds)
  - `registerMovement(sim: Simulation, seed: number): void` — registers a movement system that: applies `impulse` commands (`data.dvx`, `data.dvy`) to each entity's `motion`, adds a per-entity RNG wander via a named stream, integrates `motion` into `position`, and clamps `position` to `[WORLD_MIN, WORLD_MAX]`.
  - Component shapes: `position` = `{ x: Fixed; y: Fixed }`, `motion` = `{ vx: Fixed; vy: Fixed; streamName: string }` (streamName is a string so it is part of the canonical checksum and picks the entity's wander stream).
- Produces (exported from `@exiled/replay`):
  - `makeWanderScenario(seed: number, ticks: number, commandsByTick?: Command[][]): Scenario`

- [ ] **Step 1: Write the movement system**

`packages/simulation/src/movement.ts`:

```ts
import { fp, fpAdd, fpClamp, type Fixed } from "@exiled/fixed-point";
import { createStream, type RandomStream } from "./rng";
import { Simulation } from "./loop";
import type { Command } from "./loop";
import type { Entity } from "./ecs";

export const WORLD_MIN: Fixed = fp(-100);
export const WORLD_MAX: Fixed = fp(100);

interface Position { x: Fixed; y: Fixed }
interface Motion { vx: Fixed; vy: Fixed; streamName: string }

export function registerMovement(sim: Simulation, seed: number): void {
  // Per-entity wander streams are created lazily and cached by stream name so
  // draw order stays deterministic across identical runs.
  const streams = new Map<string, RandomStream>();
  const streamFor = (name: string): RandomStream => {
    let s = streams.get(name);
    if (!s) {
      s = createStream(seed, name);
      streams.set(name, s);
    }
    return s;
  };

  sim.register("movement", (world, _tick, commands: readonly Command[]) => {
    // 1. Apply impulse commands to motion.
    for (const cmd of commands) {
      if (cmd.type !== "impulse" || cmd.entity === undefined) continue;
      const m = world.get<Motion>(cmd.entity, "motion");
      if (!m) continue;
      const dvx = cmd.data?.dvx ?? 0;
      const dvy = cmd.data?.dvy ?? 0;
      world.set<Motion>(cmd.entity, "motion", {
        vx: fpAdd(m.vx, dvx),
        vy: fpAdd(m.vy, dvy),
        streamName: m.streamName,
      });
    }

    // 2. Wander + integrate + clamp, in ascending entity order.
    const ids: Entity[] = world.query("position", "motion");
    for (const id of ids) {
      const p = world.get<Position>(id, "position")!;
      const m = world.get<Motion>(id, "motion")!;
      const s = streamFor(m.streamName);
      // Wander: nudge velocity by -1, 0, or +1 fixed-point unit per axis.
      // Magnitude is arbitrary; this exists to draw from the RNG deterministically.
      const wx = s.nextInt(-1, 1);
      const wy = s.nextInt(-1, 1);
      const vx = fpAdd(m.vx, wx);
      const vy = fpAdd(m.vy, wy);
      const nx = fpClamp(fpAdd(p.x, vx), WORLD_MIN, WORLD_MAX);
      const ny = fpClamp(fpAdd(p.y, vy), WORLD_MIN, WORLD_MAX);
      world.set<Position>(id, "position", { x: nx, y: ny });
      world.set<Motion>(id, "motion", { vx, vy, streamName: m.streamName });
    }
  });
}
```

Append to `packages/simulation/src/index.ts`:

```ts
export { WORLD_MIN, WORLD_MAX, registerMovement } from "./movement";
```

- [ ] **Step 2: Write the scenario factory**

`packages/replay/src/scenarios/wander.ts`:

```ts
import { registerMovement, type Command, type Simulation } from "@exiled/simulation";
import { fp } from "@exiled/fixed-point";
import type { Scenario } from "../index";

// Five entities wandering under a shared deterministic seed, with optional
// per-tick impulse commands.
export function makeWanderScenario(
  seed: number,
  ticks: number,
  commandsByTick: Command[][] = [],
): Scenario {
  return {
    seed,
    contentVersion: "kernel.wander.v1",
    ticks,
    commandsByTick,
    build: (sim: Simulation, s: number) => {
      for (let i = 0; i < 5; i++) {
        const e = sim.world.create();
        sim.world.set(e, "position", { x: fp(i), y: fp(-i) });
        sim.world.set(e, "motion", { vx: 0, vy: 0, streamName: `wander.${i}` });
      }
      registerMovement(sim, s);
    },
  };
}
```

- [ ] **Step 3: Write the failing determinism + fuzz test**

`packages/replay/src/scenarios/wander.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { WORLD_MIN, WORLD_MAX, type Command } from "@exiled/simulation";
import { runScenario, firstDifference } from "../index";
import { makeWanderScenario } from "./wander";

describe("wander determinism proof", () => {
  test("3000-tick scenario reproduces an identical checksum sequence", () => {
    const a = runScenario(makeWanderScenario(123, 3000));
    const b = runScenario(makeWanderScenario(123, 3000));
    expect(a.checksums.length).toBe(3000);
    expect(firstDifference(a.checksums, b.checksums)).toBeNull();
    expect(a.final).toBe(b.final);
  });

  test("different seeds diverge", () => {
    const a = runScenario(makeWanderScenario(123, 500));
    const b = runScenario(makeWanderScenario(999, 500));
    expect(a.final).not.toBe(b.final);
  });

  test("fuzzed impulse commands never break determinism or bounds", () => {
    // Command generation uses Math.random (a test input, never in the sim).
    const commandsByTick: Command[][] = [];
    for (let t = 0; t < 1000; t++) {
      const cmds: Command[] = [];
      for (let e = 1; e <= 5; e++) {
        if (Math.random() < 0.3) {
          cmds.push({
            tick: t,
            entity: e,
            type: "impulse",
            data: {
              dvx: Math.floor((Math.random() - 0.5) * 20),
              dvy: Math.floor((Math.random() - 0.5) * 20),
            },
          });
        }
      }
      commandsByTick.push(cmds);
    }

    const a = runScenario(makeWanderScenario(7, 1000, commandsByTick));
    const b = runScenario(makeWanderScenario(7, 1000, commandsByTick));
    // Same seed + same command log => identical checksums.
    expect(firstDifference(a.checksums, b.checksums)).toBeNull();
    expect(a.checksums.length).toBe(1000);

    // Final positions stayed integer and inside the arena for the whole run.
    // (Any non-finite value would have thrown inside checksumWorld during the run.)
    for (const id of a.world.query("position")) {
      const p = a.world.get<{ x: number; y: number }>(id, "position")!;
      expect(Number.isInteger(p.x)).toBe(true);
      expect(Number.isInteger(p.y)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(WORLD_MIN);
      expect(p.x).toBeLessThanOrEqual(WORLD_MAX);
      expect(p.y).toBeGreaterThanOrEqual(WORLD_MIN);
      expect(p.y).toBeLessThanOrEqual(WORLD_MAX);
    }
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test -- packages/replay/src/scenarios/wander`
Expected: FAIL — `registerMovement`/`makeWanderScenario` not found (or module missing).

- [ ] **Step 5: Make it pass**

The implementations from Steps 1-2 satisfy the test. Run:

Run: `npm test -- packages/replay/src/scenarios/wander`
Expected: PASS — all three tests green.

If the determinism test fails with a non-null `firstDifference`, the divergence index localizes the first bad tick — inspect the system for float leakage, unsorted iteration, or unseeded state.

- [ ] **Step 6: Full suite, typecheck, and commit**

Run: `npm test` (expect all packages green), then `npm run typecheck` (expect exit 0), then:

```bash
git add packages/simulation packages/replay
git commit -m "feat(simulation): headless wander determinism proof"
```

---

## Milestone exit gate

Before Milestone 1 is considered done, confirm:

- `npm test` is fully green and `npm run typecheck` exits 0.
- The 3000-tick wander scenario produces an identical checksum sequence across repeated runs (Task 8), proving deterministic replay.
- Fuzzed command streams never produce a non-finite value (the checksum serializer throws on non-finite; the fuzz test would fail) and never leave arena bounds.
- System execution order is documented and inspectable (`systemOrder()`).
- Every random draw goes through a named seeded stream.

This kernel is headless by design. Milestone 2 (Combat Lab) adds the Web Worker authority boundary, `@exiled/protocol`, the Babylon greybox client, and the three elemental-caster skills on top of these primitives — it gets its own plan once this milestone is green.

## Self-review notes

- **Spec coverage (§10.1):** monorepo + CI (Task 1), fixed-point (Task 2), named RNG (Task 3), ECS (Task 4), canonical checksum (Task 5), fixed-step loop + command model (Task 6), replay runner + first-difference (Task 7), headless determinism proof (Task 8). All Milestone-1 deliverables covered.
- **Determinism invariants (§3):** fixed-point only (Task 2, used in Task 8); one inspectable system order (Task 6); named RNG streams with ordinal (Task 3); canonical serialization + rolling checksum + replay equality (Tasks 5, 7, 8); sorted iteration everywhere output is produced (Task 4). The checksum serializer throws on non-finite values, catching accidental float leakage.
- **Type consistency:** `Command`, `System`, `Entity`, `World`, `Simulation`, `RandomStream`, `Scenario`, `ReplayResult`, `Fixed` names are defined once and reused verbatim across tasks; component shapes (`position`, `motion`, `counter`) are consistent between producing and consuming tasks.
- **Deferred (not Milestone 1):** `@exiled/protocol`, worker boundary, Babylon, persistence adapter, skills/monsters/mapgen — all in later milestone plans per spec §10.
