import { World } from "./ecs";
import { fnv1a32 } from "./rng";

// Canonical serialization: component names sorted, entities ascending, keys
// sorted. Component data must be flat records of integer | string | boolean.
// Every numeric field is a Fixed (scaled integer) by construction, so a
// non-integer is float leakage — the one real cross-engine hazard (transcendental
// results are finite but differ across engines) — and must throw, not just NaN/Inf.
function stableValue(v: unknown): string {
  // An unset optional field (e.g. TelegraphC.ground on a phase-1 slam) hashes as
  // absent — identical to the field simply not being present.
  if (v === undefined || v === null) return "_";
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error(`non-integer value in world state: ${v}`);
    return `n:${v}`;
  }
  if (typeof v === "boolean") return `b:${v ? 1 : 0}`;
  if (typeof v === "string") return `s:${v}`;
  // An array (e.g. SessionC.completedNodes) is an ordered collection: serialize
  // element-by-element so order-sensitive divergence is caught. Elements are
  // strings/integers by construction and hash through the cases above.
  if (Array.isArray(v)) return `[${v.map(stableValue).join(",")}]`;
  // A nested record (e.g. TelegraphC.ground) is serialized by its sorted keys, so
  // its contents are part of the hash — divergence in a sub-object is still caught.
  if (typeof v === "object") {
    const rec = v as Record<string, unknown>;
    return `{${Object.keys(rec).sort().map((k) => `${k}=${stableValue(rec[k])}`).join(",")}}`;
  }
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
        // `yaw` is the one documented render-only field (InteractableC): a radian
        // angle, not a Fixed, set as a construction constant by buildArea. It never
        // varies between runs of the same area, so it cannot mask a divergence —
        // and hashing a cosmetic float would trip the integer guard below.
        if (key === "yaw") continue;
        parts.push(`${key}=${stableValue(data[key])}`);
      }
    }
  }
  return parts.join("|");
}

export function checksumWorld(world: World): number {
  return fnv1a32(serializeWorld(world));
}
