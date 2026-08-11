// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { SkillTooltip } from "./SkillTooltip";
import type { Snapshot } from "@exiled/protocol";

afterEach(cleanup);

type Skill = NonNullable<Snapshot["skills"]>[number];

function makeSkill(overrides: Partial<Skill>): Skill {
  return {
    id: "skill.ember_bolt.v1",
    name: "Ember Bolt",
    description: "Launches a bolt of fire that bursts on the first enemy it strikes.",
    manaCost: 8,
    castTimeSec: 8 / 30,
    cooldownSec: 0.2,
    lines: [],
    gemLevel: 1,
    gemXp: 0,
    gemXpToNext: 60,
    breakpoints: [],
    ...overrides,
  };
}

function renderTip(skill: Skill) {
  return render(<SkillTooltip skills={[skill]} id={skill.id} right="0" bottom="0" />);
}

describe("SkillTooltip gem level", () => {
  it("shows the gem level in the header", () => {
    renderTip(makeSkill({ gemLevel: 7 }));
    expect(screen.getByTestId("skill-tooltip")).toHaveTextContent("Level 7");
  });

  it("draws an experience rail whose width is gemXp over gemXpToNext", () => {
    renderTip(makeSkill({ gemXp: 30, gemXpToNext: 60 }));
    expect(screen.getByTestId("gem-xp-fill")).toHaveStyle({ width: "50%" });
  });

  it("draws no rail at the gem cap, where gemXpToNext is 0", () => {
    renderTip(makeSkill({ gemXp: 0, gemXpToNext: 0 }));
    expect(screen.queryByTestId("gem-xp-rail")).toBeNull();
    expect(screen.queryByTestId("gem-xp-fill")).toBeNull();
  });

  it("lists reached breakpoints in the modifier colour and the next one greyed", () => {
    renderTip(makeSkill({
      breakpoints: ["Level 4: Adds Burning"],
      nextBreakpoint: { atLevel: 8, text: "Chain Damage" },
    }));
    const reached = screen.getByText("Level 4: Adds Burning");
    const next = screen.getByTestId("next-breakpoint");
    expect(next).toHaveTextContent("Level 8: Chain Damage");
    // The grey line is where the anticipation lives; a test that only checks the
    // text passes on a line rendered identically to a reached one.
    expect(next.style.color).not.toBe(reached.style.color);
  });

  it("shows nothing about breakpoints for a skill that has none", () => {
    renderTip(makeSkill({ breakpoints: [], nextBreakpoint: undefined }));
    expect(screen.queryByTestId("next-breakpoint")).toBeNull();
  });
});
