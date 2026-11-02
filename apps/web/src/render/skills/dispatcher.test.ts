// @vitest-environment node
import { describe, it, expect, afterEach, vi } from "vitest";
import { NullEngine, Scene, TransformNode } from "@babylonjs/core";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { SkillLookDispatcher, travelLift, travelState, type BodyRef } from "./dispatcher";
import type { ClassSkillLooks } from "./types";

let engine: NullEngine | undefined;
afterEach(() => { engine?.dispose(); engine = undefined; });

const SKILL = "skill.test.v1";

function counted() {
  const made = { warn: 0, impact: 0, ground: 0, buff: 0, status: 0, cast: 0, travel: 0, land: 0, projectile: 0, hit: 0 };
  const gone = { warn: 0, ground: 0, buff: 0, status: 0, cast: 0, travel: 0, projectile: 0 };
  const handle = (k: keyof typeof gone) => ({ update: vi.fn(), dispose: () => { gone[k]++; } });
  const looks: ClassSkillLooks = {
    skills: {
      [SKILL]: {
        cast: { clip: "cast", start: () => { made.cast++; return handle("cast"); } },
        area: { warn: () => { made.warn++; return handle("warn"); }, impact: () => { made.impact++; } },
        ground: { create: () => { made.ground++; return handle("ground"); } },
        travel: { arcHeight: 1, start: () => { made.travel++; return handle("travel"); }, land: () => { made.land++; } },
        projectile: { create: () => { made.projectile++; return { ...handle("projectile"), impact: () => { made.hit++; } }; } },
      },
    },
    buffs: { haste: { create: () => { made.buff++; return handle("buff"); } } },
    statuses: {
      chilled: { create: () => { made.status++; return handle("status"); } },
      stunned: { create: () => { made.status++; return handle("status"); } },
    },
  };
  return { made, gone, looks };
}

function snap(tick: number, entities: Partial<SnapshotEntity>[], player: Partial<Snapshot["player"]> = {}): Snapshot {
  return {
    tick, area: "hideout", entities: entities as SnapshotEntity[],
    player: { id: 1, x: 0, y: 0, alive: true, casting: false, cooldowns: {}, buffs: [], ...player },
  } as unknown as Snapshot;
}

function world() {
  engine = new NullEngine();
  const scene = new Scene(engine);
  const player = { node: new TransformNode("p", scene), x: 0, z: 0, yaw: 0 };
  const monster: BodyRef = { node: new TransformNode("m", scene), x: 3, z: 0, yaw: 0, visible: true };
  return { scene, player, monster };
}

