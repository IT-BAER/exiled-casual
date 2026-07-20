import type { World, Entity } from "./ecs";
import type { Fixed } from "@pact/fixed-point";
import type { MonsterC, PlayerC } from "./components";

/** Body radius of any entity, whatever component carries it. */
export function bodyRadiusOf(world: World, e: Entity): Fixed {
  const mon = world.get<MonsterC>(e, "monster");
  if (mon) return mon.bodyRadius;
  const player = world.get<PlayerC>(e, "player");
  if (player) return player.bodyRadius;
  return 0;
}
