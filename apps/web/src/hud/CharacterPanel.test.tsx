// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { Snapshot } from "@exiled/protocol";
import { CharacterPanel } from "./CharacterPanel";

afterEach(cleanup);

function player(over: Partial<Snapshot["player"]["stats"]> = {}): Snapshot["player"] {
  return {
    id: 0, x: 0, y: 0,
    life: 96, maxLife: 140, mana: 12, maxMana: 60,
    cooldowns: {}, alive: true, casting: false,
    flasks: { lifeCharges: 7, lifeMax: 7, manaCharges: 7, manaMax: 7 },
    stats: { armour: 50, armourPct: 83, fireResPct: 20, manaRegenPerSec: 8.7, spellDamagePct: 12, ...over },
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

    rerender(<CharacterPanel player={player({ fireResPct: 90 })} onClose={() => {}} />);
    expect(screen.getByTestId("char-res-fire").textContent).toContain("75% (90%)");
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
