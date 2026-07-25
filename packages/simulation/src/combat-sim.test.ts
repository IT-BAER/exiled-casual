import { describe, it, expect } from "vitest";
import { checksumWorld } from "@exiled/simulation";
import { fp } from "@exiled/fixed-point";
import { MONSTERS, CONTENT_VERSION } from "@exiled/content-runtime";
import { generateArea } from "@exiled/mapgen";
import { createCombatSim, spawnLabActors } from "./combat-sim";
import { gridCollision } from "./collision";
import type { BossC, MonsterC, Position, MoveTarget, SessionC } from "./components";

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
    expect(mana.regen).toBe(Math.trunc(fp(15) / 30)); // 500

    const faction = world.get<{ team: number }>(playerEntity, "faction")!;
    expect(faction.team).toBe(0);

    const player = world.get<{ moveSpeed: number; bodyRadius: number }>(playerEntity, "player")!;
    expect(player.moveSpeed).toBe(Math.trunc(fp(4.2) / 30)); // 140
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
    // fp(40)=40000; 40000*900/100 = 360000 = fp(360). normal = fp(40)=40000.
    expect(rareLife).toBe(Math.trunc(fp(40) * 900 / 100)); // fp(360)
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

  it("lab 'hurtboss' chips 20% of maxLife per call, crosses the phase-2 line, and clamps at 0", () => {
    const { world } = createCombatSim(42, { boss: true });
    const boss = world.query("boss")[0]!;
    const life = () => world.get<{ life: number; maxLife: number }>(boss, "health")!;
    const { maxLife } = life();
    const chunk = Math.trunc((maxLife * 20) / 100);

    spawnLabActors(world, "hurtboss", 0, 0);
    expect(life().life).toBe(maxLife - chunk);

    // Two more chips drop it to 40% of max — at or below the 50% phase-2 threshold.
    spawnLabActors(world, "hurtboss", 0, 0);
    spawnLabActors(world, "hurtboss", 0, 0);
    expect(life().life * 2).toBeLessThanOrEqual(maxLife);

    // Never underflows past 0, however many times it is applied.
    for (let i = 0; i < 10; i++) spawnLabActors(world, "hurtboss", 0, 0);
    expect(life().life).toBe(0);
  });

  // ── Map area: generated layout, socket placement, collision (C4) ─────────
  it("map area returns the generated layout (hash matches generateArea)", () => {
    const { layout } = createCombatSim(42, { area: "map" });
    expect(layout.hash).toBe(generateArea(42, CONTENT_VERSION).hash);
  });

  it("map area places the player at the start socket and the warden at the boss socket", () => {
    const { world, playerEntity, layout } = createCombatSim(42, { area: "map" });
    const start = layout.objectiveAnchors.find((a) => a.id === "start")!;
    const boss = layout.objectiveAnchors.find((a) => a.id === "boss")!;

    const ppos = world.get<Position>(playerEntity, "position")!;
    expect(ppos).toEqual({ x: fp(start.x), y: fp(start.y) });

    const wardenE = world.query("boss")[0]!;
    const wpos = world.get<Position>(wardenE, "position")!;
    expect(wpos).toEqual({ x: fp(boss.x), y: fp(boss.y) });
  });

  it("map area collides the player: steering into a wall never lands it off the walkable grid", () => {
    const { sim, world, playerEntity, layout } = createCombatSim(42, { area: "map" });
    const col = gridCollision(layout.grid);
    // Aim well outside the dungeon (a guaranteed wall) and run into it.
    world.set<MoveTarget>(playerEntity, "moveTarget", { x: fp(100), y: fp(100), active: 1 });
    for (let t = 0; t < 120; t++) sim.step([]);
    const p = world.get<Position>(playerEntity, "position")!;
    expect(col.isWalkable(p.x, p.y, fp(0.5))).toBe(true);
  });

  it("hideout → map transition turns collision on in the running sim (player can't leave the walkable grid)", () => {
    // Boot in the hideout: no walls, player free at the origin.
    const { sim, world, playerEntity } = createCombatSim(42, { area: "hideout" });
    const start = generateArea(42, CONTENT_VERSION).objectiveAnchors.find((a) => a.id === "start")!;
    const mapCol = gridCollision(generateArea(42, CONTENT_VERSION).grid);

    // Enter the map the way a portal interact would: flag the pending area, step.
    const sessionE = world.query("session")[0]!;
    const session = world.get<SessionC>(sessionE, "session")!;
    world.set<SessionC>(sessionE, "session", { ...session, pendingArea: "map" });
    sim.step([]);

    // Landed on the start socket.
    const afterEntry = world.get<Position>(playerEntity, "position")!;
    expect(afterEntry).toEqual({ x: fp(start.x), y: fp(start.y) });

    // Now steering hard into a guaranteed wall never lands off the walkable grid —
    // proof the collision the transition installed is the one the movement system reads.
    world.set<MoveTarget>(playerEntity, "moveTarget", { x: fp(100), y: fp(100), active: 1 });
    for (let t = 0; t < 120; t++) sim.step([]);
    const p = world.get<Position>(playerEntity, "position")!;
    expect(mapCol.isWalkable(p.x, p.y, fp(0.5))).toBe(true);
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
