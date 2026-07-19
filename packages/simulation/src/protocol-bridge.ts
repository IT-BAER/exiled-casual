import { toNumber } from "@pact/fixed-point";
import type { Intent, Snapshot, SnapshotEntity } from "@pact/protocol";
import type { Command, Simulation } from "./loop";
import type { World, Entity } from "./ecs";
import type {
  Health, Mana, Position, Cooldowns, MonsterC,
  AilmentC, ProjectileC, GroundAreaC,
} from "./components";

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

  entities.sort((a, b) => a.id - b.id);

  return {
    tick,
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
