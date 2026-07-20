import { describe, it, expect } from "vitest";
import { checksumWorld } from "@pact/simulation";
import { fp } from "@pact/fixed-point";
import { MONSTERS } from "@pact/content-runtime";
import { createCombatSim } from "./combat-sim";
import type { BossC, MonsterC, Position } from "./components";

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

  // ── Boss opt-in regression guard ─────────────────────────────────────────
  it("default (no opts) spawns exactly 6 monsters and NO boss component", () => {
    const { world } = createCombatSim(42);
    expect(world.query("monster")).toHaveLength(6);
    expect(world.query("boss")).toHaveLength(0);
  });

  it("opts.boss=true adds exactly one boss entity at (0,12) with correct defId and BossC", () => {
    const { world } = createCombatSim(42, { boss: true });
    const bossEntities = world.query("boss");
    expect(bossEntities).toHaveLength(1);
    const boss = bossEntities[0]!;

    const mon = world.get<MonsterC>(boss, "monster")!;
    expect(mon.defId).toBe("monster.cinder_warden.v1");

    const pos = world.get<Position>(boss, "position")!;
    expect(pos.x).toBe(fp(0));
    expect(pos.y).toBe(fp(12));

    const bc = world.get<BossC>(boss, "boss")!;
    expect(bc.spawnX).toBe(fp(0));
    expect(bc.spawnY).toBe(fp(12));
    expect(bc.phase).toBe(1);
  });

  it("boss maxLife matches the real content def", () => {
    const { world } = createCombatSim(42, { boss: true });
    const boss = world.query("boss")[0]!;
    const wardenDef = MONSTERS.get("monster.cinder_warden.v1")!;
    const health = world.get<{ maxLife: number }>(boss, "health")!;
    expect(health.maxLife).toBe(wardenDef.maxLifeFixed);
  });

  it("system registration order matches canonical spec", () => {
    const { sim } = createCombatSim(42);
    expect(sim.systemOrder()).toEqual([
      "resourceRegen", "skillCast", "playerMovement", "monsterAI", "bossAI",
      "projectileMove", "groundAreaTick", "telegraphResolve", "ailmentTick",
      "damageResolve", "death", "expiry",
    ]);
  });
});
