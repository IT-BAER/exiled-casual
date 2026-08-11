// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";

// The banner's other half is the sound. jsdom has no WebAudio, and the assertion
// worth making is "the reward was announced", not what it sounded like.
vi.mock("../audio/drop-sound", () => ({ playDropSound: vi.fn() }));
import { playDropSound } from "../audio/drop-sound";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { Hud } from "./Hud";
import { VENDOR_NAME, VENDOR_TITLE } from "../npc";
import { xpPerHour, TICK_BACKGROUND, TICK_BACKGROUND_EMPTY, RAIL_H } from "./XpBar";
import type { Snapshot } from "@exiled/protocol";
import { MAP_PORTALS } from "@exiled/protocol";
import { testPlayer, testStats } from "../test-fixtures";

// No globals:true in this repo, so @testing-library/react does not auto-register
// its afterEach cleanup — do it explicitly or renders leak across tests.
afterEach(cleanup);
// The module mock's spy is created once for the file, so its call log survives
// cleanup and a later test would inherit an earlier test's ring.
afterEach(() => vi.mocked(playDropSound).mockClear());

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
  /** Waystone items to seed into inventory.items for the reward-banner tests. */
  waystoneItems?: number;
  passivePoints?: number;
}): Snapshot {
  // Build a minimal inventory with `waystoneItems` 1x1 waystone cells, if any.
  const waystoneInv = overrides.waystoneItems
    ? Array.from({ length: overrides.waystoneItems }, (_, i) => ({
        x: i, y: 0, w: 1, h: 1,
        rarity: "magic" as const, name: "Waystone", lines: [],
        baseId: "map.waystone",
      }))
    : [];
  return {
    tick: 1,
    area: overrides.area ?? "hideout",
    portalsLeft: overrides.portalsLeft ?? 0,
    mapOpen: overrides.mapOpen ?? false,
    areaTier: 0,
    atlasSeed: 0,
    completedNodes: [],
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
      xpToNext: overrides.xpToNext ?? 126_750,
      gold: 0,
      flasks: overrides.flasks ?? { lifeCharges: 7, lifeMax: 7, manaCharges: 7, manaMax: 7 },
      ...(overrides.passivePoints === undefined ? {} : { passivePoints: overrides.passivePoints }),
      stats: testStats(),
    },
    entities: overrides.entities ?? [],
    inventory: { cols: 12, rows: 5, items: waystoneInv },
    stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] },
    equipment: {},
    shards: {},
  };
}

