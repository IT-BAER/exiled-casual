import { describe, it, expect } from "vitest";
import { fp } from "@exiled/fixed-point";
import {
  buildSnapshot,
  intentToCommand,
  type Position,
  type Health,
  type BossC,
  type TelegraphC,
} from "@exiled/simulation";
import { CONTENT_VERSION } from "@exiled/content-runtime";
import type { Intent } from "@exiled/protocol";
import { firstDifference } from "../index";
import {
  BOSS_SEED,
  buildBossArena,
  runBossReplay,
  boltSpamCommands,
  summonedCount,
} from "./boss";

describe("boss golden (a): deterministic replay", () => {
  it("two runs with the same seed and command log yield identical checksums", () => {
    const { playerEntity } = buildBossArena(BOSS_SEED);
    const cmds = boltSpamCommands(playerEntity, 150);

    const run1 = runBossReplay(cmds, 150);
    const run2 = runBossReplay(cmds, 150);

    expect(run1.checksums).toHaveLength(150);
    expect(firstDifference(run1.checksums, run2.checksums)).toBeNull();
  });
});

describe("boss golden (b): phase-2 transition is command-driven", () => {
  it("bolts drive the warden under the threshold; it flips to phase 2 and summons its adds", () => {
    const { playerEntity } = buildBossArena(BOSS_SEED, { nearPhase2: true });
    const cmds = boltSpamCommands(playerEntity, 90);
    const r = runBossReplay(cmds, 90, { nearPhase2: true });

    const boss = r.finalSnapshot.entities.find((e) => e.boss);
    expect(boss).toBeDefined();
    expect(boss!.bossPhase).toBe(2);
    // addCount = 2 imps spawned on the phase-2 transition.
    expect(summonedCount(r.world)).toBe(2);
  });
});

describe("boss golden (c): slam telegraph deals damage on impact", () => {
  it("a player inside the slam radius loses life when the telegraph resolves", () => {
    const a = buildBossArena(BOSS_SEED);
    // Stand inside slam range (boss at (0,12), range 9) so it slams immediately.
    a.world.set<Position>(a.playerEntity, "position", { x: fp(0), y: fp(6) });

    const before = a.world.get<Health>(a.playerEntity, "health")!.life;
    // windupTicks = 30; step past the impact tick.
    for (let t = 0; t < 36; t++) a.sim.step([]);
    const after = a.world.get<Health>(a.playerEntity, "health")!.life;

    expect(after).toBeLessThan(before);
  });
});

describe("boss golden (e): every boss's kit replays the same through its third phase", () => {
  const PHASE3_ABILITY: Record<string, string> = {
    "monster.cinder_warden.v1": "cinder_rain",
    "monster.sirrath.v1": "sunlance",
    "monster.mother_vhal.v1": "bog_geyser",
    "monster.ghaltrek.v1": "briar_nova",
  };
  it.each(Object.entries(PHASE3_ABILITY))("%s reaches phase 3, casts %s, and two runs agree", (species, ability) => {
    const opts = { species, nearPhase3: true };
    const a = buildBossArena(BOSS_SEED, opts);
    // The bolt released in these ticks pushes it over the line; then the boss fights on alone.
    const cmds = boltSpamCommands(a.playerEntity, 18);
    const seen = new Set<string>();
    for (let t = 0; t < 600; t++) {
      a.sim.step(cmds[t] ?? []);
      for (const e of a.world.query("telegraph")) seen.add(a.world.get<TelegraphC>(e, "telegraph")!.ability ?? "slam");
    }
    expect(a.world.get<BossC>(a.bossId, "boss")!.phase).toBe(3);
    expect([...seen]).toContain(ability);

    const run1 = runBossReplay(cmds, 600, opts);
    const run2 = runBossReplay(cmds, 600, opts);
    expect(firstDifference(run1.checksums, run2.checksums)).toBeNull();
  });
});

describe("boss golden (d): reset tears down the boss encounter", () => {
  it("activating the return portal removes the boss, its adds, and any telegraphs", () => {
    const a = buildBossArena(BOSS_SEED, { nearPhase2: true });
    // Long enough to reach phase 2 at the bolt's own rate: the setup here is a
    // live encounter with adds, and the assertion is what the portal tears down.
    const cmds = boltSpamCommands(a.playerEntity, 120);
    for (let t = 0; t < 120; t++) a.sim.step(cmds[t] ?? []);

    // Precondition: a live phase-2 encounter with adds.
    expect(a.world.query("boss")).toHaveLength(1);
    expect(summonedCount(a.world)).toBe(2);

    // Stand on the return portal and activate it (avoids a perilous walk through the fight).
    a.world.set<Position>(a.playerEntity, "position", { x: fp(0), y: fp(-5) });
    const interact: Intent = { kind: "interact", targetId: a.portalId };
    a.sim.step([intentToCommand(interact, a.playerEntity, 60)]);

    // interact sets pendingArea, areaTransition (same tick) tears the map down.
    expect(a.world.query("boss")).toHaveLength(0);
    expect(summonedCount(a.world)).toBe(0);
    expect(a.world.query("telegraph")).toHaveLength(0);

    const snap = buildSnapshot(a.world, a.sim, a.sim.tick, CONTENT_VERSION);
    expect(snap.area).toBe("hideout");
  });
});