describe("skill look dispatcher", () => {
  it("warns an area until it lands, fires its impact once, and drops it when it leaves", () => {
    const { scene, player, monster } = world();
    const { made, gone, looks } = counted();
    const d = new SkillLookDispatcher(scene, looks);
    const area = { id: 9, kind: "skillArea" as const, x: 2, y: 2, radius: 2, skillId: SKILL, impactIn: 0.5 };
    const run = (s: Snapshot) => { d.begin(s, 0, s.tick * 33); d.frame({ prev: null, next: s, alpha: 0, player, bodyOf: () => monster }); };
    run(snap(1, [area]));
    run(snap(2, [area]));
    expect(made.warn).toBe(1);
    run(snap(3, [{ ...area, impactIn: 0, spent: true }]));
    run(snap(3, [{ ...area, impactIn: 0, spent: true }]));
    expect(made.impact).toBe(1);
    expect(gone.warn).toBe(1);
    run(snap(4, []));
    expect(made.impact).toBe(1);
    expect(d.live).toBe(0);
  });

  it("lands an area whose spent snapshot was never drawn", () => {
    const { scene, player, monster } = world();
    const { made, looks } = counted();
    const d = new SkillLookDispatcher(scene, looks);
    const area = { id: 9, kind: "skillArea" as const, x: 2, y: 2, radius: 2, skillId: SKILL, impactIn: 0.1 };
    d.frame({ prev: null, next: snap(1, [area]), alpha: 0, player, bodyOf: () => monster });
    d.frame({ prev: null, next: snap(5, []), alpha: 0, player, bodyOf: () => monster });
    expect(made.impact).toBe(1);
  });

  it("owns a registered ground, a buff and a status for exactly as long as the snapshot holds them", () => {
    const { scene, player, monster } = world();
    const { made, gone, looks } = counted();
    const d = new SkillLookDispatcher(scene, looks);
    const on = snap(1, [
      { id: 5, kind: "groundArea", x: 0, y: 0, radius: 2, skillId: SKILL, remainingSeconds: 3 },
      { id: 6, kind: "monster", x: 3, y: 0, statuses: ["chilled"], stunned: true },
    ], { buffs: [{ id: "haste", kind: "buff", remainingSec: 0, aura: true }] });
    for (let i = 0; i < 3; i++) d.frame({ prev: null, next: on, alpha: 0, player, bodyOf: () => monster });
    expect(made).toMatchObject({ ground: 1, buff: 1, status: 2 });
    expect(d.ownsGround(SKILL)).toBe(true);
    expect(d.ownsGround("skill.cinder_ground.v1")).toBe(false);
    // The monster dies: its statuses go with it; the patch and the aura end.
    d.frame({ prev: on, next: snap(2, []), alpha: 0, player, bodyOf: () => null });
    expect(gone).toMatchObject({ ground: 1, buff: 1, status: 2 });
    expect(d.live).toBe(0);
  });

  it("starts cast and travel FX on their edges, lands once, and lets go of all of it on an area change", () => {
    const { scene, player, monster } = world();
    const { made, gone, looks } = counted();
    const d = new SkillLookDispatcher(scene, looks);
    const casting = snap(1, [], { casting: true, castSkill: SKILL });
    d.frame({ prev: null, next: casting, alpha: 0, player, bodyOf: () => monster });
    d.frame({ prev: null, next: casting, alpha: 0, player, bodyOf: () => monster });
    expect(made.cast).toBe(1);
    const flying = snap(2, [], { travel: { skillId: SKILL, ticks: 10, elapsed: 4, dirX: 1, dirY: 0 } });
    d.frame({ prev: casting, next: flying, alpha: 0, player, bodyOf: () => monster });
    expect(gone.cast).toBe(1);
    expect(made.travel).toBe(1);
    d.frame({ prev: flying, next: snap(3, []), alpha: 0, player, bodyOf: () => monster });
    expect(made.land).toBe(1);
    expect(gone.travel).toBe(1);
    d.frame({ prev: null, next: flying, alpha: 0, player, bodyOf: () => monster });
    d.clear();
    expect(d.live).toBe(0);
    expect(gone.travel).toBe(2);
  });

  it("strikes and disposes a custom projectile, and the scene's disposal takes whatever is left", () => {
    const { scene, player, monster } = world();
    const { made, gone, looks } = counted();
    const d = new SkillLookDispatcher(scene, looks);
    const node = new TransformNode("bolt", scene);
    d.projectile({ id: 3, kind: "projectile", x: 0, y: 0, skillId: SKILL } as SnapshotEntity, node, 0, 1);
    d.projectileGone(3, true);
    expect(made).toMatchObject({ projectile: 1, hit: 1 });
    expect(gone.projectile).toBe(1);
    d.frame({ prev: null, next: snap(1, [], { buffs: [{ id: "haste", kind: "buff", remainingSec: 4 }] }), alpha: 0, player, bodyOf: () => monster });
    expect(made.buff).toBe(1);
    scene.dispose();
    expect(gone.buff).toBe(1);
    expect(d.live).toBe(0);
  });

  it("draws the shipped placeholder looks without throwing", () => {
    const { scene, player, monster } = world();
    const d = new SkillLookDispatcher(scene);
    const s = snap(1, [
      { id: 9, kind: "skillArea", x: 2, y: 2, radius: 2, skillId: "skill.earthquake.v1", impactIn: 0.5, shape: "cone", arc: 90, dirX: 0, dirY: 1 },
      { id: 6, kind: "monster", x: 3, y: 0, statuses: ["chilled", "scorched", "marked", "flammable", "taunted"], stunned: true },
    ], { buffs: ["infernal_cry", "blood_rage", "determination", "haste", "herald_of_ash"].map((id) => ({ id, kind: "buff" as const, remainingSec: 0, aura: true as const })) });
    d.frame({ prev: null, next: s, alpha: 0, player, bodyOf: () => monster });
    expect(d.live).toBe(1 + 6 + 5);
    d.frame({ prev: s, next: snap(2, [{ id: 9, kind: "skillArea", x: 2, y: 2, radius: 2, skillId: "skill.earthquake.v1", impactIn: 0, spent: true, dirX: 0, dirY: 1 }]), alpha: 0, player, bodyOf: () => monster });
    d.clear();
    expect(d.live).toBe(0);
  });
});

