// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Snapshot } from "@exiled/protocol";
import { CharacterPanel } from "./CharacterPanel";
import { testStats } from "../test-fixtures";

afterEach(cleanup);

function player(over: Partial<Snapshot["player"]["stats"]> = {}): Snapshot["player"] {
  return {
    id: 0, x: 0, y: 0,
    life: 96, maxLife: 140, mana: 12, maxMana: 60,
    energyShield: 0, maxEnergyShield: 0,
    cooldowns: {}, alive: true, casting: false, level: 65, xp: 0, xpToNext: 60_000, gold: 0,
    flasks: { lifeCharges: 7, lifeMax: 7, manaCharges: 7, manaMax: 7 },
    stats: testStats({ armour: 50, armourPct: 83, res: { fire: 20, cold: 0, lightning: 0, chaos: 0 }, manaRegenPerSec: 8.7, spellDamagePct: 12, ...over }),
  };
}

describe("CharacterPanel", () => {
  it("shows the resource niches as maxima, the way PoE2's sheet does", () => {
    render(<CharacterPanel player={player()} onClose={() => {}} />);
    const life = screen.getByTestId("char-stat-life");
    expect(life.textContent).toContain("Life");
    expect(life.textContent).toContain("140");
    expect(screen.getByTestId("char-stat-mana").textContent).toContain("60");
  });

  it("shows armour as the percentage of a physical hit it stops, not the raw rating", () => {
    render(<CharacterPanel player={player()} onClose={() => {}} />);
    const armour = screen.getByTestId("char-stat-armour");
    expect(armour.textContent).toContain("83%");
  });

  it("prints fire resistance as capped (uncapped), so overcapping is legible", () => {
    const { rerender } = render(<CharacterPanel player={player()} onClose={() => {}} />);
    expect(screen.getByTestId("char-res-fire").textContent).toContain("20% (20%)");

    rerender(<CharacterPanel player={player({ res: { fire: 90, cold: 0, lightning: 0, chaos: 0 } })} onClose={() => {}} />);
    expect(screen.getByTestId("char-res-fire").textContent).toContain("75% (90%)");
  });

  it("shows all four resistances, as the reference's 2x2 grid does", () => {
    render(
      <CharacterPanel
        player={player({ res: { fire: 20, cold: 41, lightning: 5, chaos: 60 } })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId("char-res-cold").textContent).toContain("41% (41%)");
    expect(screen.getByTestId("char-res-lightning").textContent).toContain("5% (5%)");
    expect(screen.getByTestId("char-res-chaos").textContent).toContain("60% (60%)");
    expect(screen.getByTestId("char-detail").textContent).toContain("Chaos Resistance");
  });

  it("lists mana regeneration and spell damage in the detail block", () => {
    render(<CharacterPanel player={player()} onClose={() => {}} />);
    const detail = screen.getByTestId("char-detail");
    expect(detail.textContent).toContain("Mana Regeneration per second");
    expect(detail.textContent).toContain("8.7");
    expect(detail.textContent).toContain("Increased Spell Damage");
    expect(detail.textContent).toContain("12%");
    expect(detail.textContent).toContain("Armour");
    expect(detail.textContent).toContain("50");
  });

  it("closes on the X", () => {
    let closed = false;
    render(<CharacterPanel player={player()} onClose={() => { closed = true; }} />);
    fireEvent.click(screen.getByTestId("character-close"));
    expect(closed).toBe(true);
  });
});

describe("energy shield", () => {
  it("shows a niche and a detail block once gear grants a pool", () => {
    render(<CharacterPanel player={{ ...player(), maxEnergyShield: 120 }} onClose={() => {}} />);
    const niche = screen.getByTestId("char-stat-energy-shield");
    expect(niche.textContent).toContain("120");
    // The crest must keep its own size: a flexible SVG in the niche column gets
    // squashed to zero height by the label beneath it.
    expect(niche.querySelector("svg")!.getAttribute("style")).toContain("flex: 0 0 auto");
    expect(screen.getByTestId("char-detail").textContent).toContain("Maximum Energy Shield");
  });

  it("says nothing at all without one", () => {
    render(<CharacterPanel player={player()} onClose={() => {}} />);
    expect(screen.queryByTestId("char-stat-energy-shield")).toBeNull();
    expect(screen.getByTestId("char-detail").textContent).not.toContain("Energy Shield");
  });
});
