import type { DamageType } from "@exiled/content-schema";

/**
 * Components store a damage type as a small integer, so serialized world state
 * stays compact and checksums stay cheap. The order is append-only: fire and
 * physical keep the codes they had before the other elements existed, so old
 * replays and saved worlds keep meaning what they meant.
 */
export const DAMAGE_TYPES: readonly DamageType[] = [
  "fire",
  "physical",
  "cold",
  "lightning",
  "chaos",
];

export function damageCode(type: DamageType): number {
  const i = DAMAGE_TYPES.indexOf(type);
  if (i < 0) throw new Error(`unknown damage type "${type}"`);
  return i;
}

export function damageTypeOf(code: number): DamageType {
  const t = DAMAGE_TYPES[code];
  if (t === undefined) throw new Error(`unknown damage code ${code}`);
  return t;
}