// The bar is server-authoritative (Snapshot.skillBar) and the Hud defaults to
// empty, so every test that cares which skill sits in which socket passes this.
const BAR = ["skill.ember_bolt.v1", "skill.cinder_ground.v1", "skill.blink.v1", null, null];

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
    render(<Hud snapshot={snap} skillBar={BAR} />);
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
    render(<Hud snapshot={snap} skillBar={BAR} />);
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
      completedNodes: [],
      player: testPlayer({ mana: 30 }),
      entities: [{ id: 10, kind: "monster", x: 0, y: 0, boss: true, bossPhase: 2, life: 600, maxLife: 1000 }],
      inventory: { cols: 12, rows: 5, items: [] },
    stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] },
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

  it("carries the bar's stone across the gap between the two panels, behind them", () => {
    render(<Hud snapshot={makeSnap({})} />);
    const band = screen.getByTestId("bar-connector");
    // Edge to edge, or the lit floor shows through beside the panels again.
    expect(band).toHaveStyle({ left: "0px", right: "0px", bottom: "0px" });
    // Behind the panels (2) and the globes (3), in front of nothing but the world.
    expect(band.style.zIndex).toBe("1");
    // Trim, not a slab: the panels stay the raised ends, and every vw of stretched
    // middle is playfield spent on a plain dark block.
    const vw = (s: string) => parseFloat(/(-?[\d.]+)vw/.exec(s)?.[1] ?? "NaN");
    const skillRow = screen.getByTestId("skill-row");
    const ratio = vw(band.style.height) / vw(screen.getByTestId("skill-row").style.height);
    expect(vw(skillRow.style.height)).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(0.25);
    // But never shorter than its own carved edges, or the nine-slice crushes them
    // into each other. jsdom folds the calc, so the band's height is comparable.
    const edges = /border-width:\s*([^;]+)/.exec(band.getAttribute("style") ?? "")?.[1] ?? "";
    const [top, , bottom] = edges.split(/\s+/);
    expect(vw(band.style.height)).toBeGreaterThan(vw(top ?? "") + vw(bottom ?? ""));
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
  it("fills to the share of the level that is banked", () => {
    render(<Hud snapshot={makeSnap({ level: 68, xp: 30_000, xpToNext: 120_000 })} />);
    expect(screen.getByTestId("xp-bar-fill")).toHaveStyle({ width: "25%" });
  });

  it("reads full at the level cap, where there is nothing left to earn", () => {
    render(<Hud snapshot={makeSnap({ level: 100, xp: 0, xpToNext: 0 })} />);
    expect(screen.getByTestId("xp-bar-fill")).toHaveStyle({ width: "100%" });
  });

  it("prints no number until asked: the rail carries no text", () => {
    render(<Hud snapshot={makeSnap({ level: 68, xp: 30_000, xpToNext: 120_000 })} />);
    expect(screen.getByTestId("xp-bar").textContent).toBe("");
    expect(screen.queryByTestId("xp-tooltip")).toBeNull();
  });

  it("hands over level, experience and experience per hour on hover", async () => {
    render(<Hud snapshot={makeSnap({ level: 68, xp: 30_000, xpToNext: 120_000 })} />);
    fireEvent.pointerEnter(screen.getByTestId("xp-bar-hit"));
    const tip = screen.getByTestId("xp-tooltip").textContent ?? "";
    expect(tip).toContain("Level 68");
    expect(tip).toContain("30,000 / 120,000");
    expect(tip).toContain("Exp/Hour");
    fireEvent.pointerLeave(screen.getByTestId("xp-bar-hit"));
    expect(screen.queryByTestId("xp-tooltip")).toBeNull();
  });

  /**
   * The hover above passed for months while the tooltip was UNREACHABLE in the real
   * app: fireEvent dispatches straight at the node, but the HUD root is
   * `pointerEvents: none` so the canvas won the hit test at every pixel of the rail
   * and no pointer event was ever generated. jsdom does not hit-test, so the closest
   * honest check is the one thing hit-testing depends on: whether the nearest
   * declaration up the tree lets the pointer land at all.
   */
  it("the rail is reachable by a pointer, and is a target a hand can actually hit", () => {
    render(<Hud snapshot={makeSnap({ level: 68, xp: 30_000, xpToNext: 120_000 })} />);
    const hit = screen.getByTestId("xp-bar-hit");
    let declared: string | null = null;
    for (let n: HTMLElement | null = hit; n && declared === null; n = n.parentElement) {
      declared = n.style.pointerEvents || null;
    }
    expect(declared).toBe("auto");
    // The rail is a hairline by design, so the pointer target is taller than it.
    expect(Number.parseInt(hit.style.height, 10)).toBeGreaterThan(RAIL_H * 2);
  });

  it("stays behind the bar panels, the way PoE1's rail runs under the stone", () => {
    render(<Hud snapshot={makeSnap({ level: 68, xp: 30_000, xpToNext: 120_000 })} />);
    expect(screen.getByTestId("xp-bar")).toHaveStyle({ zIndex: "1" });
  });

  /**
   * The rail runs BETWEEN the panels, not under them: at 14% of a full-width
   * rail the whole fill sat behind the flask panel's opaque stone and the bar
   * read as empty (poe1-lower-bar.png starts its rail past the flask assembly
   * too). The panels are content-sized, so the insets are measured off them.
   */
  it("starts after the flask panel and ends before the skill panel", () => {
    const orig = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")!;
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get(this: HTMLElement) {
        const t = this.getAttribute("data-testid");
        return t === "flask-row" ? 340 : t === "skill-row" ? 520 : 0;
      },
    });
    try {
      render(<Hud snapshot={makeSnap({ level: 68, xp: 30_000, xpToNext: 120_000 })} />);
      expect(screen.getByTestId("xp-bar").style.left).toBe("340px");
      expect(screen.getByTestId("xp-bar").style.right).toBe("520px");
      expect(screen.getByTestId("xp-bar-hit").style.left).toBe("340px");
      expect(screen.getByTestId("xp-bar-hit").style.right).toBe("520px");
    } finally {
      Object.defineProperty(HTMLElement.prototype, "offsetWidth", orig);
    }
  });

  it("ticks the rail every 5% of the level, so the segments say something", () => {
    render(<Hud snapshot={makeSnap({ level: 68, xp: 30_000, xpToNext: 120_000 })} />);
    const ticks = screen.getByTestId("xp-bar-ticks");
    // Percent, not pixels: 20 segments however wide the screen is. jsdom cannot
    // read the applied gradient back, so the string is pinned at the source.
    expect(TICK_BACKGROUND).toContain("calc(5% - 2px) 5%");
    // A stud on an unbroken line, never a gap in it: the divider carries a lit
    // pip, and nothing in it is opaque black.
    expect(TICK_BACKGROUND).toContain("rgba(255,244,214,0.95)");
    expect(TICK_BACKGROUND).not.toContain("rgba(0,0,0,0.62)");
    expect(RAIL_H).toBeLessThan(6);
    // The pip has to out-brighten the fill's own pale core (#ffd98f) or the studs
    // vanish on the lit half of the rail, which is the half being measured.
    expect(TICK_BACKGROUND).toContain("244");
    // The LIT studs stop where the fill does.
    expect(ticks.style.clipPath).toBe("inset(0 75% 0 0)");
    // But the studs themselves run the whole rail, unlit, or an empty bar is a
    // plain dark line nobody would read as an experience track.
    const empty = screen.getByTestId("xp-bar-ticks-empty");
    expect(empty.style.clipPath).toBe("");
    expect(TICK_BACKGROUND_EMPTY).toContain("rgba(178,158,116,0.7)");
    expect(TICK_BACKGROUND_EMPTY).not.toContain("rgba(255,244,214,0.95)");
  });
});

