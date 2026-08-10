// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
vi.mock("../audio/drop-sound", () => ({ playDropSound: vi.fn() }));
import { LootLabels } from "./LootLabels";
import { playDropSound } from "../audio/drop-sound";
import type { Snapshot } from "@exiled/protocol";
import { testStats } from "../test-fixtures";

afterEach(() => {
  cleanup();
  vi.mocked(playDropSound).mockClear();
});

function snapWith(entities: Snapshot["entities"]): Snapshot {
  return {
    tick: 1,
    area: "hideout",
    portalsLeft: 0,
    mapOpen: false,
    areaTier: 0,
    atlasSeed: 0,
    completedNodes: [],
    player: {
      id: 0, x: 0, y: 0, life: 100, maxLife: 100, mana: 30, maxMana: 60,
      energyShield: 0, maxEnergyShield: 0,
      cooldowns: {}, alive: true, casting: false, level: 65, xp: 0, xpToNext: 126_750, gold: 0,
      flasks: { lifeCharges: 7, lifeMax: 7, manaCharges: 7, manaMax: 7 }, stats: testStats(),
    },
    entities,
    inventory: { cols: 12, rows: 5, items: [] },
    stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] },
    equipment: {},
    shards: {},
  };
}

describe("LootLabels", () => {
  it("positions a new ground-item cue relative to the player", () => {
    const { rerender } = render(<LootLabels project={null} snapshot={snapWith([])} />);
    rerender(<LootLabels project={null} snapshot={snapWith([
      { id: 11, kind: "groundItem", x: 6, y: 0, rarity: "rare", name: "Doom Gaze" },
    ])} />);

    expect(playDropSound).toHaveBeenCalledOnce();
    const [, volume, pan] = vi.mocked(playDropSound).mock.calls[0]!;
    expect(volume).toBeLessThan(1);
    expect(pan).toBeGreaterThan(0);
  });

  it("plates every ground item and skips other entities", () => {
    render(
      <LootLabels
        project={null}
        snapshot={snapWith([
          { id: 7, kind: "groundItem", x: 1, y: 2, rarity: "rare", name: "Doom Gaze" },
          { id: 8, kind: "monster", x: 3, y: 4 },
        ])}
      />,
    );
    expect(screen.getByTestId("loot-label-7")).toHaveTextContent("Doom Gaze");
    expect(screen.queryByTestId("loot-label-8")).toBeNull();
  });

  it("colours the plate by rarity", () => {
    render(
      <LootLabels
        project={null}
        snapshot={snapWith([
          { id: 1, kind: "groundItem", x: 0, y: 0, rarity: "magic", name: "Sharp Wand" },
        ])}
      />,
    );
    expect(screen.getByTestId("loot-label-1")).toHaveAttribute("data-rarity", "magic");
  });

  it("positions plates from the projector each frame", async () => {
    render(
      <LootLabels
        project={(x, y) => ({ x: x * 10, y: y * 10, visible: true })}
        snapshot={snapWith([
          { id: 3, kind: "groundItem", x: 5, y: 4, rarity: "normal", name: "Rusted Blade" },
        ])}
      />,
    );
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const plate = screen.getByTestId("loot-label-3");
    expect(plate.style.transform).toContain("translate(50px, 14px)");
    expect(plate.style.visibility).toBe("visible");
  });

  it("stacks plates that project onto the same spot into a column", async () => {
    render(
      <LootLabels
        project={() => ({ x: 100, y: 100, visible: true })}
        snapshot={snapWith([
          { id: 1, kind: "groundItem", x: 0, y: 0, rarity: "normal", name: "One" },
          { id: 2, kind: "groundItem", x: 0, y: 0, rarity: "normal", name: "Two" },
        ])}
      />,
    );
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const ys = [1, 2].map((id) => {
      const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(
        screen.getByTestId(`loot-label-${id}`).style.transform,
      );
      return Number(m![2]);
    });
    expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThan(10);
  });

  it("gives a rare its base type on a second line, and hides it while unread", () => {
    render(
      <LootLabels
        project={null}
        snapshot={snapWith([
          { id: 4, kind: "groundItem", x: 0, y: 0, rarity: "rare", name: "Doom Gaze", baseName: "Iron Wand" },
          { id: 5, kind: "groundItem", x: 0, y: 0, rarity: "unique", name: "Ashmaw", baseName: "Ashmaw", unidentified: true },
        ])}
      />,
    );
    expect(screen.getByTestId("loot-label-4")).toHaveTextContent("Iron Wand");
    expect(screen.getByTestId("loot-label-5")).not.toHaveTextContent("Ashmaw Ashmaw");
  });

  it("keeps a normal drop to one line, since a normal item is its own base", () => {
    render(
      <LootLabels
        project={null}
        snapshot={snapWith([
          { id: 6, kind: "groundItem", x: 0, y: 0, rarity: "normal", name: "Waystone (Tier 1)", baseName: "Waystone" },
        ])}
      />,
    );
    expect(screen.getByTestId("loot-label-6")).not.toHaveTextContent("Waystone (Tier 1)Waystone");
  });

  it("asks to pick the item up when its plate is clicked", () => {
    const onPick = vi.fn();
    render(
      <LootLabels
        project={null}
        onPick={onPick}
        snapshot={snapWith([
          { id: 9, kind: "groundItem", x: 3, y: -2, rarity: "unique", name: "Ashmaw" },
        ])}
      />,
    );
    fireEvent.pointerDown(screen.getByTestId("loot-label-9"));
    expect(onPick).toHaveBeenCalledWith(9, 3, -2);
  });
});
