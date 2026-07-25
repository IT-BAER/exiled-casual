import { fp, toNumber, fpDist2 } from "@exiled/fixed-point";
import { PICKUP_RADIUS } from "@exiled/protocol";
import type { Intent, Snapshot, SnapshotEntity, MonsterElement } from "@exiled/protocol";
import { damageTypeOf } from "./damage-types";
import { physicalMitigationPct, xpToNext, START_LEVEL } from "@exiled/rules";
import { resBlock } from "@exiled/content-schema";
import { describeItem } from "@exiled/content-runtime";
import type { Command, Simulation } from "./loop";
import type { World, Entity } from "./ecs";
import type {
  Health, Mana, Position, Cooldowns, CastingC, MonsterC,
  AilmentC, ProjectileC, GroundAreaC, BossC, TelegraphC,
  SessionC, InteractableC, ItemC, InventoryC, EquipmentC, FlasksC, DefensesC, OffenseC, ProgressC,
  EnergyShieldC,
} from "./components";

/**
 * Armour stops a different share of every hit size, so the character sheet's
 * single "Armour %" has to be quoted against one. PoE2 quotes a hit sized to
 * your level, which is why an endgame character there reads single digits; this
 * game's everyday hit is the Cinder Imp's fp(6) attack. Kept as a literal rather
 * than read from MONSTERS so removing a monster cannot silently move the sheet.
 */
const SHEET_REFERENCE_HIT = fp(6);

/**
 * Shared range check: is (px,py) within `radius` of (tx,ty)?
 * Both buildSnapshot (HUD inRange) and the interact system call this so they
 * can never disagree about whether an interactable is reachable.
 */
export function inRangeOf(
  px: number, py: number,
  tx: number, ty: number,
  radius: number,
): boolean {
  return fpDist2(px, py, tx, ty) <= radius * radius;
}

export function intentToCommand(intent: Intent, player: Entity, tick: number): Command {
  switch (intent.kind) {
    case "moveTo":
      return { tick, entity: player, type: "moveTo", data: { x: intent.x, y: intent.y } };
    case "moveDir":
      return { tick, entity: player, type: "moveDir", data: { dx: intent.dx, dy: intent.dy } };
    case "useSkill":
      return {
        tick, entity: player, type: "useSkill",
        skillId: intent.skillId,
        data: { tx: intent.tx, ty: intent.ty },
      };
    case "stop":
      return { tick, entity: player, type: "stop" };
    case "interact":
      return { tick, entity: player, type: "interact", data: { targetId: intent.targetId } };
    case "activateMap":
      return {
        tick, entity: player, type: "activateMap",
        atlasNodeId: intent.atlasNodeId, waystoneId: intent.waystoneId,
      };
    case "pickupItem":
      return { tick, entity: player, type: "pickupItem", data: { entityId: intent.entityId } };
    case "equipItem":
      return { tick, entity: player, type: "equipItem", data: { x: intent.x, y: intent.y }, slot: intent.slot };
    case "unequipItem":
      return { tick, entity: player, type: "unequipItem", slot: intent.slot };
    case "dropItem":
      return { tick, entity: player, type: "dropItem", data: { x: intent.x, y: intent.y } };
    case "useFlask":
      return { tick, entity: player, type: "useFlask", flask: intent.slot };
  }
}

