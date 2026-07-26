// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { Hud } from "./Hud";
import type { Snapshot } from "@exiled/protocol";
import { MAP_PORTALS } from "@exiled/protocol";
import { testPlayer, testStats } from "../test-fixtures";

// No globals:true in this repo, so @testing-library/react does not auto-register
// its afterEach cleanup — do it explicitly or renders leak across tests.
afterEach(cleanup);

function makeSnap(overrides: {
  life?: number;
  maxLife?: number;
  cooldowns?: Record<string, number>;
  area?: Snapshot["area"];
  portalsLeft?: number;
  mapOpen?: boolean;
  entities?: Snapshot["entities"];
  flasks?: Snapshot["player"]["flasks"];
  energyShield?: number;
  maxEnergyShield?: number;
  level?: number;
  xp?: number;
  xpToNext?: number;
  skills?: Snapshot["skills"];
}): Snapshot {
  return {
    tick: 1,
    area: overrides.area ?? "hideout",
    portalsLeft: overrides.portalsLeft ?? 0,
    mapOpen: overrides.mapOpen ?? false,
    areaTier: 0,
    atlasSeed: 0,
    completedNodes: [], waystones: [],
    skills: overrides.skills,
    player: {
      id: 0,
      x: 0,
      y: 0,
      life: overrides.life ?? 100,
      maxLife: overrides.maxLife ?? 100,
      mana: 30,
      maxMana: 60,
      energyShield: overrides.energyShield ?? 0,
      maxEnergyShield: overrides.maxEnergyShield ?? 0,
      cooldowns: overrides.cooldowns ?? {},
      alive: true,
      casting: false,
      level: overrides.level ?? 65,
      xp: overrides.xp ?? 0,
      xpToNext: overrides.xpToNext ?? 60_000,
      flasks: overrides.flasks ?? { lifeCharges: 7, lifeMax: 7, manaCharges: 7, manaMax: 7 },
      stats: testStats(),
    },
    entities: overrides.entities ?? [],
    inventory: { cols: 12, rows: 5, items: [] },
    stash: { cols: 12, rows: 12, items: [] },
    equipment: {},
    shards: {},
  };
}

