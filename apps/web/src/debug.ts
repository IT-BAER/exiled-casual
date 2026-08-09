import type { Snapshot, SnapshotEntity } from "@exiled/protocol";

/**
 * What happened, said out loud in the console.
 *
 * Off by default and behind `ui.debugLogging`, because this is a firehose: it is
 * for the session where something went wrong and "it just didn't drop" needs a
 * timeline, not for everyday play.
 *
 * Same discipline as `audio/soundscape.ts` and for the same reason: the client is
 * given snapshots, not events, so a line here is a DIFFERENCE between two of them
 * and can never claim something the sim did not do. The one exception is the
 * intents, which are logged where they are sent — a click is not a change to the
 * world yet, and half the point of the log is seeing an intent the sim refused.
 *
 * Channels are a plain string prefix rather than a filter here: `console.debug`
 * already has a filter box, and per-channel toggles can be added the day the box
 * is not enough.
 */

let on = false;

export function setDebugLogging(enabled: boolean): void {
  on = enabled;
}

export function isDebugLogging(): boolean {
  return on;
}

/** One line, `[channel] ...`, or nothing at all when the option is off. */
export function dlog(channel: string, ...args: unknown[]): void {
  if (!on) return;
  console.debug(`[${channel}]`, ...args);
}

/** Two decimals. A life total printed to fifteen digits is a wall, not a reading. */
function n(v: number): number {
  return Math.round(v * 100) / 100;
}

function label(e: SnapshotEntity): string {
  return e.species ?? e.name ?? e.kind;
}

/**
 * A logger fed every snapshot, in arrival order, that reports what changed since
 * the one before it. Keeps its own previous snapshot: nothing else has to hold
 * state for a debug option.
 *
 * A new area (or a tick that went backwards) is not a diff — every id is new, and
 * diffing across it would report the whole population as dead — so it prints the
 * crossing and starts over.
 */
export function createDebugSnapshotLog(): (snap: Snapshot) => void {
  let prev: Snapshot | null = null;
  return (snap: Snapshot): void => {
    if (!on) { prev = snap; return; }
    const before = prev;
    prev = snap;
    if (before === null) return;
    if (before.area !== snap.area || snap.tick < before.tick) {
      dlog("area", `entered ${snap.area}`, { tick: snap.tick, tier: snap.areaTier });
      return;
    }
    const p = snap.player;
    const q = before.player;

    for (const e of before.entities) {
      if (!snap.entities.some((x) => x.id === e.id)) {
        if (e.kind === "monster") dlog("kill", label(e), { id: e.id, x: n(e.x), y: n(e.y) });
        else if (e.kind === "groundItem") dlog("loot", `picked up ${label(e)}`, { id: e.id });
      }
    }
    for (const e of snap.entities) {
      if (before.entities.some((x) => x.id === e.id)) continue;
      if (e.kind === "groundItem") {
        dlog("loot", `dropped ${label(e)}`, { rarity: e.rarity, x: n(e.x), y: n(e.y) });
      } else if (e.kind === "monster") {
        dlog("spawn", label(e), { id: e.id, boss: e.boss, rare: e.rare, x: n(e.x), y: n(e.y) });
      }
    }

    if (p.life !== q.life || p.energyShield !== q.energyShield) {
      dlog("player", "pools", {
        life: `${n(p.life)}/${n(p.maxLife)}`, dLife: n(p.life - q.life),
        es: `${n(p.energyShield)}/${n(p.maxEnergyShield)}`,
      });
    }
    if (p.alive !== q.alive) dlog("player", p.alive ? "revived" : "died", { tick: snap.tick });
    if (p.level !== q.level) dlog("player", `level ${q.level} -> ${p.level}`);
    if (p.xp !== q.xp) dlog("xp", `+${n(p.xp - q.xp)}`, { xp: p.xp, toNext: p.xpToNext });
    if (p.gold !== q.gold) dlog("gold", `${p.gold - q.gold > 0 ? "+" : ""}${p.gold - q.gold}`, { gold: p.gold });
    if (p.flasks.lifeCharges !== q.flasks.lifeCharges || p.flasks.manaCharges !== q.flasks.manaCharges) {
      dlog("flask", "charges", { life: p.flasks.lifeCharges, mana: p.flasks.manaCharges });
    }
    // A cooldown only ever RISES on a cast the sim accepted, which is the one
    // honest signal that a press became a spell (see soundscape.ts).
    for (const [skillId, remaining] of Object.entries(p.cooldowns)) {
      if (remaining > (q.cooldowns[skillId] ?? 0)) dlog("cast", skillId, { cooldown: remaining });
    }
    if (snap.inventory.items.length !== before.inventory.items.length) {
      dlog("inventory", `${before.inventory.items.length} -> ${snap.inventory.items.length} items`);
    }
    if (snap.mapOpen !== before.mapOpen) dlog("map", snap.mapOpen ? "opened" : "closed", { tier: snap.areaTier });
    if (snap.portalsLeft !== before.portalsLeft) dlog("map", "portals left", snap.portalsLeft);
    if (snap.completedNodes.length !== before.completedNodes.length) {
      dlog("map", "completed", snap.completedNodes[snap.completedNodes.length - 1]);
    }
  };
}
