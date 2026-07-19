import type { Fixed } from "@pact/fixed-point";

// ── Types ────────────────────────────────────────────────────────────────────

export type DamageType = "fire" | "physical";

export interface Defenses {
  fireResPct: number;
  armourFixed: Fixed;
}

export interface DamageSpec {
  type: DamageType;
  amountFixed: Fixed;
}

export interface AilmentSpec {
  kind: "burning";
  stacksPerApply: number;
  dpsFixed: Fixed;
  durationTicks: number;
  maxStacks: number;
}

export type EffectNode =
  | {
      type: "spawnProjectile";
      speedPerSecFixed: Fixed;
      radiusFixed: Fixed;
      maxRangeFixed: Fixed;
      damage: DamageSpec;
    }
  | {
      type: "spawnGroundArea";
      radiusFixed: Fixed;
      durationTicks: number;
      ailment: AilmentSpec;
    }
  | { type: "teleport"; distanceFixed: Fixed };

export interface SkillDef {
  id: string;
  name: string;
  manaCostFixed: Fixed;
  cooldownTicks: number;
  effects: EffectNode[];
}

export interface RareModifier {
  lifeMulPct: number;
  moveSpeedMulPct: number;
  damageMulPct: number;
  addedFireResPct: number;
}

export interface MonsterDef {
  id: string;
  name: string;
  maxLifeFixed: Fixed;
  moveSpeedFixed: Fixed;
  attackRangeFixed: Fixed;
  attackDamage: DamageSpec;
  attackCooldownTicks: number;
  radiusFixed: Fixed;
  defenses: Defenses;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

// ── Validators ────────────────────────────────────────────────────────────────

export const ID_PATTERN: RegExp = /^(skill|monster)\.[a-z0-9_]+\.v\d+$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonNegInt(v: unknown): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function validateDamageSpec(v: unknown, path: string, errors: string[]): boolean {
  if (!isObj(v)) {
    errors.push(`${path}: must be an object`);
    return false;
  }
  let ok = true;
  if (v["type"] !== "fire" && v["type"] !== "physical") {
    errors.push(`${path}.type: must be "fire" or "physical"`);
    ok = false;
  }
  if (!isNonNegInt(v["amountFixed"])) {
    errors.push(`${path}.amountFixed: must be a non-negative integer`);
    ok = false;
  }
  return ok;
}

function validateEffectNode(v: unknown, idx: number, errors: string[]): boolean {
  const path = `effects[${idx}]`;
  if (!isObj(v)) {
    errors.push(`${path}: must be an object`);
    return false;
  }
  let ok = true;
  const type = v["type"];
  if (type === "spawnProjectile") {
    if (typeof v["speedPerSecFixed"] !== "number") {
      errors.push(`${path}.speedPerSecFixed: required number`);
      ok = false;
    }
    if (typeof v["radiusFixed"] !== "number") {
      errors.push(`${path}.radiusFixed: required number`);
      ok = false;
    }
    if (typeof v["maxRangeFixed"] !== "number") {
      errors.push(`${path}.maxRangeFixed: required number`);
      ok = false;
    }
    if (!validateDamageSpec(v["damage"], `${path}.damage`, errors)) ok = false;
  } else if (type === "spawnGroundArea") {
    if (typeof v["radiusFixed"] !== "number") {
      errors.push(`${path}.radiusFixed: required number`);
      ok = false;
    }
    if (!isNonNegInt(v["durationTicks"])) {
      errors.push(`${path}.durationTicks: must be a non-negative integer`);
      ok = false;
    }
    const a = v["ailment"];
    if (!isObj(a)) {
      errors.push(`${path}.ailment: required object`);
      ok = false;
    } else {
      if (a["kind"] !== "burning") {
        errors.push(`${path}.ailment.kind: must be "burning"`);
        ok = false;
      }
      if (!isNonNegInt(a["stacksPerApply"])) {
        errors.push(`${path}.ailment.stacksPerApply: must be non-negative integer`);
        ok = false;
      }
      if (typeof a["dpsFixed"] !== "number") {
        errors.push(`${path}.ailment.dpsFixed: required number`);
        ok = false;
      }
      if (!isNonNegInt(a["durationTicks"])) {
        errors.push(`${path}.ailment.durationTicks: must be non-negative integer`);
        ok = false;
      }
      if (!isNonNegInt(a["maxStacks"])) {
        errors.push(`${path}.ailment.maxStacks: must be non-negative integer`);
        ok = false;
      }
    }
  } else if (type === "teleport") {
    if (typeof v["distanceFixed"] !== "number") {
      errors.push(`${path}.distanceFixed: required number`);
      ok = false;
    }
  } else {
    errors.push(`${path}.type: unknown effect type "${String(type)}"`);
    ok = false;
  }
  return ok;
}

export function validateSkillDef(v: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(v)) {
    return { ok: false, errors: ["input: must be an object"] };
  }
  if (typeof v["id"] !== "string" || !ID_PATTERN.test(v["id"])) {
    errors.push(`id: must match ID_PATTERN, got "${String(v["id"])}"`);
  }
  if (typeof v["name"] !== "string" || v["name"].length === 0) {
    errors.push("name: must be a non-empty string");
  }
  if (!isNonNegInt(v["manaCostFixed"])) {
    errors.push("manaCostFixed: must be a non-negative integer");
  }
  if (!isNonNegInt(v["cooldownTicks"])) {
    errors.push("cooldownTicks: must be a non-negative integer");
  }
  const effects = v["effects"];
  if (!Array.isArray(effects) || effects.length === 0) {
    errors.push("effects: must be a non-empty array");
  } else {
    for (let i = 0; i < effects.length; i++) {
      validateEffectNode(effects[i], i, errors);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateMonsterDef(v: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isObj(v)) {
    return { ok: false, errors: ["input: must be an object"] };
  }
  if (typeof v["id"] !== "string" || !ID_PATTERN.test(v["id"])) {
    errors.push(`id: must match ID_PATTERN, got "${String(v["id"])}"`);
  }
  if (typeof v["name"] !== "string" || v["name"].length === 0) {
    errors.push("name: must be a non-empty string");
  }
  for (const field of [
    "maxLifeFixed",
    "moveSpeedFixed",
    "attackRangeFixed",
    "attackCooldownTicks",
    "radiusFixed",
  ] as const) {
    if (!isNonNegInt(v[field])) {
      errors.push(`${field}: must be a non-negative integer`);
    }
  }
  if (!isObj(v["defenses"])) {
    errors.push("defenses: required object");
  } else {
    const def = v["defenses"] as Record<string, unknown>;
    if (
      typeof def["fireResPct"] !== "number" ||
      !Number.isInteger(def["fireResPct"]) ||
      def["fireResPct"] < 0
    ) {
      errors.push("defenses.fireResPct: must be a non-negative integer");
    }
    if (typeof def["armourFixed"] !== "number") {
      errors.push("defenses.armourFixed: required number");
    }
  }
  validateDamageSpec(v["attackDamage"], "attackDamage", errors);
  return { ok: errors.length === 0, errors };
}