describe("Hud", () => {
  it("renders null snapshot without crashing", () => {
    render(<Hud snapshot={null} />);
    // no assertion needed — just must not throw
  });

  it("life orb fill reflects life/maxLife ratio", () => {
    const { getByTestId } = render(<Hud snapshot={makeSnap({ life: 50, maxLife: 100 })} />);
    const fill = getByTestId("life-orb-fill");
    expect(fill).toHaveStyle({ height: "50%" });
  });

  it("life readout labels the globe and shows current over max", () => {
    // PoE1 prints the value as a label above the globe, not as a number inside it.
    render(<Hud snapshot={makeSnap({ life: 50, maxLife: 100 })} />);
    const readout = screen.getByTestId("life-readout");
    expect(readout).toHaveTextContent("Life");
    expect(readout).toHaveTextContent("50/100");
  });

  it("mana readout labels the globe and shows current over max", () => {
    render(<Hud snapshot={makeSnap({})} />);
    const readout = screen.getByTestId("mana-readout");
    expect(readout).toHaveTextContent("Mana");
    expect(readout).toHaveTextContent("30/60");
  });

  it("skill with cooldown shows remaining seconds", () => {
    const snap = makeSnap({ cooldowns: { "skill.ember_bolt.v1": 1.5 } });
    render(<Hud snapshot={snap} />);
    expect(screen.getByText("1.5s")).toBeInTheDocument();
  });

  it("ready skills show no countdown", () => {
    // ember_bolt just hit 0 → ready; the other two still count down.
    const snap = makeSnap({
      cooldowns: {
        "skill.ember_bolt.v1": 0,
        "skill.cinder_ground.v1": 2,
        "skill.blink.v1": 4,
      },
    });
    render(<Hud snapshot={snap} />);
    expect(screen.getByTestId("skill-slot-1")).not.toHaveTextContent(/s$/);
    expect(screen.getByTestId("skill-slot-2")).toHaveTextContent("2.0s");
  });

  it("renders five keyed skill slots then the three mouse buttons", () => {
    render(<Hud snapshot={makeSnap({ cooldowns: {} })} />);
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByTestId(`skill-slot-${i}`)).toHaveTextContent(String(i));
    }
    for (const [i, label] of [[6, "L"], [7, "M"], [8, "R"]] as const) {
      expect(screen.getByTestId(`skill-slot-${i}`)).toHaveTextContent(label);
    }
  });

  it("renders boss bar and phase indicator when a boss entity is present", () => {
    const snap: Snapshot = {
      tick: 1,
      area: "map",
      portalsLeft: 4,
      mapOpen: true,
      areaTier: 0,
      atlasSeed: 0,
      completedNodes: [], waystones: [],
      player: testPlayer({ mana: 30 }),
      entities: [{ id: 10, kind: "monster", x: 0, y: 0, boss: true, bossPhase: 2, life: 600, maxLife: 1000 }],
      inventory: { cols: 12, rows: 5, items: [] },
    stash: { cols: 12, rows: 12, items: [] },
      equipment: {},
      shards: {},
    };
    render(<Hud snapshot={snap} />);
    expect(screen.getByTestId("boss-bar")).toBeInTheDocument();
    expect(screen.getByTestId("boss-phase")).toHaveTextContent("II");
  });

  it("renders no boss bar when no boss entity is present", () => {
    render(<Hud snapshot={makeSnap({})} />);
    expect(screen.queryByTestId("boss-bar")).toBeNull();
  });

  it("renders no boss bar while the boss is across the map, unengaged", () => {
    render(
      <Hud
        snapshot={makeSnap({
          entities: [{ id: 10, kind: "monster", x: 60, y: 0, boss: true, bossPhase: 1, life: 1000, maxLife: 1000 }],
        })}
      />,
    );
    expect(screen.queryByTestId("boss-bar")).toBeNull();
  });

  // --- flask row ---

  it("renders one life flask on Q and one mana flask on E", () => {
    render(<Hud snapshot={makeSnap({})} />);
    const row = screen.getByTestId("flask-row");
    expect(screen.getByTestId("flask-life")).toBeInTheDocument();
    expect(screen.getByTestId("flask-mana")).toBeInTheDocument();
    expect(row).toHaveTextContent("Q");
    expect(row).toHaveTextContent("E");
  });

  it("runs both bars to the screen edge and scales them off the globe", () => {
    render(<Hud snapshot={makeSnap({})} />);
    const flaskRow = screen.getByTestId("flask-row");
    const skillRow = screen.getByTestId("skill-row");
    // PoE1's lower bar reaches the screen side and the globe sits on top of its end.
    // A bar that starts past the ring reads as a separate floating box instead.
    expect(flaskRow).toHaveStyle({ left: "0px" });
    expect(skillRow).toHaveStyle({ right: "0px" });
    // Height in vw, like the globe: a fixed pixel bar shrinks against the globe as the
    // window widens, which is exactly what made it look detached.
    expect(flaskRow.style.height).toMatch(/vw$/);
    expect(skillRow.style.height).toMatch(/vw$/);
    // Both frames start on the line where the stash and the inventory end. PoE1's
    // flask panel is the shorter of the two on poe1-lower-bar.png, but stealing
    // those 28px back opens a strip of floor under the stash's foot, and the pane
    // meeting the bar cleanly is worth more than the step between the frames.
    const vw = (s: string) => parseFloat(s);
    expect(vw(flaskRow.style.height)).toBe(vw(skillRow.style.height));
  });

  it("recesses a rail between the skill rows and sizes the frame's chrome off the window", () => {
    render(<Hud snapshot={makeSnap({})} />);
    const skillRow = screen.getByTestId("skill-row");
    // The same 16:9 crop carries a heavy top edge (19px of its 2558px width), a thin
    // bottom lip (7px), and an 18px recessed rail between the mouse row and the numbered
    // row. Fixed pixels only hold that ratio at one window width.
    const bw = /border-width:\s*([^;]+)/.exec(skillRow.getAttribute("style") ?? "")?.[1] ?? "";
    const parts = bw.split(/\s+/);
    const top = parts[0] ?? "";
    const bottom = parts[2] ?? "";
    expect(top).toMatch(/vw$/);
    expect(bottom).toMatch(/vw$/);
    expect(parseFloat(top)).toBeGreaterThan(parseFloat(bottom));
    expect(screen.getByTestId("skill-rail").style.height).toMatch(/vw$/);
  });

  it("a full flask shows no veil, an empty one is fully veiled", () => {
    render(<Hud snapshot={makeSnap({ flasks: { lifeCharges: 7, lifeMax: 7, manaCharges: 0, manaMax: 7 } })} />);
    expect(screen.getByTestId("flask-life-veil")).toHaveStyle({ height: "0%" });
    expect(screen.getByTestId("flask-mana-veil")).toHaveStyle({ height: "100%" });
  });

  // --- area label ---

  it("shows Hideout label in hideout area", () => {
    render(<Hud snapshot={makeSnap({ area: "hideout" })} />);
    expect(screen.getByTestId("area-label")).toHaveTextContent("Hideout");
  });

  it("shows Map label in map area", () => {
    render(<Hud snapshot={makeSnap({ area: "map" })} />);
    expect(screen.getByTestId("area-label")).toHaveTextContent("Map");
  });

  // --- portal counter ---

  it("shows portal counter with correct budget when map is open", () => {
    render(<Hud snapshot={makeSnap({ area: "map", mapOpen: true, portalsLeft: 5 })} />);
    const counter = screen.getByTestId("portal-counter");
    expect(counter).toHaveTextContent(`Portals 5 / ${MAP_PORTALS}`);
  });

  it("hides portal counter when map is not open", () => {
    render(<Hud snapshot={makeSnap({ mapOpen: false })} />);
    expect(screen.queryByTestId("portal-counter")).toBeNull();
  });

  // --- hover-driven interact labels ---

  it("shows Map Device label when a mapDevice entity is hovered", () => {
    render(
      <Hud
        snapshot={makeSnap({ entities: [{ id: 1, kind: "mapDevice", x: 0, y: 0 }] })}
        hoveredEntityId={1}
      />,
    );
    expect(screen.getByTestId("interact-label")).toHaveTextContent("Map Device");
  });

  it("shows Enter Map when a portal is hovered in the hideout", () => {
    render(
      <Hud
        snapshot={makeSnap({
          area: "hideout",
          entities: [{ id: 2, kind: "portal", x: 0, y: 0 }],
        })}
        hoveredEntityId={2}
      />,
    );
    expect(screen.getByTestId("interact-label")).toHaveTextContent("Enter Map");
  });

  it("shows Return to Hideout when a portal is hovered in the map", () => {
    render(
      <Hud
        snapshot={makeSnap({
          area: "map",
          entities: [{ id: 3, kind: "portal", x: 0, y: 0 }],
        })}
        hoveredEntityId={3}
      />,
    );
    expect(screen.getByTestId("interact-label")).toHaveTextContent("Return to Hideout");
  });

  it("shows no interact label when hoveredEntityId is null", () => {
    render(
      <Hud
        snapshot={makeSnap({ entities: [{ id: 4, kind: "portal", x: 0, y: 0 }] })}
        hoveredEntityId={null}
      />,
    );
    expect(screen.queryByTestId("interact-label")).toBeNull();
  });

  it("inRange-only entity shows no label when not hovered", () => {
    // inRange is a distance check for the interact trigger, not a visual signal
    render(
      <Hud
        snapshot={makeSnap({ entities: [{ id: 5, kind: "portal", x: 0, y: 0, inRange: true }] })}
        hoveredEntityId={null}
      />,
    );
    expect(screen.queryByTestId("interact-label")).toBeNull();
  });
});

