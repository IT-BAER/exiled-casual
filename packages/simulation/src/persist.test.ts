import { describe, it, expect } from "vitest";
import { isPermanentWaystone } from "@exiled/content-runtime";
import { MemoryKv } from "@exiled/persistence";
import { rollItem, areaLevel, maxGemLevel } from "@exiled/rules";
import { ITEM_POOLS, baseOf, defaultAttackFor } from "@exiled/content-runtime";
import { SKILL_SLOT_COUNT, MOVE_SOCKET } from "@exiled/protocol";
import { createCombatSim } from "./combat-sim";
import { snapshot, restore, saveTo, loadInto, grantSkills, defaultBar, VERSION, type PersistedState } from "./persist";
import type { SessionC, InventoryC, Health, SkillsC, ProgressC } from "./components";
import { PASSIVE_TREE } from "@exiled/rules";

function sessionEntity(world: ReturnType<typeof createCombatSim>["world"]) {
  return world.query("session")[0]!;
}
function getSession(world: ReturnType<typeof createCombatSim>["world"]): SessionC {
  return world.get<SessionC>(sessionEntity(world), "session")!;
}
function setSession(world: ReturnType<typeof createCombatSim>["world"], patch: Partial<SessionC>): void {
  const e = sessionEntity(world);
  world.set<SessionC>(e, "session", { ...world.get<SessionC>(e, "session")!, ...patch });
}

/** A real committed item placed in the inventory, so loot survival is genuine.
 *  Replaces inventory contents so the count is always exactly 1 after this call. */
function stashLoot(world: ReturnType<typeof createCombatSim>["world"]): void {
  const item = rollItem(ITEM_POOLS, 12345, areaLevel(1), 2);
  const base = baseOf(item.baseId);
  const e = sessionEntity(world);
  const inv = world.get<InventoryC>(e, "inventory")!;
  world.set<InventoryC>(e, "inventory", { ...inv, items: [{ x: 0, y: 1, w: base.w, h: base.h, item }] });
}

describe("persist: snapshot/restore round-trip", () => {
  it("round-trips durable session + inventory through a blob", async () => {
    const kv = new MemoryKv();
    const { world } = createCombatSim(7, { area: "hideout" });
    setSession(world, { completedNodes: ["node-a"] });
    stashLoot(world);
    await saveTo(kv, world);

    const reboot = createCombatSim(7, { area: "hideout" });
    expect(await loadInto(kv, reboot.world)).toBe(true);
    expect(getSession(reboot.world).completedNodes).toEqual(["node-a"]);
    // The stashed loot, plus the permanent waystone `restore` puts back into
    // every bag it loads — including saves written before that stone existed.
    expect(reboot.world.get<InventoryC>(sessionEntity(reboot.world), "inventory")!.items).toHaveLength(2);
  });

  /**
   * A character that loses its tree on reload has lost the only thing levels are
   * spent on, so this is the one field worth a test of its own: it rides on the
   * session, and the session is what the blob is.
   */
  it("brings the passive tree back, and the stats it granted with it", async () => {
    const kv = new MemoryKv();
    const { world } = createCombatSim(7, { area: "hideout" });
    const life = PASSIVE_TREE.find((n) => n.mods.some((m) => m.stat === "maxLife" && m.value > 0))!;
    setSession(world, { classId: "class.stalker", passives: [life.id] });
    await saveTo(kv, world);

    const reboot = createCombatSim(7, { area: "hideout" });
    const bare = reboot.world.get<Health>(reboot.world.query("player")[0]!, "health")!.maxLife;
    expect(await loadInto(kv, reboot.world)).toBe(true);
    expect(getSession(reboot.world).passives).toEqual([life.id]);
    expect(getSession(reboot.world).classId).toBe("class.stalker");
    // restore() re-derives, so the node is on the character and not only in the list.
    expect(reboot.world.get<Health>(reboot.world.query("player")[0]!, "health")!.maxLife)
      .toBeGreaterThan(bare);
  });

  it("loadInto returns false when nothing was ever saved", async () => {
    const { world } = createCombatSim(7, { area: "hideout" });
    expect(await loadInto(new MemoryKv(), world)).toBe(false);
  });
});

// The spec §9.4 validation gate: a forced worker restart at any activation or
// finalization boundary cannot duplicate or lose inputs, loot, or progression.
describe("persist: run-transaction fault injection", () => {
  it("abandons an in-flight run on restart (no half-committed map)", async () => {
    const kv = new MemoryKv();
    const { world } = createCombatSim(7, { area: "hideout" });
    // Activation boundary: a run is open (map area, node active, portals held).
    setSession(world, { area: "map", activeNodeId: "node-x", mapOpen: 1, portalsLeft: 6, areaTier: 1, pendingArea: "" });
    await saveTo(kv, world);

    // Forced restart mid-run.
    const reboot = createCombatSim(7, { area: "hideout" }).world;
    expect(await loadInto(kv, reboot)).toBe(true);
    const s = getSession(reboot);
    expect(s.area).toBe("hideout");       // rolled back to safety
    expect(s.activeNodeId).toBe("");      // run abandoned, nothing half-committed
    expect(s.mapOpen).toBe(0);
    expect(s.completedNodes).toEqual([]); // uncompleted node did NOT commit
  });

  it("keeps a completed node and its loot exactly once across restart", async () => {
    const kv = new MemoryKv();
    const { world } = createCombatSim(7, { area: "hideout" });
    // Finalization boundary: boss died, node committed, loot in inventory.
    setSession(world, { completedNodes: ["node-x"] });
    stashLoot(world);
    await saveTo(kv, world);

    // Restart, then a SECOND restore into the same world (a replayed
    // finalization) must not double-apply — proves no duplication.
    const reboot = createCombatSim(7, { area: "hideout" }).world;
    expect(await loadInto(kv, reboot)).toBe(true);
    expect(await loadInto(kv, reboot)).toBe(true);
    const s = getSession(reboot);
    expect(s.completedNodes).toEqual(["node-x"]);                                    // progression kept, not duplicated
    // Loot kept, not duplicated — and neither is the permanent waystone, which
    // the second restore has to recognise rather than hand out again.
    const bag = reboot.get<InventoryC>(sessionEntity(reboot), "inventory")!.items;
    expect(bag).toHaveLength(2);
    expect(bag.filter((p) => isPermanentWaystone(p.item))).toHaveLength(1);
  });

  it("snapshot is null with no session singleton", () => {
    const { world } = createCombatSim(7); // no area opt -> no session
    expect(snapshot(world)).toBeNull();
  });

  it("restore is a no-op when the reboot world has no session", () => {
    const bare = createCombatSim(7).world;
    expect(() => restore(bare, { version: 1, session: {} as SessionC, inventory: {} as InventoryC })).not.toThrow();
  });
});

