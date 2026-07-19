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
    expect(snap.player.x).toBe(0);
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
    sim.step([cmd]);
    const snap = buildSnapshot(world, sim, sim.tick, CONTENT_VERSION);
    expect(snap.player.cooldowns["skill.ember_bolt.v1"]).toBeCloseTo(5 / 30, 5);
  });

  it("monster entities appear in snapshot sorted by id with life/maxLife/rare", () => {
    const { world, sim } = createCombatSim(42);
    const snap = buildSnapshot(world, sim, 0, CONTENT_VERSION);
    const monsters = snap.entities.filter(e => e.kind === "monster");
    expect(monsters).toHaveLength(6);
    for (let i = 1; i < monsters.length; i++) {
      expect(monsters[i]!.id).toBeGreaterThan(monsters[i - 1]!.id);
    }
    expect(monsters.filter(e => e.rare).length).toBe(1);
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
