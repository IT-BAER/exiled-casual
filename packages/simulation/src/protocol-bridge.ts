import { fp, toNumber, fpDist2 } from "@exiled/fixed-point";
import { PICKUP_RADIUS } from "@exiled/protocol";
import type { DisplaySkill, Intent, Snapshot, SnapshotEntity, MonsterElement } from "@exiled/protocol";
import { damageTypeOf } from "./damage-types";
import { VENDOR_COLS, VENDOR_ROWS } from "./vendor";
import { physicalMitigationPct, scalePct, xpToNext, START_LEVEL, vendorBuyPrice } from "@exiled/rules";
import { resBlock } from "@exiled/content-schema";
import { describeItem, SKILLS } from "@exiled/content-runtime";
import type { Command, Simulation } from "./loop";
import type { World, Entity } from "./ecs";
import type {
  Health, Mana, Position, Cooldowns, CastingC, MonsterC,
  AilmentC, ProjectileC, GroundAreaC, BossC, TelegraphC,
  SessionC, InteractableC, ItemC, InventoryC, StashC, VendorC, EquipmentC, FlasksC, DefensesC, OffenseC, ProgressC,
  EnergyShieldC, ShardsC, MoveDir,
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
        atlasNodeId: intent.atlasNodeId, data: { x: intent.x, y: intent.y },
      };
    case "pickupItem":
      return { tick, entity: player, type: "pickupItem", data: { entityId: intent.entityId } };
    case "equipItem":
      return { tick, entity: player, type: "equipItem", data: { x: intent.x, y: intent.y }, slot: intent.slot };
    case "applyCurrency":
      return {
        tick, entity: player, type: "applyCurrency",
        data: { fromX: intent.fromX, fromY: intent.fromY, x: intent.x, y: intent.y },
      };
    case "unequipItem":
      return { tick, entity: player, type: "unequipItem", slot: intent.slot };
    case "dropItem":
      return { tick, entity: player, type: "dropItem", data: { x: intent.x, y: intent.y } };
    case "moveItem":
      return {
        tick, entity: player, type: "moveItem",
        data: {
          x: intent.x, y: intent.y, toX: intent.toX, toY: intent.toY,
          // `data` is numbers-only; 0 = backpack, 1 = stash. Omitted when the move
          // stays in the backpack, so an older recording produces the same command.
          ...(intent.from === "stash" ? { from: 1 } : {}),
          ...(intent.to === "stash" ? { to: 1 } : {}),
        },
      };
    case "useFlask":
      return { tick, entity: player, type: "useFlask", flask: intent.slot };
    case "sellItem":
      return {
        tick, entity: player, type: "sellItem",
        data: {
          x: intent.x, y: intent.y,
          // Omitting `from` for backpack so a sell recorded before stash existed
          // replays byte-identically, mirroring moveItem's convention.
          ...(intent.from === "stash" ? { from: 1 } : {}),
        },
      };
    case "buyItem":
      return { tick, entity: player, type: "buyItem", data: { x: intent.x, y: intent.y } };
    case "usePortalScroll":
      return { tick, entity: player, type: "usePortalScroll" };
    case "revive":
      // `data` is numbers-only, so the choice rides as a flag rather than a word.
      return {
        tick, entity: player, type: "revive",
        data: { checkpoint: intent.where === "checkpoint" ? 1 : 0 },
      };
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10;
const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Every skill as its tooltip reads it. The numbers are recomputed here with the
 * same formulas skillCast uses, and deliberately here rather than in the client:
 * the tooltip has to promise exactly what the cast will do, and the client can
 * see neither OffenseC nor the fixed-point content.
 */
