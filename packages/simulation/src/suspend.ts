import type { World, Entity } from "./ecs";

/**
 * A map left standing, because portals were left standing.
 *
 * Walking out of a map with portals to spare is not abandoning it — PoE1's rule,
 * and the whole reason the portal budget exists — so coming back has to find the
 * place as it was left: the pack you thinned still thinned, the chest you opened
 * still open, and the loot you could not carry still lying where it fell. It
 * used to find a brand new map wearing the same seed, which quietly made
 * "empty the bag and come back" the wrong move.
 *
 * It is a SNAPSHOT rather than a world left running. Nothing about a cleared
 * corridor changes while the player is in the hideout, so simulating it would
 * cost a second world's worth of ticks to compute a state that is already known.
 * That is what "without affecting performance" means here: leaving costs one
 * walk of the entity list, returning costs one more, and in between the map
 * costs exactly nothing.
 */
export interface SuspendedArea {
  /** The map this is, matched on the way back in. Both, because a re-rolled run
   *  at the same node is a different map and the same map can be re-run later. */
  mapSeed: number;
  activeNodeId: string;
  /** The tick it was left on, so cooldowns come back with the time they had
   *  left rather than with the hideout visit added to it. */
  tick: number;
  entities: readonly SuspendedEntity[];
}

type SuspendedEntity = readonly (readonly [string, unknown])[];

/**
 * Components that are a moment rather than a thing, and never come back.
 *
 * A bolt in flight, a patch of burning ground and a wind-up all describe
 * something happening AT a tick. Storing them would mean deciding what a
 * three-minute-old telegraph means, when the honest answer is that it is over —
 * so an entity carrying one is dropped whole, and an ailment is peeled off the
 * monster that was carrying it. Burning does not politely wait in a hallway.
 */
const TRANSIENT_ENTITY = ["projectile", "groundArea", "telegraph"];
const TRANSIENT_COMPONENT = ["ailment"];

/**
 * Absolute tick fields that have to be rebased on the way back, and what they
 * live on. Named explicitly rather than matched on a `*Tick` suffix, because
 * `lastAttackTick` is the same shape and means the opposite: it is a thing that
 * HAPPENED, and pushing it into the future would replay the swing.
 */
const REBASED: readonly { comp: string; fields: readonly string[] }[] = [
  { comp: "monster", fields: ["attackReadyTick", "slamReadyTick", "rootedUntilTick"] },
  { comp: "boss", fields: ["nextAbilityTick"] },
];

/**
 * Everything in the area except the player and the session, frozen.
 *
 * `keep` is the same set the area transition refuses to destroy, so this is the
 * exact population that is about to be thrown away.
 */
export function suspendArea(
  world: World,
  keep: ReadonlySet<Entity>,
  session: { mapSeed: number; activeNodeId: string },
  tick: number,
): SuspendedArea {
  const entities: SuspendedEntity[] = [];
  for (const e of world.query()) {
    if (keep.has(e)) continue;
    if (TRANSIENT_ENTITY.some((c) => world.has(e, c))) continue;
    const comps: [string, unknown][] = [];
    for (const name of world.componentNames()) {
      if (TRANSIENT_COMPONENT.includes(name)) continue;
      const data = world.get<object>(e, name);
      if (data !== undefined) comps.push([name, data]);
    }
    if (comps.length > 0) entities.push(comps);
  }
  return { mapSeed: session.mapSeed, activeNodeId: session.activeNodeId, tick, entities };
}

/** Is this the map that snapshot came from? */
export function suspendedMatches(
  held: SuspendedArea | null,
  session: { mapSeed: number; activeNodeId: string },
): held is SuspendedArea {
  return held !== null
    && held.mapSeed === session.mapSeed
    && held.activeNodeId === session.activeNodeId;
}

/**
 * Put the frozen population back, with every cooldown holding the time it had
 * left when it was frozen. New entity ids: the old ones are gone, and nothing
 * that survives a suspend refers to another entity by id (the two things that
 * did — a projectile's owner and a telegraph's — are exactly the transients that
 * are never stored).
 */
export function restoreArea(world: World, held: SuspendedArea, tick: number): void {
  const elapsed = tick - held.tick;
  for (const comps of held.entities) {
    const e = world.create();
    for (const [name, data] of comps) {
      world.set(e, name, rebase(name, data, elapsed) as object);
    }
  }
}

function rebase(name: string, data: unknown, elapsed: number): unknown {
  const spec = REBASED.find((r) => r.comp === name);
  if (!spec || elapsed <= 0) return data;
  const next = { ...(data as Record<string, unknown>) };
  for (const field of spec.fields) {
    const v = next[field];
    if (typeof v === "number") next[field] = v + elapsed;
  }
  return next;
}
