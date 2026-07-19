// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Hud } from "./Hud";
import type { Snapshot } from "@pact/protocol";

// No globals:true in this repo, so @testing-library/react does not auto-register
// its afterEach cleanup — do it explicitly or renders leak across tests.
afterEach(cleanup);

function makeSnap(overrides: {
  life?: number;
  maxLife?: number;
  cooldowns?: Record<string, number>;
}): Snapshot {
  return {
    tick: 1,
    player: {
      id: 0,
      x: 0,
      y: 0,
      life: overrides.life ?? 100,
      maxLife: overrides.maxLife ?? 100,
      mana: 30,
      maxMana: 60,
      cooldowns: overrides.cooldowns ?? {},
      alive: true,
    },
    entities: [],
  };
}

describe("Hud", () => {
  it("renders null snapshot without crashing", () => {
    render(<Hud snapshot={null} />);
    // no assertion needed — just must not throw
  });

  it("life bar width reflects life/maxLife ratio", () => {
    const { getByTestId } = render(<Hud snapshot={makeSnap({ life: 50, maxLife: 100 })} />);
    const bar = getByTestId("life-bar-fill");
    expect(bar).toHaveStyle({ width: "50%" });
  });

  it("skill with cooldown shows remaining seconds", () => {
    const snap = makeSnap({ cooldowns: { "skill.ember_bolt.v1": 1.5 } });
    render(<Hud snapshot={snap} />);
    expect(screen.getByText("1.5s")).toBeInTheDocument();
  });

  it("skill with cooldown 0 shows Ready", () => {
    // ember_bolt just hit 0 → Ready; keep the other two on cooldown so exactly one
    // slot reads "Ready" and getByText resolves to a single element.
    const snap = makeSnap({
      cooldowns: {
        "skill.ember_bolt.v1": 0,
        "skill.cinder_ground.v1": 2,
        "skill.blink.v1": 4,
      },
    });
    render(<Hud snapshot={snap} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("skill with no cooldown entry shows Ready", () => {
    const snap = makeSnap({ cooldowns: {} });
    render(<Hud snapshot={snap} />);
    const readyLabels = screen.getAllByText("Ready");
    // All three skill slots should show Ready when no cooldowns present
    expect(readyLabels.length).toBe(3);
  });
});