function describeSkills(offense: OffenseC | undefined): DisplaySkill[] {
  const castSpeedPct = offense?.castSpeedPct ?? 0;
  const spellDamagePct = offense?.spellDamagePct ?? 0;
  const out: DisplaySkill[] = [];
  for (const def of SKILLS.values()) {
    // Same floor skillCast applies: a cast never drops below one tick.
    const castTicks = def.castTicks
      ? Math.max(1, Math.trunc((def.castTicks * 100) / (100 + castSpeedPct)))
      : 0;
    const castTimeSec = castTicks / 30;
    const lines: string[] = [];
    let hitDamage = 0;
    for (const effect of def.effects) {
      if (effect.type === "spawnProjectile" && effect.damage) {
        const dmg = toNumber(scalePct(effect.damage.amountFixed, spellDamagePct));
        hitDamage += dmg;
        lines.push(`Deals ${round1(dmg)} ${titleCase(effect.damage.type)} Damage`);
      } else if (effect.type === "spawnGroundArea") {
        if (effect.ailment) {
          lines.push(
            `Deals ${round1(toNumber(effect.ailment.dpsFixed))} ${titleCase(effect.ailment.kind)} Damage per Second`,
          );
        }
        lines.push(`Base duration is ${round1(effect.durationTicks / 30)} seconds`);
      } else if (effect.type === "teleport") {
        lines.push(`Teleports ${round1(toNumber(effect.distanceFixed))} metres`);
      }
    }
    const skill: DisplaySkill = {
      id: def.id,
      name: def.name,
      description: def.description ?? "",
      manaCost: toNumber(def.manaCostFixed),
      castTimeSec,
      cooldownSec: def.cooldownTicks / 30,
      lines,
    };
    // No hit damage means no DPS column, the way PoE drops it for a movement skill.
    if (hitDamage > 0 && castTimeSec > 0) skill.dps = hitDamage / castTimeSec;
    out.push(skill);
  }
  return out;
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
    ?? { level: START_LEVEL, xp: 0, gold: 0 };

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
      species: mon.defId,
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
      // Nothing else in the snapshot says whose a bolt is, and the client has to
      // tell his own cast from a spitter's answer to sound either of them.
      team: pr.team,
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
      unidentified: d.unidentified,
      inRange: inRangeOf(pp.x, pp.y, ip.x, ip.y, PICKUP_RADIUS),
    });
  }

  entities.sort((a, b) => a.id - b.id);

  const describeGrid = (g: InventoryC | undefined, cols: number, rows: number): Snapshot["inventory"] => ({
    cols: g?.cols ?? cols,
    rows: g?.rows ?? rows,
    items: (g?.items ?? []).map((p) => {
      const d = describeItem(p.item);
      return {
        x: p.x, y: p.y, w: p.w, h: p.h, count: p.count,
        rarity: d.rarity, name: d.name, baseName: d.baseName, itemClass: d.itemClass, implicit: d.implicit, lines: d.lines, flavour: d.flavour, icon: d.icon, unidentified: d.unidentified, baseId: p.item.baseId,
        statLines: d.statLines, reqLevel: d.reqLevel, reqAttrValue: d.reqAttrValue, reqAttr: d.reqAttr,
        waystone: d.waystone,
      };
    }),
  });
  const inventory = describeGrid(sessionE !== undefined ? world.get<InventoryC>(sessionE, "inventory") : undefined, 12, 5);
  const stash = describeGrid(sessionE !== undefined ? world.get<StashC>(sessionE, "stash") : undefined, 12, 12);
  // The shelf carries its price per cell: the client shows the number, the sim
  // owns it, and the two can never disagree about what a piece costs.
  const shelf = sessionE !== undefined ? world.get<VendorC>(sessionE, "vendor") : undefined;
  const shelfGrid = describeGrid(shelf, VENDOR_COLS, VENDOR_ROWS);
  const vendor: Snapshot["vendor"] = {
    cols: shelfGrid.cols,
    rows: shelfGrid.rows,
    // describeGrid preserves order, so index i is the same placed item in both.
    items: shelfGrid.items.map((d, i) => ({ ...d, price: vendorBuyPrice(shelf!.items[i]!.item) })),
  };

  const equipC = sessionE !== undefined ? world.get<EquipmentC>(sessionE, "equipment") : undefined;
  const equipment: Snapshot["equipment"] = {};
  if (equipC) {
    for (const [slot, item] of Object.entries(equipC.slots)) {
      if (item === undefined) continue;
      const d = describeItem(item);
      equipment[slot as keyof typeof equipment] = {
        rarity: d.rarity, name: d.name, baseName: d.baseName, itemClass: d.itemClass,
        implicit: d.implicit, lines: d.lines, flavour: d.flavour, icon: d.icon, unidentified: d.unidentified,
        statLines: d.statLines, reqLevel: d.reqLevel, reqAttrValue: d.reqAttrValue, reqAttr: d.reqAttr,
        // The renderer dresses the character from this: each base has its own
        // armour texture, baked from that base's inventory icon.
        baseId: item.baseId,
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
      heading: (() => {
        const d = world.get<MoveDir>(playerEntity, "moveDir");
        return d && (d.hx !== 0 || d.hy !== 0) ? { x: toNumber(d.hx), y: toNumber(d.hy) } : undefined;
      })(),
      level: progress.level,
      xp: progress.xp,
      xpToNext: xpToNext(progress.level),
      gold: progress.gold,
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
      critChancePct: world.get<OffenseC>(playerEntity, "offense")?.critChancePct ?? 0,
        };
      })(),
    },
    entities,
    inventory,
    stash,
    vendor,
    equipment,
    shards: (sessionE !== undefined ? world.get<ShardsC>(sessionE, "shards") : undefined)?.counts ?? {},
    skills: describeSkills(world.get<OffenseC>(playerEntity, "offense")),
  };
}
