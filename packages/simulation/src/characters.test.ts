import { describe, it, expect } from "vitest";
import { MemoryKv, ROSTER_VERSION, addCharacter, emptyRoster, findCharacter, saveRoster } from "@exiled/persistence";
import { CLASS_IDS, DEFAULT_CLASS_ID, START_LEVEL } from "@exiled/rules";
import { CLASSES, STARTER_BASE_IDS, baseOf, defaultAttackFor } from "@exiled/content-runtime";
import { MOUSE_SLOT_BASE } from "@exiled/protocol";
import { createCombatSim } from "./combat-sim";
import { saveTo } from "./persist";
import { equipStartingGear, loadCharacterInto, saveCharacterTo } from "./characters";
import {
  MIGRATED_CHARACTER_ID,
  MIGRATED_CHARACTER_NAME,
  makeCharacterRecord,
  migrateSingleSave,
  openRoster,
} from "./roster-io";
import type { EquipmentC, InventoryC, ProgressC, SessionC, SkillsC, StashC } from "./components";

const NOW = 1_700_000_000_000;
type Sim = ReturnType<typeof createCombatSim>;

function fresh(): Sim["world"] {
  return createCombatSim(7, { area: "hideout" }).world;
}
function sessionOf(world: Sim["world"]) {
  return world.query("session")[0]!;
}
function set<T extends object>(world: Sim["world"], key: string, value: T): void {
  world.set<T>(sessionOf(world), key, value);
}
function get<T extends object>(world: Sim["world"], key: string): T {
  return world.get<T>(sessionOf(world), key)!;
}

/** A roster holding one character with no save yet. */
async function withOneCharacter(classId = DEFAULT_CLASS_ID) {
  const kv = new MemoryKv();
  const record = makeCharacterRecord({ name: "Vess", classId }, "vess", NOW);
  await saveRoster(kv, addCharacter(emptyRoster(), record, 8));
  return kv;
}

describe("class content", () => {
  it("rules' id list and content-runtime's definitions are the same set", () => {
    expect([...CLASS_IDS].sort()).toEqual(Object.keys(CLASSES).sort());
  });

  it("every definition's id matches the key it is filed under", () => {
    for (const [key, c] of Object.entries(CLASSES)) expect(c.id).toBe(key);
  });

  it("every starting base is real content the equipment slots accept", () => {
    for (const c of Object.values(CLASSES)) {
      for (const [slot, baseId] of Object.entries(c.startingGear)) {
        // Throws on an unknown base, which is the assertion.
        const base = baseOf(baseId);
        // A helmet base in the boots slot would dress the character in nonsense.
        if (base.itemClass !== "body") expect(base.itemClass, `${c.id}.${slot}`).toBe(slot);
      }
    }
  });

  it("gives each class its own body base, or the three look identical", () => {
    const bodies = Object.values(CLASSES).map((c) => c.startingGear["body"]);
    expect(new Set(bodies).size).toBe(bodies.length);
    for (const b of bodies) expect(STARTER_BASE_IDS).toContain(b);
  });

  it("keeps the starter bodies out of the drop pool", async () => {
    const { ITEM_POOLS } = await import("@exiled/content-runtime");
    for (const id of STARTER_BASE_IDS) {
      expect(ITEM_POOLS.bases.map((b) => b.id)).not.toContain(id);
    }
  });
});

describe("makeCharacterRecord", () => {
  it("starts at START_LEVEL with no save of its own", () => {
    const r = makeCharacterRecord({ name: " Vess ", classId: "class.ironsworn" }, "id-1", NOW);
    expect(r).toMatchObject({
      id: "id-1", name: "Vess", classId: "class.ironsworn",
      level: START_LEVEL, league: "Local", createdAt: NOW, state: null,
    });
  });

  it("falls back rather than storing a class that does not exist", () => {
    expect(makeCharacterRecord({ name: "Vess", classId: "class.nope" }, "id", NOW).classId)
      .toBe(DEFAULT_CLASS_ID);
  });
});

