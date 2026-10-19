// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { DeathRecap as Recap } from "@exiled/protocol";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { MONSTERS } from "@exiled/content-runtime";
import { DeathRecap, monsterPortrait } from "./DeathRecap";
import { testStats } from "../test-fixtures";

afterEach(cleanup);

const IMP = "monster.cinder_imp.v1";
const HUSK = "monster.vaal_husk.v1";

function recap(over: Partial<Recap> = {}): Recap {
  return {
    killingBlow: { species: IMP, rare: false, damage: 42, element: "fire", pctOfLife: 30 },
    sources: [
      { species: IMP, rare: false, damage: 90, hits: 3, element: "fire" },
      { species: HUSK, rare: true, damage: 40, hits: 2, element: "physical" },
      { species: "ailment.burning", rare: false, damage: 12, hits: 4, element: "fire" },
    ],
    total: 142,
    byElement: { fire: 102, physical: 40 },
    ...over,
  };
}

const stats = (over = {}) =>
  testStats({ armour: 50, armourPct: 12, res: { fire: 20, cold: 0, lightning: 0, chaos: 0 }, ...over });

describe("DeathRecap", () => {
  it("names the killing blow with its damage, element and a portrait of the monster", () => {
    render(<DeathRecap recap={recap()} stats={stats()} />);
    const kb = screen.getByTestId("recap-killing-blow");
    expect(kb.textContent).toContain("Cinder Imp");
    expect(kb.textContent).toContain("42");
    expect(kb.textContent).toContain("Fire");
    expect(kb.querySelector("img:not([data-element])")!.getAttribute("src")).toBe("/hud/monsters/cinder_imp.webp");
  });

  it("marks every damage number with its element's icon", () => {
    render(<DeathRecap recap={recap()} stats={stats()} />);
    const icon = (el: Element) => el.querySelector("img[data-element]")!.getAttribute("src");
    expect(icon(screen.getByTestId("recap-killing-blow"))).toBe("/hud/elements/fire.webp");
    const rows = screen.getAllByTestId("recap-source");
    expect(rows.map(icon)).toEqual(["/hud/elements/fire.webp", "/hud/elements/physical.webp", "/hud/elements/fire.webp"]);
  });

  it("has a portrait on disk for every monster that can deal a killing blow", () => {
    const missing = [...MONSTERS.keys()].filter((id) =>
      !existsSync(resolve(__dirname, "../../public", monsterPortrait(id)!.slice(1))));
    expect(missing).toEqual([]);
  });

  it("lists the top sources with hit counts, a rare marked as rare, a burn as Burning", () => {
    render(<DeathRecap recap={recap()} stats={stats()} />);
    const rows = screen.getAllByTestId("recap-source");
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("Cinder Imp");
    expect(rows[0]!.textContent).toContain("x3");
    expect(rows[1]!.textContent).toContain("Rare Vaal Husk");
    expect(rows[2]!.textContent).toContain("Burning");
    expect(rows[2]!.querySelector("img:not([data-element])")).toBeNull();
  });

  it("fills an ailment's portrait box with its element instead of leaving it empty", () => {
    render(<DeathRecap recap={recap({ killingBlow: { species: "ailment.poison", rare: false, damage: 1, element: "chaos", pctOfLife: 1 } })} stats={stats()} />);
    const box = (el: Element) => el.querySelector("[data-testid=recap-portrait]")!;
    expect(box(screen.getByTestId("recap-killing-blow")).querySelector("img")!.getAttribute("src")).toBe("/hud/elements/chaos.webp");
    expect(box(screen.getAllByTestId("recap-source")[2]!).querySelector("img")!.getAttribute("src")).toBe("/hud/elements/fire.webp");
  });

  it("names a poison and a bleed by the ailment, not as Unknown", () => {
    const base = recap();
    render(<DeathRecap recap={{ ...base, sources: [
      { species: "ailment.poison", rare: false, damage: 6, hits: 5, element: "chaos" },
      { species: "ailment.bleeding", rare: false, damage: 4, hits: 9, element: "physical" },
    ] }} stats={stats()} />);
    const rows = screen.getAllByTestId("recap-source");
    expect(rows[0]!.textContent).toContain("Poison");
    expect(rows[1]!.textContent).toContain("Bleeding");
  });

  it("an uncapped fire resistance is the tip when fire did the most", () => {
    render(<DeathRecap recap={recap()} stats={stats()} />);
    const tip = screen.getByTestId("recap-tip").textContent!;
    expect(tip).toContain("Fire resistance is 20%");
    expect(tip).toContain("75%");
  });

  it("a capped resistance points at life and energy shield instead", () => {
    render(<DeathRecap recap={recap()} stats={stats({ res: { fire: 80, cold: 0, lightning: 0, chaos: 0 } })} />);
    expect(screen.getByTestId("recap-tip").textContent).toMatch(/life or energy shield/i);
  });

  it("physical damage points at armour, chaos at chaos resistance and the shield's weakness", () => {
    const { rerender } = render(
      <DeathRecap recap={recap({ byElement: { physical: 100, fire: 5 } })} stats={stats()} />,
    );
    expect(screen.getByTestId("recap-tip").textContent).toContain("armour");
    rerender(<DeathRecap recap={recap({ byElement: { chaos: 100 } })} stats={stats()} />);
    const tip = screen.getByTestId("recap-tip").textContent!;
    expect(tip).toContain("Chaos resistance is 0%");
    expect(tip).toMatch(/energy shield/i);
  });

  it("a killing blow over half his life is called out", () => {
    const { rerender } = render(<DeathRecap recap={recap()} stats={stats()} />);
    expect(screen.queryByTestId("recap-big-hit")).toBeNull();
    rerender(<DeathRecap recap={recap({ killingBlow: { ...recap().killingBlow, pctOfLife: 64 } })} stats={stats()} />);
    expect(screen.getByTestId("recap-big-hit").textContent).toContain("64%");
  });
});