describe("ailments on a monster", () => {
  it("draws its burning, poison and bleeding and a freezing meter, handing the meter to the look", () => {
    const { scene, player, monster } = world();
    const made: string[] = [];
    const amounts: (number | undefined)[] = [];
    const look = (id: string) => ({
      create: (_c: unknown, s: { amount?: number }) => { made.push(id); amounts.push(s.amount); return { update: (_x: unknown, st: { amount?: number }) => { amounts.push(st.amount); }, dispose: () => {} }; },
    });
    const looks: ClassSkillLooks = { skills: {}, buffs: {}, statuses: { burning: look("burning"), poison: look("poison"), bleeding: look("bleeding"), freezing: look("freezing") } };
    const d = new SkillLookDispatcher(scene, looks);
    const mon = (freeze: number) => ({ id: 6, kind: "monster" as const, x: 3, y: 0, debuffs: ["burning", "poison", "bleeding"] as ("burning" | "poison" | "bleeding")[], freeze });
    d.frame({ prev: null, next: snap(1, [mon(40)]), alpha: 0, player, bodyOf: () => monster });
    expect(made.sort()).toEqual(["bleeding", "burning", "freezing", "poison"]);
    d.frame({ prev: null, next: snap(2, [mon(70)]), alpha: 0, player, bodyOf: () => monster });
    expect(amounts).toContain(0.4);
    expect(amounts).toContain(0.7);
    d.clear();
  });
});

describe("skill look hooks", () => {
  const burst = (log: { disposed: number }) => ({ update: vi.fn(() => true), dispose: () => { log.disposed++; } });
  const run = (d: SkillLookDispatcher, s: Snapshot, player: BodyRef | { node: TransformNode; x: number; z: number; yaw: number }, monster: BodyRef, prev: Snapshot | null = null) =>
    d.frame({ prev, next: s, alpha: 0, player, bodyOf: () => monster });

  it("hands every look the shake callback and adopts a handle into the burst list until clear", () => {
    const { scene, player, monster } = world();
    const shake = vi.fn();
    const log = { disposed: 0 };
    const looks: ClassSkillLooks = {
      skills: { [SKILL]: { cast: { clip: "cast", start: (ctx) => { ctx.shake?.(0.5); ctx.adopt?.(burst(log)); return { dispose: () => {} }; } } } },
      buffs: {}, statuses: {},
    };
    const d = new SkillLookDispatcher(scene, looks, { shake });
    run(d, snap(1, [], { casting: true, castSkill: SKILL }), player, monster);
    expect(shake).toHaveBeenCalledWith(0.5);
    expect(d.live).toBe(2);
    d.clear();
    expect(log.disposed).toBe(1);
    expect(d.live).toBe(0);
    const d2 = new SkillLookDispatcher(scene, looks);
    run(d2, snap(1, [], { casting: true, castSkill: SKILL }), player, monster);
    scene.dispose();
    expect(log.disposed).toBe(2);
  });

  it("fires a release once per castRelease edge, ignores a stale one, and passes the facing", () => {
    const { scene, player, monster } = world();
    const release = vi.fn();
    const looks: ClassSkillLooks = { skills: { [SKILL]: { release } }, buffs: {}, statuses: {} };
    const d = new SkillLookDispatcher(scene, looks);
    const at = (tick: number, rel: number) => snap(tick, [], { castRelease: { skillId: SKILL, tick: rel }, facing: { x: 1, y: 0 } });
    run(d, at(10, 10), player, monster);
    run(d, at(11, 10), player, monster);
    run(d, at(12, 10), player, monster);
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0]![2]).toMatchObject({ skillId: SKILL, dirX: 1, dirY: 0 });
    run(d, at(20, 20), player, monster);
    expect(release).toHaveBeenCalledTimes(2);
    run(d, at(40, 30), player, monster);
    expect(release).toHaveBeenCalledTimes(2);
  });

  it("passes the caster to a player's ground patch and none to a hostile one", () => {
    const { scene, player, monster } = world();
    const states: unknown[] = [];
    const looks: ClassSkillLooks = {
      skills: { [SKILL]: { ground: { create: (_c, g) => { states.push(g.caster); return { dispose: () => {} }; } } } },
      buffs: {}, statuses: {},
    };
    const d = new SkillLookDispatcher(scene, looks);
    run(d, snap(1, [{ id: 5, kind: "groundArea", x: 4, y: 4, radius: 2, skillId: SKILL, remainingSeconds: 3 }], { x: 1, y: 2 }), player, monster);
    run(d, snap(2, [{ id: 6, kind: "groundArea", x: 4, y: 4, radius: 2, skillId: SKILL, remainingSeconds: 3, team: 1 }], { x: 1, y: 2 }), player, monster);
    expect(states).toEqual([{ x: 1, y: 2 }, undefined]);
  });

  it("passes the arrow flag and the chain source to a projectile look", () => {
    const { scene } = world();
    const seen: unknown[] = [];
    const looks: ClassSkillLooks = {
      skills: { [SKILL]: { projectile: { create: (_c, p) => { seen.push({ arrow: p.arrow, chainFrom: p.chainFrom }); return { update: () => {}, dispose: () => {} }; } } } },
      buffs: {}, statuses: {},
    };
    const d = new SkillLookDispatcher(scene, looks);
    const node = new TransformNode("bolt", scene);
    const from = { id: 2, x: 1, z: 3, node: null };
    d.projectile({ id: 3, kind: "projectile", x: 0, y: 0, skillId: SKILL } as SnapshotEntity, node, 0, 1, true, from);
    d.projectile({ id: 4, kind: "projectile", x: 0, y: 0, skillId: SKILL } as SnapshotEntity, node, 0, 1);
    expect(seen).toEqual([{ arrow: true, chainFrom: from }, { arrow: false, chainFrom: undefined }]);
  });

  it("a marker area lands its impact once and its warn never shows", () => {
    const { scene, player, monster } = world();
    const { made, looks } = counted();
    const d = new SkillLookDispatcher(scene, looks);
    const marker = { id: 8, kind: "skillArea" as const, x: 6, y: 0, radius: 3, skillId: SKILL, impactIn: 0, spent: true };
    run(d, snap(1, [marker]), player, monster);
    run(d, snap(2, [marker]), player, monster);
    expect(made.impact).toBe(1);
    expect(made.warn).toBe(0);
  });
});

