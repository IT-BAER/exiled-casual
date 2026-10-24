import type { World } from "./ecs";
import type { FloorItem, HideoutFloorC, ItemC, Position, SessionC } from "./components";

/**
 * PoE's hideout floor is the player's own: an item put down there is still there
 * after a map and after a reload. The area transition tears every non-player
 * entity down, so the floor is lifted off the world on the way out and laid back
 * on the way in, and the save carries it whichever side of the portal he is on.
 */

/** Every ground item standing in the world right now. */
export function floorOf(world: World): FloorItem[] {
  return world.query("item", "position").map((e) => ({
    ...world.get<ItemC>(e, "item")!,
    ...world.get<Position>(e, "position")!,
  }));
}

/** The hideout floor, wherever the player is standing. */
export function hideoutFloor(world: World, sessionE: number): FloorItem[] {
  if (world.get<SessionC>(sessionE, "session")?.area === "hideout") return floorOf(world);
  return world.get<HideoutFloorC>(sessionE, "hideoutFloor")?.items ?? [];
}

/** Stand the items back up as ground entities. Entries that are not an item at a point are skipped. */
export function layFloor(world: World, items: readonly FloorItem[]): void {
  // Integers only: the checksum throws on a fractional field, and a save can be hand-edited.
  const int = (v: unknown) => Number.isInteger(v);
  for (const f of items) {
    if (!int(f?.x) || !int(f?.y) || !int(f.w) || !int(f.h) || typeof f.item?.baseId !== "string") continue;
    if (f.count !== undefined && !int(f.count)) continue;
    const ge = world.create();
    world.set<Position>(ge, "position", { x: f.x, y: f.y });
    world.set<ItemC>(ge, "item", {
      item: f.item, w: f.w, h: f.h,
      ...(f.count !== undefined ? { count: f.count } : {}),
    });
  }
}
