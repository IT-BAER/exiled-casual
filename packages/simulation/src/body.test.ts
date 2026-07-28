import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import { World } from "./ecs";
import { bodyRadiusOf } from "./body";
import type { MonsterC, PlayerC } from "./components";

describe("bodyRadiusOf", () => {
  it("returns monster bodyRadius", () => {
    const w = new World();
    const e = w.create();
    w.set<MonsterC>(e, "monster", {
      defId: "test", moveSpeed: 0, bodyRadius: fp(0.7),
      attackRange: 0, attackCooldownTicks: 0, attackDamage: 0,
      attackType: 1, attackReadyTick: 0, slamReadyTick: 0, rootedUntilTick: 0, state: "idle", rare: 0, summoned: 0,
    });
    expect(bodyRadiusOf(w, e)).toBe(fp(0.7));
  });

  it("returns player bodyRadius", () => {
    const w = new World();
    const e = w.create();
    w.set<PlayerC>(e, "player", { moveSpeed: 0, bodyRadius: fp(0.5) });
    expect(bodyRadiusOf(w, e)).toBe(fp(0.5));
  });

  it("returns 0 for entity with neither", () => {
    const w = new World();
    const e = w.create();
    expect(bodyRadiusOf(w, e)).toBe(0);
  });
});