describe("experience bar", () => {
  it("fills to the share of the level that is banked, and prints the level", () => {
    render(<Hud snapshot={makeSnap({ level: 68, xp: 30_000, xpToNext: 120_000 })} />);
    expect(screen.getByTestId("xp-bar-fill")).toHaveStyle({ width: "25%" });
    expect(screen.getByTestId("xp-level").textContent).toContain("Level 68");
  });

  it("reads full at the level cap, where there is nothing left to earn", () => {
    render(<Hud snapshot={makeSnap({ level: 100, xp: 0, xpToNext: 0 })} />);
    expect(screen.getByTestId("xp-bar-fill")).toHaveStyle({ width: "100%" });
  });
});

describe("energy shield on the life globe", () => {
  it("shares the well with life and rides on top of it", () => {
    // 100 life + 100 shield: the liquid is the bottom half, the shield the top.
    render(<Hud snapshot={makeSnap({ life: 100, maxLife: 100, energyShield: 100, maxEnergyShield: 100 })} />);
    expect(screen.getByTestId("life-orb-fill")).toHaveStyle({ height: "50%" });
    const band = screen.getByTestId("life-orb-fill-shield");
    expect(band).toHaveStyle({ height: "50%", bottom: "50%" });
    expect(screen.getByTestId("life-readout")).toHaveTextContent("100/100 + 100");
  });

  it("is absent entirely without a shield, and the globe is the globe it was", () => {
    render(<Hud snapshot={makeSnap({ life: 50, maxLife: 100 })} />);
    expect(screen.getByTestId("life-orb-fill")).toHaveStyle({ height: "50%" });
    expect(screen.queryByTestId("life-orb-fill-shield")).toBeNull();
    expect(screen.getByTestId("life-readout")).toHaveTextContent("50/100");
  });
});