describe("equipStartingGear", () => {
  it("dresses the world in the class's outfit", () => {
    const world = fresh();
    equipStartingGear(world, "class.ironsworn");
    const slots = get<EquipmentC>(world, "equipment").slots;
    expect(Object.keys(slots).sort()).toEqual(["belt", "body", "boots", "gloves"]);
    expect(slots["body"]?.baseId).toBe("base.ironsworn_plate");
    // Ironsworn wears no helmet on purpose; the renderer draws that as bare head.
    expect(slots["helmet"]).toBeUndefined();
  });

  it("the gear reaches the player's stats, not just the paper doll", () => {
    const bare = fresh();
    const dressed = fresh();
    equipStartingGear(dressed, "class.ironsworn");
    const life = (w: Sim["world"]) => w.get<{ maxLife: number }>(w.query("health", "player")[0]!, "health")!.maxLife;
    // The plate's implicit is +12 Strength, and Strength is Life here.
    expect(life(dressed)).toBeGreaterThan(life(bare));
  });
});

describe("migrateSingleSave", () => {
  /** A real pre-roster save, exactly as `saveTo` writes one. */
  async function captureV2Blob() {
    const kv = new MemoryKv();
    const world = fresh();
    set<SessionC>(world, "session", { ...get<SessionC>(world, "session"), completedNodes: ["node-a"] });
    set<ProgressC>(world, "progress", { level: 14, xp: 220, gold: 900 });
    set<StashC>(world, "stash", { cols: 12, rows: 12, items: [] });
    await saveTo(kv, world);
    return JSON.parse((await kv.load())!) as unknown;
  }

  it("turns the one old save into a one-character roster, keeping its level", async () => {
    const roster = migrateSingleSave(await captureV2Blob(), NOW);
    expect(roster).not.toBeNull();
    expect(roster!.version).toBe(ROSTER_VERSION);
    expect(roster!.characters).toHaveLength(1);
    expect(roster!.characters[0]).toMatchObject({
      id: MIGRATED_CHARACTER_ID,
      name: MIGRATED_CHARACTER_NAME,
      classId: DEFAULT_CLASS_ID,
      level: 14,
    });
    expect(roster!.lastPlayedId).toBe(MIGRATED_CHARACTER_ID);
  });

  it("hoists the stash out of the character and onto the roster", async () => {
    const roster = migrateSingleSave(await captureV2Blob(), NOW)!;
    expect(roster.stash).toEqual({ cols: 12, rows: 12, items: [] });
    expect(roster.characters[0]!.state).not.toHaveProperty("stash");
  });

  it("keeps the character's own progress inside its state", async () => {
    const roster = migrateSingleSave(await captureV2Blob(), NOW)!;
    const state = roster.characters[0]!.state as { session: SessionC; progress: ProgressC };
    expect(state.session.completedNodes).toEqual(["node-a"]);
    expect(state.progress.gold).toBe(900);
  });

  it("migrating the same blob twice cannot produce two characters", async () => {
    const blob = await captureV2Blob();
    const a = migrateSingleSave(blob, NOW)!;
    const b = migrateSingleSave(blob, NOW)!;
    expect(a.characters[0]!.id).toBe(b.characters[0]!.id);
  });

  it("refuses anything that is not a v2 save", () => {
    expect(migrateSingleSave(null, NOW)).toBeNull();
    expect(migrateSingleSave({ version: 1, session: {}, inventory: {} }, NOW)).toBeNull();
    expect(migrateSingleSave({ version: 2 }, NOW)).toBeNull();
    expect(migrateSingleSave("nonsense", NOW)).toBeNull();
  });
});

describe("openRoster", () => {
  it("returns an empty roster when nothing was ever saved", async () => {
    expect((await openRoster(new MemoryKv(), NOW)).characters).toEqual([]);
  });

  it("migrates a pre-roster save on the way through", async () => {
    const kv = new MemoryKv();
    const world = fresh();
    await saveTo(kv, world);
    expect((await openRoster(kv, NOW)).characters).toHaveLength(1);
  });

  it("returns a saved roster untouched", async () => {
    const kv = await withOneCharacter();
    const r = await openRoster(kv, NOW);
    expect(r.characters.map((c) => c.name)).toEqual(["Vess"]);
  });

  it("falls back to empty on a blob too old to understand", async () => {
    const kv = new MemoryKv();
    await kv.save(JSON.stringify({ version: 1, session: {}, inventory: {} }));
    expect((await openRoster(kv, NOW)).characters).toEqual([]);
  });
});

