import { World } from "./ecs";
import { fnv1a32 } from "./rng";

// Canonical serialization: component names sorted, entities ascending, keys
// sorted. Component data must be flat records of integer | string | boolean.
// Every numeric field is a Fixed (scaled integer) by construction, so a
// non-integer is float leakage — the one real cross-engine hazard (transcendental
// results are finite but differ across engines) — and must throw, not just NaN/Inf.
function stableValue(v: unknown): string {
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error(`non-integer value in world state: ${v}`);
    return `n:${v}`;
  }
  if (typeof v === "boolean") return `b:${v ? 1 : 0}`;
  if (typeof v === "string") return `s:${v}`;
  throw new Error(`unsupported component value type: ${typeof v}`);
}

export function serializeWorld(world: World): string {
  const parts: string[] = [];
  // Entity liveness and the id allocator are part of the state: a live entity
  // with no components, or a differing next-id after create/destroy history,
  // would otherwise be invisible to the hash yet change future allocation.
  parts.push(`!next=${world.nextId}`);
  parts.push(`!alive=${[...world.alive].sort((a, b) => a - b).join(",")}`);
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
