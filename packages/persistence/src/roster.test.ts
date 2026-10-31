import { describe, it, expect } from "vitest";
import { MemoryKv } from "./index";
import {
  ROSTER_VERSION,
  LOCAL_CHARACTER_CAP,
  emptyRoster,
  headers,
  findCharacter,
  isNameTaken,
  nameError,
  nameKey,
  nameWidth,
  normalizeName,
  addCharacter,
  removeCharacter,
  putCharacterState,
  touchLastPlayed,
  putStash,
  putSettings,
  loadRoster,
  saveRoster,
  readBlob,
  asRoster,
  type CharacterRecord,
  type RosterBlob,
} from "./roster";

function rec(name: string, id = name.toLowerCase()): CharacterRecord {
  return {
    id, name, classId: "class.stalker", level: 1, league: "Local",
    createdAt: 1_700_000_000_000, state: null,
  };
}

describe("roster", () => {
  it("starts empty at the current version", () => {
    const r = emptyRoster();
    expect(r.version).toBe(ROSTER_VERSION);
    expect(r.characters).toEqual([]);
    expect(r.lastPlayedId).toBeUndefined();
  });

  it("adds a character and points lastPlayed at it", () => {
    const r = addCharacter(emptyRoster(), rec("Vess"), 8);
    expect(r.characters).toHaveLength(1);
    expect(r.lastPlayedId).toBe("vess");
    expect(findCharacter(r, "vess")?.name).toBe("Vess");
  });

  it("refuses to add past the cap", () => {
    const one = addCharacter(emptyRoster(), rec("Vess"), LOCAL_CHARACTER_CAP);
    expect(() => addCharacter(one, rec("Toren"), LOCAL_CHARACTER_CAP)).toThrow(/full/);
  });

  it("holds many when the cap allows it — the cap is policy, not shape", () => {
    let r = emptyRoster();
    for (const n of ["Vess", "Toren", "Ash", "Kell"]) r = addCharacter(r, rec(n), 8);
    expect(r.characters).toHaveLength(4);
  });

  it("refuses a duplicate name regardless of case", () => {
    const one = addCharacter(emptyRoster(), rec("Vess"), 8);
    expect(isNameTaken(one, "vess")).toBe(true);
    expect(() => addCharacter(one, rec("VESS", "other"), 8)).toThrow(/taken/);
  });

  it("headers drop the saves so a list never carries eleven inventories", () => {
    const r = putCharacterState(addCharacter(emptyRoster(), rec("Vess"), 8), "vess", { big: "blob" }, 12);
    const [h] = headers(r);
    expect(h).toBeDefined();
    expect(h).not.toHaveProperty("state");
    // The level the row shows is the one the save was written with.
    expect(h!.level).toBe(12);
    expect(findCharacter(r, "vess")?.state).toEqual({ big: "blob" });
  });

  it("removing the last-played character re-points lastPlayed instead of dangling", () => {
    let r = addCharacter(emptyRoster(), rec("Vess"), 8);
    r = addCharacter(r, rec("Toren"), 8);
    r = touchLastPlayed(r, "toren");
    r = removeCharacter(r, "toren");
    expect(r.characters.map((c) => c.id)).toEqual(["vess"]);
    expect(r.lastPlayedId).toBe("vess");
  });

  it("removing the only character leaves a valid empty roster", () => {
    const r = removeCharacter(addCharacter(emptyRoster(), rec("Vess"), 8), "vess");
    expect(r.characters).toEqual([]);
    expect(r.lastPlayedId).toBeUndefined();
    expect(asRoster(JSON.parse(JSON.stringify(r)))).not.toBeNull();
  });

  it("removing an unknown id changes nothing", () => {
    const r = addCharacter(emptyRoster(), rec("Vess"), 8);
    expect(removeCharacter(r, "nobody").characters).toHaveLength(1);
  });

  it("keeps the stash outside every character", () => {
    const r = putStash(addCharacter(emptyRoster(), rec("Vess"), 8), { cols: 12, rows: 12, items: [] });
    expect(r.stash).toEqual({ cols: 12, rows: 12, items: [] });
    expect(findCharacter(r, "vess")?.state).toBeNull();
  });

  describe("names", () => {
    const r = addCharacter(emptyRoster(), rec("Vess"), 8);
    it("rejects too short, too long, bad characters and duplicates", () => {
      expect(nameError(r, "Vo")).toMatch(/At least/);
      expect(nameError(r, "V".repeat(21))).toMatch(/At most/);
      expect(nameError(r, "9lives")).toMatch(/Letters/);
      expect(nameError(r, "Kell Ward")).toMatch(/Letters/);
      expect(nameError(r, "vess")).toMatch(/taken/);
    });
    it("accepts a plain name", () => {
      expect(nameError(r, "Toren_2")).toBeNull();
    });

    it("accepts letters of any script, with their marks", () => {
      for (const name of ["José", "Jürgen", "Łukasz", "李小龍", "Δημήτρης", "Ольга", "さくら", "민준", "देवेन्द्र", "สมชาย", " Ærin "]) {
        expect(nameError(r, name), name).toBeNull();
      }
    });

    it("normalises to NFC, so a decomposed accent is the same name as a composed one", () => {
      expect(normalizeName("Jose\u0301")).toBe("José");
      expect(normalizeName("  Jose\u0301 ")).toBe(normalizeName("José"));
      expect(nameError(r, "Jose\u0301")).toBeNull();
    });

    it("rejects control, bidi-override, zero-width and space characters, and a leading mark", () => {
      for (const name of ["Ves\u202Es", "Vess\u202E", "Ve\u2066ss", "Ve\u200Bss", "Ve\u200Dss", "Ve\u200Css",
        "Ve\uFEFFss", "Vess\u0007", "Ve\u00ADss", "Jo\u00A0se", "\u0301abc", "Kell\u3000Ward"]) {
        expect(nameError(r, name), JSON.stringify(name)).toMatch(/Letters/);
      }
    });

    it("rejects a letter stacked with marks (zalgo)", () => {
      expect(nameError(r, "Za\u0300\u0301\u0302\u0303\u0304\u0305\u0306lgo")).toMatch(/Letters/);
    });

    it("measures length in letters as drawn, a CJK letter counting double", () => {
      expect(nameWidth("José")).toBe(4);
      expect(nameWidth("Jose\u0301")).toBe(4);
      expect(nameWidth("李明")).toBe(4);
      expect(nameWidth("देवी")).toBe(2);
      // Two-letter Chinese names are common; one letter is not a name.
      expect(nameError(r, "李明")).toBeNull();
      expect(nameError(r, "李")).toMatch(/At least/);
      expect(nameError(r, "李".repeat(10))).toBeNull();
      expect(nameError(r, "李".repeat(11))).toMatch(/At most/);
      // Twenty letters stay twenty whatever their encoding.
      expect(nameError(r, "e\u0301".repeat(20))).toBeNull();
      expect(nameError(r, "कि".repeat(20))).toBeNull();
      expect(nameError(r, "é".repeat(21))).toMatch(/At most/);
    });

    it("treats case, width and compatibility forms as the same name, across scripts", () => {
      const many = [rec("Straße", "a"), rec("Ольга", "b"), rec("Οδυσσευς", "c"), rec("José", "d")]
        .reduce((acc, c) => addCharacter(acc, c, 8), r);
      for (const name of ["VESS", "Ｖｅｓｓ", "STRASSE", "ОЛЬГА", "ΟΔΥΣΣΕΥΣ", "Jose\u0301", "JOSÉ"]) {
        expect(nameError(many, name), name).toMatch(/taken/);
      }
      expect(nameKey("Vess")).toBe(nameKey("vess"));
    });

    it("still reads names saved under the old ASCII rule", () => {
      const old = asRoster(JSON.parse(JSON.stringify(addCharacter(emptyRoster(), rec("Toren_2"), 8))));
      expect(old?.characters[0]?.name).toBe("Toren_2");
      expect(isNameTaken(old!, "toren_2")).toBe(true);
    });
  });

  describe("storage", () => {
    it("round-trips through a KvStore", async () => {
      const kv = new MemoryKv();
      const r = addCharacter(emptyRoster(), rec("Vess"), 8);
      await saveRoster(kv, r);
      expect(await loadRoster(kv)).toEqual(r);
    });

    it("reads nothing saved as null", async () => {
      expect(await loadRoster(new MemoryKv())).toBeNull();
    });

    it("reads a corrupt blob as null rather than throwing on boot", async () => {
      const kv = new MemoryKv();
      await kv.save("{not json");
      expect(await readBlob(kv)).toBeNull();
      expect(await loadRoster(kv)).toBeNull();
    });

    it("does not mistake an older single-character save for a roster", async () => {
      const kv = new MemoryKv();
      await kv.save(JSON.stringify({ version: 2, session: {}, inventory: {} }));
      expect(await loadRoster(kv)).toBeNull();
      // ...but the raw blob is still readable, which is what migration needs.
      expect(await readBlob(kv)).toMatchObject({ version: 2 });
    });
  });
});

describe("settings on the roster", () => {
  it("puts settings without touching the characters or the stash", () => {
    const base: RosterBlob = { ...emptyRoster(), stash: { grid: [] } };
    const next = putSettings(base, { sound: { muted: true } });
    expect(next.settings).toEqual({ sound: { muted: true } });
    expect(next.stash).toEqual(base.stash);
    expect(next.characters).toBe(base.characters);
    expect(base.settings).toBeUndefined(); // the input is not mutated
  });

  it("does not change the blob version, so an old save still loads", () => {
    const next = putSettings(emptyRoster(), { graphics: { bloom: false } });
    expect(next.version).toBe(ROSTER_VERSION);
    expect(ROSTER_VERSION).toBe(3);
  });

  it("reads a v3 blob that has no settings key at all", () => {
    const old = { version: 3, characters: [] };
    const parsed = asRoster(old);
    expect(parsed).not.toBeNull();
    expect(parsed!.settings).toBeUndefined();
  });
});
