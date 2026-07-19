import { World } from "./ecs";
import { fnv1a32 } from "./rng";

// Canonical serialization: component names sorted, entities ascending, keys
// sorted. Component data must be flat records of number | string | boolean.
function stableValue(v: unknown): string {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`non-finite value in world state: ${v}`);
    return `n:${v}`;
  }
  if (typeof v === "boolean") return `b:${v ? 1 : 0}`;
  if (typeof v === "string") return `s:${v}`;
  throw new Error(`unsupported component value type: ${typeof v}`);
}

export function serializeWorld(world: World): string {
  const parts: string[] = [];
  for (const comp of world.componentNames()) {
    parts.push(`#${comp}`);
    for (const e of world.entitiesWith(comp)) {
      const data = world.get<Record<string, unknown>>(e, comp);
      if (!data) continue;
      parts.push(`@${e}`);
      for (const key of Object.keys(data).sort()) {
        parts.push(`${key}=${stableValue(data[key])}`);
      }
    }
  }
  return parts.join("|");
}

export function checksumWorld(world: World): number {
  return fnv1a32(serializeWorld(world));
}