describe("Hud skill tooltip", () => {
  const emberBolt = {
    id: "skill.ember_bolt.v1",
    name: "Ember Bolt",
    description: "Launches a bolt of fire that bursts on the first enemy it strikes.",
    manaCost: 8,
    castTimeSec: 8 / 30,
    cooldownSec: 0.2,
    dps: 93.75,
    lines: ["Deals 25 Fire Damage"],
  };

  it("shows the hovered skill's name, cost and effect lines", async () => {
    render(<Hud snapshot={makeSnap({ skills: [emberBolt] })} />);
    fireEvent.mouseEnter(screen.getByTestId("skill-slot-1"));
    const tip = await screen.findByTestId("skill-tooltip");
    expect(tip).toHaveTextContent("Ember Bolt");
    expect(tip).toHaveTextContent("8 Mana");
    expect(tip).toHaveTextContent("0.27 sec");
    expect(tip).toHaveTextContent("Deals 25 Fire Damage");
    expect(tip).toHaveTextContent("bursts on the first enemy");
  });

  it("hides the tooltip again when the pointer leaves", () => {
    render(<Hud snapshot={makeSnap({ skills: [emberBolt] })} />);
    fireEvent.mouseEnter(screen.getByTestId("skill-slot-1"));
    fireEvent.mouseLeave(screen.getByTestId("skill-slot-1"));
    expect(screen.queryByTestId("skill-tooltip")).toBeNull();
  });

  it("takes pointer events, which the inert HUD overlay otherwise swallows", () => {
    render(<Hud snapshot={makeSnap({ skills: [emberBolt] })} />);
    expect(screen.getByTestId("skill-row")).toHaveStyle({ pointerEvents: "auto" });
  });

  it("has nothing to say about an empty socket", () => {
    render(<Hud snapshot={makeSnap({ skills: [emberBolt] })} />);
    fireEvent.mouseEnter(screen.getByTestId("skill-slot-4"));
    expect(screen.queryByTestId("skill-tooltip")).toBeNull();
  });
});