describe("experience per hour", () => {
  it("is withheld until the window is wide enough to mean anything", () => {
    expect(xpPerHour([])).toBeNull();
    expect(xpPerHour([{ t: 0, total: 0 }])).toBeNull();
    expect(xpPerHour([{ t: 0, total: 0 }, { t: 500, total: 900 }])).toBeNull();
  });

  it("extrapolates the window's gain to an hour", () => {
    // 6000 experience banked over a minute is 360k an hour.
    expect(xpPerHour([{ t: 1000, total: 200 }, { t: 61_000, total: 6200 }])).toBe(360_000);
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
    gemLevel: 1,
    gemXp: 0,
    gemXpToNext: 60,
    breakpoints: [],
  };

  it("shows the hovered skill's name, cost and effect lines", async () => {
    render(<Hud snapshot={makeSnap({ skills: [emberBolt] })} skillBar={BAR} />);
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

  it("clicking a socket opens a tile picker whose tiles carry their bound key and tooltip", async () => {
    // Laid out from reference-screenshots/skill-action-bar.webp: sectioned icon
    // tiles, each captioned with the key it already answers to.
    render(<Hud snapshot={makeSnap({ skills: [emberBolt] })} skillBar={BAR} />);
    fireEvent.click(screen.getByTestId("skill-slot-1"));
    const picker = await screen.findByTestId("skill-picker");
    expect(picker).toHaveTextContent("Actions");
    expect(picker).toHaveTextContent("Skills");
    // Ember Bolt sits on socket 1, so its tile wears "1".
    expect(screen.getByTestId("pick-skill.ember_bolt.v1")).toHaveTextContent("1");
    // Move and Clear are the built-in actions, always offered.
    expect(screen.getByTestId("pick-builtin.move")).toBeTruthy();
    expect(screen.getByTestId("pick-clear")).toBeTruthy();
    // Hovering a tile shows the same detail tooltip the bar does.
    fireEvent.pointerEnter(screen.getByTestId("pick-skill.ember_bolt.v1"));
    const tip = await screen.findByTestId("skill-tooltip");
    expect(tip).toHaveTextContent("Ember Bolt");
    expect(tip).toHaveTextContent("Deals 25 Fire Damage");
  });
});


describe("Hud reward banner", () => {
  it("says nothing on the first snapshot it ever sees", () => {
    render(<Hud snapshot={makeSnap({ level: 12, waystoneItems: 1 })} />);
    expect(screen.queryByTestId("reward-banner")).toBeNull();
    expect(playDropSound).not.toHaveBeenCalled();
  });

  it("rings and names the level the fixed track just paid", () => {
    const { rerender } = render(<Hud snapshot={makeSnap({ level: 12 })} />);
    rerender(<Hud snapshot={makeSnap({ level: 13 })} />);
    expect(screen.getByTestId("reward-banner")).toHaveTextContent("Level 13");
    expect(playDropSound).toHaveBeenCalled();
  });

  it("rings and counts the stones a cleared map hands back", () => {
    const { rerender } = render(<Hud snapshot={makeSnap({ waystoneItems: 1 })} />);
    rerender(<Hud snapshot={makeSnap({ waystoneItems: 3 })} />);
    expect(screen.getByTestId("reward-banner")).toHaveTextContent("Waystone x2");
    expect(playDropSound).toHaveBeenCalled();
  });

  it("spends a boss kill that pays both on one line, not two banners", () => {
    const { rerender } = render(<Hud snapshot={makeSnap({ level: 12 })} />);
    rerender(<Hud snapshot={makeSnap({ level: 13, waystoneItems: 1 })} />);
    const banner = screen.getByTestId("reward-banner");
    expect(banner).toHaveTextContent("Level 13");
    expect(banner).toHaveTextContent("Waystone");
  });

  it("still clears itself when the next snapshot is not a win", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<Hud snapshot={makeSnap({ waystoneItems: 0 })} />);
      rerender(<Hud snapshot={makeSnap({ waystoneItems: 1 })} />);
      expect(screen.getByTestId("reward-banner")).toHaveTextContent("Waystone");
      // Spending the stone on a map re-runs the payout effect. The dismissal must
      // not die with it, or the banner hangs on screen for the rest of the run.
      rerender(<Hud snapshot={makeSnap({ waystoneItems: 0 })} />);
      act(() => { vi.advanceTimersByTime(3000); });
      expect(screen.queryByTestId("reward-banner")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays quiet when a stone is spent rather than won", () => {
    const { rerender } = render(<Hud snapshot={makeSnap({ waystoneItems: 1 })} />);
    rerender(<Hud snapshot={makeSnap({ waystoneItems: 0 })} />);
    expect(screen.queryByTestId("reward-banner")).toBeNull();
    expect(playDropSound).not.toHaveBeenCalled();
  });
});

describe("Hud gem levels and breakpoints", () => {
  const emberBolt = {
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
  };
  const blink = {
    id: "skill.blink.v1",
    name: "Blink",
    description: "Teleports a short distance.",
    manaCost: 15,
    castTimeSec: 0,
    cooldownSec: 3,
    lines: [],
    gemLevel: 1,
    gemXp: 0,
    gemXpToNext: 60,
    breakpoints: [],
  };

  it("raises the banner when a gem levels", () => {
    const { rerender } = render(<Hud snapshot={makeSnap({ skills: [emberBolt] })} />);
    rerender(<Hud snapshot={makeSnap({ skills: [{ ...emberBolt, gemLevel: 2 }] })} />);
    const banner = screen.getByTestId("reward-banner");
    expect(banner).toHaveTextContent("Ember Bolt");
    expect(banner).toHaveTextContent("Level 2");
  });

  it("raises the banner naming what changed when a breakpoint is crossed", () => {
    const { rerender } = render(<Hud snapshot={makeSnap({ skills: [emberBolt] })} />);
    rerender(
      <Hud snapshot={makeSnap({ skills: [{ ...emberBolt, breakpoints: ["Level 4: Adds Burning"] }] })} />,
    );
    expect(screen.getByTestId("reward-banner")).toHaveTextContent("Adds Burning");
    // A breakpoint is the loudest of the three: it must ring the "unique" sound,
    // not the plain "rare" a bare gem level-up gets.
    expect(playDropSound).toHaveBeenCalledWith("unique");
  });

  it("announces every breakpoint crossed in one tick, not just the last", () => {
    // A boss kill can carry a gem past two thresholds at once.
    const { rerender } = render(<Hud snapshot={makeSnap({ skills: [emberBolt] })} />);
    rerender(
      <Hud snapshot={makeSnap({
        skills: [{ ...emberBolt, breakpoints: ["Level 4: Adds Burning", "Level 6: Bigger Radius"] }],
      })} />,
    );
    const banner = screen.getByTestId("reward-banner");
    expect(banner).toHaveTextContent("Adds Burning");
    expect(banner).toHaveTextContent("Bigger Radius");
  });

  it("announces and flashes a newly unlocked gem", () => {
    // The sim auto-slots a fresh unlock into the first free numbered socket
    // (as of 94f76ed); a silent, un-flashed new socket is a reward that did
    // not happen.
    const { rerender } = render(
      <Hud snapshot={makeSnap({ skills: [emberBolt] })} skillBar={["skill.ember_bolt.v1", null, null, null, null]} />,
    );
    rerender(
      <Hud
        snapshot={makeSnap({ skills: [emberBolt, blink] })}
        skillBar={["skill.ember_bolt.v1", "skill.blink.v1", null, null, null]}
      />,
    );
    expect(screen.getByTestId("reward-banner")).toHaveTextContent("Blink Unlocked");
    expect(screen.getByTestId("skill-slot-2")).toHaveAttribute("data-flash", "1");
  });

  it("stays silent when the save arrives, not just on the very first snapshot", () => {
    // The worker starts its clock before hydrate() resolves, so snapshot 1 is a
    // pre-hydration world with no gems and snapshot 2 is the whole restored save.
    // Read as unlocks, that is a banner, a bar-wide flash and a sound on every
    // login, which is exactly what the first-snapshot guard cannot see.
    const { rerender } = render(<Hud snapshot={makeSnap({ skills: [] })} />);
    rerender(
      <Hud
        snapshot={makeSnap({
          skills: [
            { ...emberBolt, gemLevel: 8, breakpoints: ["Pierces one enemy"] },
            { ...blink, gemLevel: 8 },
          ],
        })}
        skillBar={BAR}
      />,
    );
    expect(screen.queryByTestId("reward-banner")).toBeNull();
    expect(playDropSound).not.toHaveBeenCalled();
  });

  it("does not congratulate on the first snapshot", () => {
    render(<Hud snapshot={makeSnap({ skills: [{ ...emberBolt, gemLevel: 5 }] })} />);
    expect(screen.queryByTestId("reward-banner")).toBeNull();
  });

  it("shares one banner when a character level and a gem level land on the same kill", () => {
    const { rerender } = render(
      <Hud snapshot={makeSnap({ level: 12, skills: [emberBolt] })} />,
    );
    rerender(
      <Hud snapshot={makeSnap({ level: 13, skills: [{ ...emberBolt, gemLevel: 2 }] })} />,
    );
    const banners = screen.getAllByTestId("reward-banner");
    expect(banners).toHaveLength(1);
    expect(banners[0]).toHaveTextContent("Level 13");
    expect(banners[0]).toHaveTextContent("Ember Bolt");
  });

  it("flashes the bar slot the gem that levelled sits in, and only that one", () => {
    const { rerender } = render(
      <Hud snapshot={makeSnap({ skills: [emberBolt, blink] })} skillBar={BAR} />,
    );
    rerender(
      <Hud snapshot={makeSnap({ skills: [emberBolt, { ...blink, gemLevel: 2 }] })} skillBar={BAR} />,
    );
    // A steady-state tick with the SAME values, in a fresh object: the sim
    // hands the HUD a new snapshot every 33ms whether or not anything
    // changed, and that must not clear a flash that just lit.
    rerender(
      <Hud snapshot={makeSnap({ skills: [emberBolt, { ...blink, gemLevel: 2 }] })} skillBar={BAR} />,
    );
    // BAR sits blink in socket index 2, drawn as skill-slot-3; ember_bolt in
    // socket index 0, drawn as skill-slot-1.
    expect(screen.getByTestId("skill-slot-3")).toHaveAttribute("data-flash", "1");
    expect(screen.getByTestId("skill-slot-1")).not.toHaveAttribute("data-flash");
  });

  it("stops flashing after the flash duration", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <Hud snapshot={makeSnap({ skills: [blink] })} skillBar={BAR} />,
      );
      rerender(<Hud snapshot={makeSnap({ skills: [{ ...blink, gemLevel: 2 }] })} skillBar={BAR} />);
      // Same steady-state tick as above: the flash must survive it before the
      // duration check means anything.
      rerender(<Hud snapshot={makeSnap({ skills: [{ ...blink, gemLevel: 2 }] })} skillBar={BAR} />);
      expect(screen.getByTestId("skill-slot-3")).toHaveAttribute("data-flash", "1");
      act(() => { vi.advanceTimersByTime(2500); });
      expect(screen.getByTestId("skill-slot-3")).not.toHaveAttribute("data-flash");
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Dragging a skill from one socket to another. A swap and not an insert: five
 * sockets and three skills means dropping onto an occupied one has to put
 * something back, and pushing the row along would move a skill nobody touched.
 */
describe("skill bar drag and drop", () => {

  /** One HTML5 drag, start to drop, with the dataTransfer the handlers read. */
  function drag(fromSlot: number, toSlot: number) {
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => { data.set(k, v); },
      getData: (k: string) => data.get(k) ?? "",
      effectAllowed: "",
    };
    fireEvent.dragStart(screen.getByTestId(`skill-slot-${fromSlot}`), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId(`skill-slot-${toSlot}`), { dataTransfer });
    fireEvent.drop(screen.getByTestId(`skill-slot-${toSlot}`), { dataTransfer });
  }

  it("moves a skill into an empty socket", () => {
    const seen: (string | null)[][] = [];
    render(<Hud snapshot={makeSnap({})} skillBar={BAR} onSkillBarChange={(b) => seen.push(b)} />);
    drag(1, 4);
    expect(seen[0]!.slice(0, 5)).toEqual([null, "skill.cinder_ground.v1", "skill.blink.v1", "skill.ember_bolt.v1", null]);
  });

  it("swaps two occupied sockets", () => {
    const seen: (string | null)[][] = [];
    render(<Hud snapshot={makeSnap({})} skillBar={BAR} onSkillBarChange={(b) => seen.push(b)} />);
    drag(1, 3);
    // The whole array, not a slice: this is what goes out as the setSkillBar
    // intent, and the sim indexes the mouse row off a full-length bar.
    expect(seen).toEqual([[
      "skill.blink.v1", "skill.cinder_ground.v1", "skill.ember_bolt.v1", null, null,
      null, null, null,
    ]]);
  });

  it("dropping a socket on itself changes nothing", () => {
    const seen: (string | null)[][] = [];
    render(<Hud snapshot={makeSnap({})} skillBar={BAR} onSkillBarChange={(b) => seen.push(b)} />);
    drag(2, 2);
    expect(seen).toEqual([]);
  });

  it("an empty socket cannot be picked up", () => {
    render(<Hud snapshot={makeSnap({})} skillBar={BAR} />);
    expect(screen.getByTestId("skill-slot-1").getAttribute("draggable")).toBe("true");
    expect(screen.getByTestId("skill-slot-4").getAttribute("draggable")).toBe("false");
  });

  /** Nothing fires off a mouse socket yet, so a skill dropped there would vanish. */
  /**
   * The icon covers the tile edge to edge, so a draggable img is what the pointer
   * actually grabs: the browser drags the image and the tile's own dragStart never
   * runs. jsdom fires drag events at the div, so every other test here passes while
   * the bar is unusable in a real browser. This is the only guard against that.
   */
  it("the icon does not steal the tile's drag", () => {
    render(<Hud snapshot={makeSnap({})} skillBar={BAR} />);
    const icon = screen.getByTestId("skill-slot-1").querySelector("img");
    expect(icon).not.toBeNull();
    expect(icon!.getAttribute("draggable")).toBe("false");
  });

  it("the mouse row takes no drops", () => {
    render(<Hud snapshot={makeSnap({})} skillBar={BAR} />);
    expect(screen.getByTestId("skill-slot-6").getAttribute("draggable")).toBe("false");
  });

  it("draws the icon of whatever the bar puts in a socket", () => {
    const { container } = render(
      <Hud snapshot={makeSnap({})} skillBar={[null, null, null, null, "skill.ember_bolt.v1"]} />,
    );
    const imgs = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(imgs.filter((src) => src?.includes("ember_bolt"))).toHaveLength(1);
    expect(screen.getByTestId("skill-slot-5").querySelector("img")).not.toBeNull();
    expect(screen.getByTestId("skill-slot-1").querySelector("img")).toBeNull();
  });

  it("draws an empty bar when no bar is given, rather than a default of its own", () => {
    render(<Hud snapshot={makeSnap({})} />);
    for (let i = 1; i <= 8; i++) {
      expect(screen.getByTestId(`skill-slot-${i}`).querySelector("img")).toBeNull();
    }
  });
});

/**
 * The disenchanter is a man now, not a brazier with a job title. His label carries
 * his name because "Vendor" is a form field, and PoE's vendors are Nessa and
 * Tarkleigh before they are a shop.
 */
describe("the disenchanter has a name", () => {
  it("hovering him reads his name and his trade", () => {
    const snap = makeSnap({});
    const withVendor: Snapshot = {
      ...snap,
      entities: [...snap.entities, { id: 42, kind: "vendor", x: 2, y: 2 }],
    };
    render(<Hud snapshot={withVendor} hoveredEntityId={42} />);
    expect(screen.getByTestId("interact-label").textContent).toContain(VENDOR_NAME);
    expect(screen.getByTestId("interact-label").textContent).toContain(VENDOR_TITLE);
  });
});

/**
 * The tree's affordance: a "+" button on the lower bar (right of the flasks),
 * PoE1-style. It is always there — the tree is always reachable — and carries the
 * unspent count as a badge, because a level-up that hands you something you cannot
 * find is a reward that did not happen (docs/09).
 */
describe("unspent passive points", () => {
  it("shows the count as a badge on the plus button", () => {
    const { getByTestId } = render(<Hud snapshot={makeSnap({ passivePoints: 3 })} />);
    expect(getByTestId("passive-open-count").textContent).toContain("3");
  });

  it("opens the tree when the plus is clicked", () => {
    const onOpenPassives = vi.fn();
    const { getByTestId } = render(
      <Hud snapshot={makeSnap({ passivePoints: 2 })} onOpenPassives={onOpenPassives} />,
    );
    getByTestId("passive-open-button").click();
    expect(onOpenPassives).toHaveBeenCalledTimes(1);
  });

  it("drops the badge when the last point is spent, but keeps the button", () => {
    const { getByTestId, queryByTestId } = render(<Hud snapshot={makeSnap({ passivePoints: 0 })} />);
    expect(queryByTestId("passive-open-count")).toBeNull();
    expect(getByTestId("passive-open-button")).not.toBeNull();
  });
});