describe("skills persistence", () => {
  it("a fresh world has a gem for every skill level 1 unlocks and none it does not", () => {
    const { world } = createCombatSim(7, { area: "hideout" });
    const skills = world.get<SkillsC>(sessionEntity(world), "skills")!;
    const session = getSession(world);
    const defaultAttackId = defaultAttackFor(session.classId ?? "");
    expect(skills.gems[defaultAttackId]).toEqual({ level: 1, xp: 0 });
    expect(skills.gems["skill.ember_bolt.v1"]).toEqual({ level: 1, xp: 0 });
    expect(Object.hasOwn(skills.gems, "skill.blink.v1")).toBe(false);
    expect(Object.hasOwn(skills.gems, "skill.cinder_ground.v1")).toBe(false);
    expect(Object.hasOwn(skills.gems, "skill.town_portal.v1")).toBe(false);
  });

  it("a level-up grants the gems that level opened, leaving the ones already held alone", () => {
    const { world } = createCombatSim(7, { area: "hideout" });
    const e = sessionEntity(world);
    // Give the already-held ember_bolt gem real progress, so a reset would be visible.
    const before = world.get<SkillsC>(e, "skills")!;
    world.set<SkillsC>(e, "skills", {
      ...before,
      gems: { ...before.gems, "skill.ember_bolt.v1": { level: 5, xp: 77 } },
    });
    world.set<ProgressC>(e, "progress", { ...world.get<ProgressC>(e, "progress")!, level: 10 });

    grantSkills(world);

    const skills = world.get<SkillsC>(e, "skills")!;
    expect(skills.gems["skill.blink.v1"]).toEqual({ level: 1, xp: 0 });
    expect(skills.gems["skill.cinder_ground.v1"]).toEqual({ level: 1, xp: 0 });
    expect(skills.gems["skill.town_portal.v1"]).toEqual({ level: 1, xp: 0 });
    // The gem already held was left exactly as it was, not reset by the grant.
    expect(skills.gems["skill.ember_bolt.v1"]).toEqual({ level: 5, xp: 77 });
  });

  it("snapshot round-trips gems and the bar", () => {
    const { world } = createCombatSim(7, { area: "hideout" });
    const e = sessionEntity(world);
    world.set<ProgressC>(e, "progress", { ...world.get<ProgressC>(e, "progress")!, level: 12 });
    grantSkills(world);
    const before = world.get<SkillsC>(e, "skills")!;
    world.set<SkillsC>(e, "skills", {
      gems: { ...before.gems, "skill.ember_bolt.v1": { level: 6, xp: 42 } },
      bar: ["skill.ember_bolt.v1", "skill.blink.v1", null, null, null, MOVE_SOCKET, null, "skill.snap_shot.v1"],
    });

    const snap = snapshot(world)!;
    const fresh = createCombatSim(9, { area: "hideout" }).world;
    restore(fresh, snap);

    expect(fresh.get<SkillsC>(sessionEntity(fresh), "skills")).toEqual(world.get<SkillsC>(e, "skills"));
  });

  it("a save written with NO skills field restores with the bar seeded and the gems granted", () => {
    const { world } = createCombatSim(7, { area: "hideout" });
    const someSnapshot = snapshot(world)!;
    const state = { ...someSnapshot, progress: { level: 12, xp: 0, gold: 0 } };
    delete (state as Record<string, unknown>)["skills"];

    const freshWorld = createCombatSim(9, { area: "hideout" }).world;
    restore(freshWorld, state as PersistedState);

    const skills = freshWorld.get<SkillsC>(sessionEntity(freshWorld), "skills")!;
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
    const { world } = createCombatSim(7, { area: "hideout" });
    const base = snapshot(world)!;
    const state: PersistedState = {
      ...base,
      progress: { level: 3, xp: 0, gold: 0 },
      skills: { gems: { "skill.ember_bolt.v1": { level: 20, xp: 999 } }, bar: defaultBar("") },
    };

    const fresh = createCombatSim(9, { area: "hideout" }).world;
    restore(fresh, state);

    const skills = fresh.get<SkillsC>(sessionEntity(fresh), "skills")!;
    expect(maxGemLevel(3)).toBe(3);
    expect(skills.gems["skill.ember_bolt.v1"]!.level).toBe(maxGemLevel(3));
  });
});