// _contentVersion is part of the plan's declared signature but the Snapshot type
// carries no version field, so it is intentionally unused here.
export function buildSnapshot(
  world: World,
  _sim: Simulation,
  tick: number,
  _contentVersion: string,
): Snapshot {
  const playerEntity = world.query("player", "health", "mana", "position", "cooldowns")[0]!;

  const ph = world.get<Health>(playerEntity, "health")!;
  const pm = world.get<Mana>(playerEntity, "mana")!;
  const pp = world.get<Position>(playerEntity, "position")!;
  const rawCds = world.get<Cooldowns>(playerEntity, "cooldowns") ?? {};
  // Absent until some equipped mod grants a shield; the HUD reads 0/0 as "none".
  const pes = world.get<EnergyShieldC>(playerEntity, "energyShield");

  const cooldowns: Record<string, number> = {};
  for (const [skillId, readyTick] of Object.entries(rawCds)) {
    cooldowns[skillId] = Math.max(0, (readyTick - tick) / 30);
  }

  // Session singleton (optional; legacy sims without one default to "map", 0, false).
  const sessionE = world.query("session")[0];
  const session = sessionE !== undefined
    ? world.get<SessionC>(sessionE, "session")
    : undefined;

  // A legacy sim without a session has no progression to report; it reads as an
  // unlevelled character rather than as level 0.
  const progress = (sessionE !== undefined ? world.get<ProgressC>(sessionE, "progress") : undefined)
    ?? { level: START_LEVEL, xp: 0 };

  const entities: SnapshotEntity[] = [];

  for (const e of world.query("monster", "position", "health")) {
    const mp = world.get<Position>(e, "position")!;
    const mh = world.get<Health>(e, "health")!;
    const mon = world.get<MonsterC>(e, "monster")!;
    const ail = world.get<AilmentC>(e, "ailment");
    const entry: SnapshotEntity = {
      id: e,
      kind: "monster",
      x: toNumber(mp.x), y: toNumber(mp.y),
      life: toNumber(mh.life), maxLife: toNumber(mh.maxLife),
      rare: mon.rare === 1,
    };
    // Only a rare carries a theme; makeRare converts its whole hit to one
    // element, so the attack type IS the theme and nothing has to be stored.
    if (mon.rare === 1) entry.element = damageTypeOf(mon.attackType) as MonsterElement;
    if (ail !== undefined) entry.ailmentStacks = ail.stacks;
    if (world.has(e, "boss")) {
      const bc = world.get<BossC>(e, "boss")!;
      entry.boss = true;
      entry.bossPhase = bc.phase;
    }
    entities.push(entry);
  }

  for (const e of world.query("projectile", "position")) {
    const pp2 = world.get<Position>(e, "position")!;
    const pr = world.get<ProjectileC>(e, "projectile")!;
    entities.push({
      id: e, kind: "projectile",
      x: toNumber(pp2.x), y: toNumber(pp2.y),
      radius: toNumber(pr.radius),
    });
  }

  for (const e of world.query("groundArea", "position")) {
    const gp = world.get<Position>(e, "position")!;
    const ga = world.get<GroundAreaC>(e, "groundArea")!;
    entities.push({
      id: e, kind: "groundArea",
      x: toNumber(gp.x), y: toNumber(gp.y),
      radius: toNumber(ga.radius),
      remainingSeconds: (ga.expiryTick - tick) / 30,
    });
  }

  for (const e of world.query("telegraph", "position")) {
    const tp = world.get<Position>(e, "position")!;
    const tg = world.get<TelegraphC>(e, "telegraph")!;
    const raw = tg.impactTick === tg.startTick
      ? 1
      : (tick - tg.startTick) / (tg.impactTick - tg.startTick);
    entities.push({
      id: e, kind: "telegraph",
      x: toNumber(tp.x), y: toNumber(tp.y),
      radius: toNumber(tg.radius),
      progress: Math.min(1, Math.max(0, raw)),
    });
  }

  for (const e of world.query("interactable", "position")) {
    const ia = world.get<InteractableC>(e, "interactable")!;
    const pos = world.get<Position>(e, "position")!;
    entities.push({
      id: e,
      kind: ia.kind,
      x: toNumber(pos.x),
      y: toNumber(pos.y),
      yaw: ia.yaw,
      inRange: inRangeOf(pp.x, pp.y, pos.x, pos.y, ia.radius),
    });
  }

  for (const e of world.query("item", "position")) {
    const ip = world.get<Position>(e, "position")!;
    const ic = world.get<ItemC>(e, "item")!;
    const d = describeItem(ic.item);
    entities.push({
      id: e,
      kind: "groundItem",
      x: toNumber(ip.x), y: toNumber(ip.y),
      rarity: d.rarity,
      name: d.name,
      baseName: d.baseName,
      itemClass: d.itemClass,
      statLines: d.statLines,
      reqLevel: d.reqLevel,
      reqAttrValue: d.reqAttrValue,
      reqAttr: d.reqAttr,
      implicit: d.implicit,
      lines: d.lines,
      flavour: d.flavour,
      inRange: inRangeOf(pp.x, pp.y, ip.x, ip.y, PICKUP_RADIUS),
    });
  }

  entities.sort((a, b) => a.id - b.id);

  const invC = sessionE !== undefined ? world.get<InventoryC>(sessionE, "inventory") : undefined;
  const inventory = {
    cols: invC?.cols ?? 12,
    rows: invC?.rows ?? 5,
    items: (invC?.items ?? []).map((p) => {
      const d = describeItem(p.item);
      return {
        x: p.x, y: p.y, w: p.w, h: p.h,
        rarity: d.rarity, name: d.name, baseName: d.baseName, itemClass: d.itemClass, implicit: d.implicit, lines: d.lines, flavour: d.flavour, icon: d.icon,
        statLines: d.statLines, reqLevel: d.reqLevel, reqAttrValue: d.reqAttrValue, reqAttr: d.reqAttr,
      };
    }),
  };

  const equipC = sessionE !== undefined ? world.get<EquipmentC>(sessionE, "equipment") : undefined;
  const equipment: Snapshot["equipment"] = {};
  if (equipC) {
    for (const [slot, item] of Object.entries(equipC.slots)) {
      if (item === undefined) continue;
      const d = describeItem(item);
      equipment[slot as keyof typeof equipment] = {
        rarity: d.rarity, name: d.name, baseName: d.baseName, itemClass: d.itemClass,
        implicit: d.implicit, lines: d.lines, flavour: d.flavour, icon: d.icon,
        statLines: d.statLines, reqLevel: d.reqLevel, reqAttrValue: d.reqAttrValue, reqAttr: d.reqAttr,
      };
    }
  }

  return {
    tick,
    area: session?.area ?? "map",
    portalsLeft: session?.portalsLeft ?? 0,
    mapOpen: session?.mapOpen === 1,
    areaTier: session?.areaTier ?? 0,
    atlasSeed: session?.atlasSeed ?? 0,
    completedNodes: session?.completedNodes ?? [],
    waystones: (session?.waystones ?? []).map((w, i) => ({ id: `ws-${i}`, seed: w.seed, tier: w.tier })),
    player: {
      id: playerEntity,
      x: toNumber(pp.x), y: toNumber(pp.y),
      life: toNumber(ph.life), maxLife: toNumber(ph.maxLife),
      mana: toNumber(pm.mana), maxMana: toNumber(pm.maxMana),
      energyShield: toNumber(pes?.es ?? 0),
      maxEnergyShield: toNumber(pes?.maxEs ?? 0),
      cooldowns,
      alive: ph.life > 0,
      casting: (() => {
        const c = world.get<CastingC>(playerEntity, "casting");
        return c !== undefined && c.untilTick > tick;
      })(),
      flasks: (() => {
        const f = world.get<FlasksC>(playerEntity, "flasks");
        return f
          ? { lifeCharges: f.lifeCharges, lifeMax: f.lifeMax, manaCharges: f.manaCharges, manaMax: f.manaMax }
          : { lifeCharges: 0, lifeMax: 0, manaCharges: 0, manaMax: 0 };
      })(),
      level: progress.level,
      xp: progress.xp,
      xpToNext: xpToNext(progress.level),
      stats: (() => {
        // Read straight off the components recomputePlayerStats writes, so the
        // sheet can never disagree with what the systems actually use.
        const d = world.get<DefensesC>(playerEntity, "defenses");
        const armour = d?.armour ?? 0;
        return {
          armour: toNumber(armour),
          armourPct: physicalMitigationPct(armour, SHEET_REFERENCE_HIT),
          res: d?.res ?? resBlock(),
          manaRegenPerSec: toNumber(pm.regen * 30),
          spellDamagePct: world.get<OffenseC>(playerEntity, "offense")?.spellDamagePct ?? 0,
          castSpeedPct: world.get<OffenseC>(playerEntity, "offense")?.castSpeedPct ?? 0,
        };
      })(),
    },
    entities,
    inventory,
    equipment,
  };
}
