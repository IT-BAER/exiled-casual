import type { Snapshot } from "@exiled/protocol";

/**
 * The player a test starts from: level 65, full pools, no gear, standing on the
 * origin. Spread an override in for whatever the test is actually about.
 *
 * It lives here because every test that touches a snapshot needs a whole player
 * to build one, and seven copies of the same literal meant every new field on
 * `PlayerStats` broke seven files that did not care about it.
 */
export const testPlayer = (over: Partial<Snapshot["player"]> = {}): Snapshot["player"] => ({
  id: 0, x: 0, y: 0,
  life: 100, maxLife: 100, mana: 60, maxMana: 60,
  energyShield: 0, maxEnergyShield: 0,
  cooldowns: {}, alive: true, casting: false,
  level: 65, xp: 0, xpToNext: 60_000, gold: 0,
  flasks: { lifeCharges: 7, lifeMax: 7, manaCharges: 7, manaMax: 7 },
  stats: testStats(),
  ...over,
});

export const testStats = (over: Partial<Snapshot["player"]["stats"]> = {}): Snapshot["player"]["stats"] => ({
  armour: 0, armourPct: 0,
  res: { fire: 0, cold: 0, lightning: 0, chaos: 0 },
  manaRegenPerSec: 6,
  spellDamagePct: 0, castSpeedPct: 0, critChancePct: 0,
  ...over,
});
