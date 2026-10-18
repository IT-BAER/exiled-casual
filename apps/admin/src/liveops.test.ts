import { describe, expect, it } from "vitest";
import type { LiveConfig } from "@exiled/telemetry";
import { configFromForm, formFromConfig, type LiveOpsForm } from "./liveops";

const NOW = 1_800_000_000_000;

const base: LiveOpsForm = {
  motdText: "",
  motdLevel: "info",
  maintenanceOn: false,
  maintenanceText: "",
  minBuiltAt: "",
  flags: [],
  telemetry: true,
};

describe("live ops form", () => {
  it("serialises an empty form to the off state", () => {
    expect(configFromForm(base, { flags: {}, telemetry: true }, NOW)).toEqual({ ok: true, config: { flags: {}, telemetry: true } });
  });

  it("serialises every field to LiveConfig", () => {
    const form: LiveOpsForm = {
      motdText: "  Patch 0.4 is live  ",
      motdLevel: "warn",
      maintenanceOn: true,
      maintenanceText: "Back at 18:00",
      minBuiltAt: "1700000000000",
      flags: [
        { key: "newLoot", type: "boolean", value: "true" },
        { key: "dropScale", type: "number", value: "1.25" },
        { key: "banner", type: "string", value: "hello" },
      ],
      telemetry: false,
    };
    const res = configFromForm(form, { flags: {}, telemetry: true }, NOW);
    if (!res.ok) throw new Error(res.errors.join());
    const c: LiveConfig = res.config;
    expect(c.motd?.text).toBe("Patch 0.4 is live");
    expect(c.motd?.level).toBe("warn");
    expect(c.motd?.id).toMatch(/\S/);
    expect(c.maintenance).toEqual({ text: "Back at 18:00" });
    expect(c.minBuiltAt).toBe(1700000000000);
    expect(c.flags).toEqual({ newLoot: true, dropScale: 1.25, banner: "hello" });
    expect(c.telemetry).toBe(false);
  });

  it("keeps the MOTD id while the text is unchanged and renews it when the text changes", () => {
    const prev: LiveConfig = { motd: { id: "m1", text: "Hello", level: "info" }, flags: {}, telemetry: true };
    const same = configFromForm({ ...base, motdText: "Hello", motdLevel: "warn" }, prev, NOW);
    expect(same.ok && same.config.motd?.id).toBe("m1");
    const changed = configFromForm({ ...base, motdText: "Hello!" }, prev, NOW);
    expect(changed.ok && changed.config.motd?.id).not.toBe("m1");
  });

  it("round-trips a config through the form", () => {
    const cfg: LiveConfig = {
      motd: { id: "abc", text: "Hi", level: "info" },
      maintenance: { text: "Soon" },
      minBuiltAt: 1234,
      flags: { a: true, b: 2, c: "x" },
      telemetry: true,
    };
    const res = configFromForm(formFromConfig(cfg), cfg, NOW);
    expect(res).toEqual({ ok: true, config: cfg });
  });

  it("refuses bad flags and an empty maintenance text", () => {
    const res = configFromForm(
      {
        ...base,
        maintenanceOn: true,
        flags: [
          { key: "n", type: "number", value: "abc" },
          { key: "b", type: "boolean", value: "yes" },
          { key: "n", type: "string", value: "dup" },
          { key: "", type: "string", value: "" },
        ],
      },
      { flags: {}, telemetry: true },
      NOW,
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.errors).toEqual([
      "Maintenance needs a text.",
      'Flag "n" needs a number.',
      'Flag "b" must be true or false.',
      'Flag "n" is listed twice.',
    ]);
  });
});