describe("loadCharacterInto / saveCharacterTo", () => {
  it("dresses a never-played character in its class's gear", async () => {
    const kv = await withOneCharacter("class.emberbound");
    const world = fresh();
    expect(await loadCharacterInto(kv, world, "vess")).toBe(true);
    expect(get<EquipmentC>(world, "equipment").slots["body"]?.baseId).toBe("base.emberbound_robe");
  });

  it("reports false for a character that is not in the roster", async () => {
    expect(await loadCharacterInto(await withOneCharacter(), fresh(), "nobody")).toBe(false);
  });

  // The bar is seeded off the roster's classId, never the "" fallback:
  // combat-sim's own initial world seed runs before the roster's classId is
  // known — so every class got the Stalker's Snap Shot in the right-click slot.
  it("seeds a never-played character's mouse attack from its own class, not the Stalker fallback", async () => {
    const kv = await withOneCharacter("class.ironsworn");
    const world = fresh();
    await loadCharacterInto(kv, world, "vess");
    const bar = get<SkillsC>(world, "skills").bar;
    expect(defaultAttackFor("class.ironsworn")).toBe("skill.strike.v1");
    expect(bar[MOUSE_SLOT_BASE + 2]).toBe("skill.strike.v1");
  });

  it("self-heals a character already saved with the wrong class's attack in the mouse slot", async () => {
    const kv = await withOneCharacter("class.ironsworn");
    const world = fresh();
    await loadCharacterInto(kv, world, "vess");
    // Simulate a save written by the pre-Task-6 build: the mouse slot holds
    // Snap Shot regardless of class, and attackReseeded is unset — the one
    // provenance shape that can still only be the bug, never a deliberate
    // choice, since the flag did not exist yet to record one.
    const skills = get<SkillsC>(world, "skills");
    const badBar = [...skills.bar];
    badBar[MOUSE_SLOT_BASE + 2] = "skill.snap_shot.v1";
    set<SkillsC>(world, "skills", { gems: skills.gems, bar: badBar });
    await saveCharacterTo(kv, world, "vess");

    const reboot = fresh();
    await loadCharacterInto(kv, reboot, "vess");
    expect(get<SkillsC>(reboot, "skills").bar[MOUSE_SLOT_BASE + 2]).toBe("skill.strike.v1");
  });

  // Review round 2: the fix above must not eat a player's own choice. This is
  // the test that matters — it fails against the unconditional reseed the
  // first fix shipped, which stomped this slot on every single load.
  it("survives a deliberately chosen, non-default-attack skill in the mouse slot across a load", async () => {
    const kv = await withOneCharacter("class.ironsworn");
    const world = fresh();
    await loadCharacterInto(kv, world, "vess");
    // Level 8, so skill.cinder_ground.v1 is legitimately unlocked: restore() now
    // runs the whole bar through the same unlock filter setSkillBar does, so a
    // locked (or still-START_LEVEL) choice here would be indistinguishable from
    // the hostile-save case this fix is guarding against.
    set<ProgressC>(world, "progress", { ...get<ProgressC>(world, "progress"), level: 8 });
    const skills = get<SkillsC>(world, "skills");
    const customBar = [...skills.bar];
    // Not any class's default attack — a real, deliberate choice.
    customBar[MOUSE_SLOT_BASE + 2] = "skill.cinder_ground.v1";
    set<SkillsC>(world, "skills", { ...skills, bar: customBar });
    await saveCharacterTo(kv, world, "vess");

    const reboot = fresh();
    await loadCharacterInto(kv, reboot, "vess");
    expect(get<SkillsC>(reboot, "skills").bar[MOUSE_SLOT_BASE + 2]).toBe("skill.cinder_ground.v1");
  });

  // setSkillBar makes the mouse-right slot player-writable, including a
  // cross-class basic attack — a legal choice the old structural heuristic
  // ("some class's default attack that isn't mine") could not tell apart from
  // the seeding bug it existed to catch. This fails against that heuristic:
  // Snap Shot IS a class's default attack, so an unflagged reseed would stomp
  // it back to Strike on this second load.
  it("survives a deliberate cross-class basic attack across a second load", async () => {
    const kv = await withOneCharacter("class.ironsworn");
    const world = fresh();
    // First load: the one-shot repair runs and sets attackReseeded.
    await loadCharacterInto(kv, world, "vess");
    const skills = get<SkillsC>(world, "skills");
    expect(skills.attackReseeded).toBe(true);
    const chosenBar = [...skills.bar];
    chosenBar[MOUSE_SLOT_BASE + 2] = defaultAttackFor("class.stalker"); // "skill.snap_shot.v1"
    set<SkillsC>(world, "skills", { ...skills, bar: chosenBar });
    await saveCharacterTo(kv, world, "vess");

    const reboot = fresh();
    await loadCharacterInto(kv, reboot, "vess");
    expect(get<SkillsC>(reboot, "skills").bar[MOUSE_SLOT_BASE + 2]).toBe("skill.snap_shot.v1");
  });

  it("round-trips one character's progress", async () => {
    const kv = await withOneCharacter();
    const world = fresh();
    await loadCharacterInto(kv, world, "vess");
    set<SessionC>(world, "session", { ...get<SessionC>(world, "session"), completedNodes: ["node-x"] });
    set<ProgressC>(world, "progress", { level: 9, xp: 40, gold: 12 });
    await saveCharacterTo(kv, world, "vess");

    const reboot = fresh();
    expect(await loadCharacterInto(kv, reboot, "vess")).toBe(true);
    expect(get<SessionC>(reboot, "session").completedNodes).toEqual(["node-x"]);
    expect(get<ProgressC>(reboot, "progress").level).toBe(9);
  });

  it("refreshes the row's level so the select screen is never stale", async () => {
    const kv = await withOneCharacter();
    const world = fresh();
    await loadCharacterInto(kv, world, "vess");
    set<ProgressC>(world, "progress", { level: 23, xp: 0, gold: 0 });
    await saveCharacterTo(kv, world, "vess");
    expect(findCharacter(await openRoster(kv, NOW), "vess")!.level).toBe(23);
  });

  it("shares one stash between characters and keeps inventories apart", async () => {
    const kv = new MemoryKv();
    let roster = addCharacter(emptyRoster(), makeCharacterRecord({ name: "Vess", classId: DEFAULT_CLASS_ID }, "vess", NOW), 8);
    roster = addCharacter(roster, makeCharacterRecord({ name: "Toren", classId: DEFAULT_CLASS_ID }, "toren", NOW), 8);
    await saveRoster(kv, roster);

    // Vess puts something in the stash and something in her own backpack.
    const vess = fresh();
    await loadCharacterInto(kv, vess, "vess");
    const stashed = get<StashC>(vess, "stash");
    const item = { baseId: "base.cinder_cap", rarity: "normal" as const, itemLevel: 1, affixes: [] };
    set<StashC>(vess, "stash", { ...stashed, items: [{ x: 0, y: 0, w: 2, h: 2, item }] });
    const inv = get<InventoryC>(vess, "inventory");
    set<InventoryC>(vess, "inventory", { ...inv, items: [{ x: 0, y: 0, w: 2, h: 2, item }] });
    await saveCharacterTo(kv, vess, "vess");

    // Toren sees the stash, not the backpack. (A fresh character's backpack is
    // not empty — it holds the starting waystones — so the check is that Vess's
    // cap did not follow him, not that he owns nothing.)
    const toren = fresh();
    await loadCharacterInto(kv, toren, "toren");
    expect(get<StashC>(toren, "stash").items).toHaveLength(1);
    expect(get<InventoryC>(toren, "inventory").items.map((p) => p.item.baseId))
      .not.toContain("base.cinder_cap");
  });

  it("saving an id the roster does not hold writes nothing", async () => {
    const kv = await withOneCharacter();
    const before = await kv.load();
    await saveCharacterTo(kv, fresh(), "nobody");
    expect(await kv.load()).toBe(before);
  });

  it("a migrated character loads and keeps playing", async () => {
    const kv = new MemoryKv();
    const world = fresh();
    set<ProgressC>(world, "progress", { level: 14, xp: 0, gold: 0 });
    await saveTo(kv, world);           // the old single-save world
    const roster = await openRoster(kv, NOW);
    await saveRoster(kv, roster);      // migration committed

    const reboot = fresh();
    expect(await loadCharacterInto(kv, reboot, MIGRATED_CHARACTER_ID)).toBe(true);
    expect(get<ProgressC>(reboot, "progress").level).toBe(14);
  });
});