describe("look hooks", () => {
  it("fires a release once per resolve, ignores a stale one, and owns what it returns and what is adopted", () => {
    const { scene, player, monster } = world();
    let released = 0;
    let gone = 0;
    let caster: { x: number; y: number } | undefined;
    const shake = vi.fn();
    const looks: ClassSkillLooks = {
      skills: {
        [SKILL]: {
          release: (ctx) => {
            released++;
            ctx.shake?.(0.4);
            ctx.adopt!({ update: () => true, dispose: () => { gone++; } });
            return { update: () => true, dispose: () => { gone++; } };
          },
          ground: { create: (_c, g) => { caster = g.caster; return { dispose() {} }; } },
        },
      },
      buffs: {},
      statuses: {},
    };
    const d = new SkillLookDispatcher(scene, looks, { shake });
    const at = (tick: number, rel?: number, entities: Partial<SnapshotEntity>[] = []) =>
      d.frame({ prev: null, next: snap(tick, entities, { x: 4, y: 5, ...(rel !== undefined ? { castRelease: { skillId: SKILL, tick: rel } } : {}) }), alpha: 0, player, bodyOf: () => monster });
    at(50, 10);
    expect(released).toBe(0);
    at(60, 60);
    at(60, 60);
    at(61, 60);
    expect(released).toBe(1);
    expect(shake).toHaveBeenCalledWith(0.4);
    at(70, 70, [{ id: 3, kind: "groundArea", x: 9, y: 9, radius: 2, skillId: SKILL, team: 0 }]);
    expect(released).toBe(2);
    expect(caster).toEqual({ x: 4, y: 5 });
    expect(d.live).toBe(1 + 4);
    d.clear();
    expect(gone).toBe(4);
    expect(d.live).toBe(0);
  });

  it("hands a projectile look the arrow flag and the body a chain left", () => {
    const { scene } = world();
    const seen: unknown[] = [];
    const looks: ClassSkillLooks = {
      skills: { [SKILL]: { projectile: { create: (_c, p) => { seen.push({ arrow: p.arrow, chainFrom: p.chainFrom?.id }); return { update() {}, dispose() {} }; } } } },
      buffs: {},
      statuses: {},
    };
    const d = new SkillLookDispatcher(scene, looks);
    const node = new TransformNode("arrow", scene);
    d.projectile({ id: 3, kind: "projectile", x: 0, y: 0, skillId: SKILL, chainFrom: 9 } as SnapshotEntity, node, 0, 1, true, { id: 9, x: 1, z: 2, node: null });
    expect(seen).toEqual([{ arrow: true, chainFrom: 9 }]);
  });
});

describe("travel arc", () => {
  it("interpolates the travel and lifts the body on a parabola", () => {
    const prev = snap(1, [], { travel: { skillId: SKILL, ticks: 10, elapsed: 4, dirX: 1, dirY: 0 } });
    const next = snap(2, [], { travel: { skillId: SKILL, ticks: 10, elapsed: 5, dirX: 1, dirY: 0 } });
    expect(travelState(prev, next, 0.5)!.progress).toBeCloseTo(0.45);
    expect(travelState(null, snap(1, []), 0)).toBeNull();
    expect(travelLift(2, 0.5)).toBeCloseTo(2);
    expect(travelLift(2, 0)).toBe(0);
  });
});
