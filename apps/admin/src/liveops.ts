import type { LiveConfig } from "@exiled/telemetry";

export type FlagType = "boolean" | "number" | "string";
export interface FlagRow {
  key: string;
  type: FlagType;
  value: string;
}

/** The live-ops page's editable state; every field is what an input holds. */
export interface LiveOpsForm {
  motdText: string;
  motdLevel: "info" | "warn";
  maintenanceOn: boolean;
  maintenanceText: string;
  /** `builtAt` ms as text, "" for no minimum. */
  minBuiltAt: string;
  flags: FlagRow[];
  telemetry: boolean;
}

export function formFromConfig(c: LiveConfig): LiveOpsForm {
  return {
    motdText: c.motd?.text ?? "",
    motdLevel: c.motd?.level ?? "info",
    maintenanceOn: c.maintenance !== undefined,
    maintenanceText: c.maintenance?.text ?? "",
    minBuiltAt: c.minBuiltAt !== undefined ? String(c.minBuiltAt) : "",
    flags: Object.entries(c.flags).map(([key, v]) => ({
      key,
      type: typeof v as FlagType,
      value: String(v),
    })),
    telemetry: c.telemetry,
  };
}

/** FNV-1a, so the id is short and derived from the text it names. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Key-order-free JSON, so a config the server echoes in another order still compares equal. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

export function sameConfig(a: LiveConfig, b: LiveConfig): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export type FormResult = { ok: true; config: LiveConfig } | { ok: false; errors: string[] };

/**
 * The MOTD keeps its id while its text is unchanged and gets a new one when the text changes,
 * so a banner a player dismissed comes back only when it says something new.
 */
export function configFromForm(form: LiveOpsForm, prev: LiveConfig, now: number): FormResult {
  const errors: string[] = [];
  const config: LiveConfig = { flags: {}, telemetry: form.telemetry };

  const text = form.motdText.trim();
  if (text) {
    const id = prev.motd && prev.motd.text === text ? prev.motd.id : `${hash(text)}-${now.toString(36)}`;
    config.motd = { id, text, level: form.motdLevel };
  }

  if (form.maintenanceOn) {
    const m = form.maintenanceText.trim();
    if (m) config.maintenance = { text: m };
    else errors.push("Maintenance needs a text.");
  }

  if (form.minBuiltAt !== "") {
    const n = Number(form.minBuiltAt);
    if (Number.isInteger(n) && n > 0) config.minBuiltAt = n;
    else errors.push("Minimum build is not a build time.");
  }

  const seen = new Set<string>();
  for (const row of form.flags) {
    const key = row.key.trim();
    if (!key) continue;
    if (seen.has(key)) {
      errors.push(`Flag "${key}" is listed twice.`);
      continue;
    }
    seen.add(key);
    if (row.type === "boolean") {
      if (row.value === "true" || row.value === "false") config.flags[key] = row.value === "true";
      else errors.push(`Flag "${key}" must be true or false.`);
    } else if (row.type === "number") {
      const n = Number(row.value);
      if (row.value.trim() !== "" && Number.isFinite(n)) config.flags[key] = n;
      else errors.push(`Flag "${key}" needs a number.`);
    } else {
      config.flags[key] = row.value;
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, config };
}
