import { toNumber, fpDist2 } from "@pact/fixed-point";
import type { Intent, Snapshot, SnapshotEntity } from "@pact/protocol";
import type { Command, Simulation } from "./loop";
import type { World, Entity } from "./ecs";
import type {
  Health, Mana, Position, Cooldowns, MonsterC,
  AilmentC, ProjectileC, GroundAreaC, BossC, TelegraphC,
  SessionC, InteractableC,
} from "./components";

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

  const cooldowns: Record<string, number> = {};
  for (const [skillId, readyTick] of Object.entries(rawCds)) {
    cooldowns[skillId] = Math.max(0, (readyTick - tick) / 30);
  }

  // Session singleton (optional; legacy sims without one default to "map", 0, false).
  const sessionE = world.query("session")[0];
  const session = sessionE !== undefined
    ? world.get<SessionC>(sessionE, "session")
    : undefined;

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

  entities.sort((a, b) => a.id - b.id);

  return {
    tick,
    area: session?.area ?? "map",
    portalsLeft: session?.portalsLeft ?? 0,
    mapOpen: session?.mapOpen === 1,
    player: {
      id: playerEntity,
      x: toNumber(pp.x), y: toNumber(pp.y),
      life: toNumber(ph.life), maxLife: toNumber(ph.maxLife),
      mana: toNumber(pm.mana), maxMana: toNumber(pm.maxMana),
      cooldowns,
      alive: ph.life > 0,
    },
    entities,
  };
}
