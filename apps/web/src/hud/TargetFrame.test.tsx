// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Snapshot, SnapshotEntity } from "@exiled/protocol";
import { TARGET_BAR_H, TARGET_BAR_W, TargetFrame } from "./TargetFrame";
import { Hud } from "./Hud";
import { testPlayer } from "../test-fixtures";

afterEach(cleanup);

const IMP = "monster.cinder_imp.v1";

function snap(entities: Partial<SnapshotEntity>[], areaTier = 2): Snapshot {
  return {
    tick: 1, area: "map", portalsLeft: 4, mapOpen: true, areaTier, atlasSeed: 0, completedNodes: [],
    player: testPlayer(),
    entities: entities.map((e) => ({ kind: "monster", x: 0, y: 0, ...e })) as SnapshotEntity[],
    inventory: { cols: 12, rows: 5, items: [] },
    stash: { cols: 12, rows: 12, items: [] },
    vendor: { cols: 12, rows: 12, items: [] },
    equipment: {}, shards: {},
  } as unknown as Snapshot;
}

describe("TargetFrame", () => {
  it("shows nothing with no target, a target that is gone, or the boss", () => {
    const s = snap([{ id: 1, species: IMP, life: 5, maxLife: 10 }, { id: 2, species: IMP, boss: true, life: 5, maxLife: 10 }]);
    const { rerender } = render(<TargetFrame snapshot={s} targetId={null} />);
    expect(screen.queryByTestId("target-frame")).toBeNull();
    rerender(<TargetFrame snapshot={s} targetId={9} />);
    expect(screen.queryByTestId("target-frame")).toBeNull();
    rerender(<TargetFrame snapshot={s} targetId={2} />);
    expect(screen.queryByTestId("target-frame")).toBeNull();
  });

  it("a normal monster: plain frame, off-white name in its life bar, and the area's level", () => {
    render(<TargetFrame snapshot={snap([{ id: 1, species: IMP, life: 25, maxLife: 100 }])} targetId={1} />);
    const frame = screen.getByTestId("target-frame");
    expect(frame.querySelector("[data-src]")).toHaveAttribute("data-src", "/hud/target-frame-normal-v1.webp");
    expect(frame.style.pointerEvents).toBe("none");
    expect(screen.getByTestId("target-name")).toHaveTextContent("Cinder Imp");
    expect(screen.getByTestId("target-name")).toHaveStyle({ color: "#e8e2d6" });
    expect(screen.getByTestId("target-fill")).toHaveStyle({ width: "25%" });
    expect(screen.getByTestId("target-level")).toHaveTextContent("Level 8");
    expect(screen.queryByTestId("target-mods")).toBeNull();
  });

  it("omits the level in the hideout, where no map is open", () => {
    render(<TargetFrame snapshot={snap([{ id: 1, species: IMP, life: 1, maxLife: 1 }], 0)} targetId={1} />);
    expect(screen.queryByTestId("target-level")).toBeNull();
  });

  it("a magic monster: blue name, magic frame, its two modifiers", () => {
    render(<TargetFrame snapshot={snap([{ id: 1, species: IMP, magic: true, life: 1, maxLife: 1 }])} targetId={1} />);
    expect(screen.getByTestId("target-frame").querySelector("[data-src]")).toHaveAttribute("data-src", "/hud/target-frame-magic-v1.webp");
    expect(screen.getByTestId("target-name")).toHaveStyle({ color: "#8888ff" });
    expect([...screen.getByTestId("target-mods").children].map((c) => c.textContent)).toEqual(["Extra Life", "Extra Damage"]);
  });

  it("a rare: yellow, its template's prefix and modifiers, then its attack element", () => {
    render(<TargetFrame snapshot={snap([{ id: 1, species: IMP, rare: true, element: "cold", life: 1, maxLife: 1 }])} targetId={1} />);
    expect(screen.getByTestId("target-frame").querySelector("[data-src]")).toHaveAttribute("data-src", "/hud/target-frame-rare-v1.webp");
    expect(screen.getByTestId("target-name")).toHaveTextContent("Frost-Touched Cinder Imp");
    expect(screen.getByTestId("target-name")).toHaveStyle({ color: "#ffff77" });
    expect([...screen.getByTestId("target-mods").children].map((c) => c.textContent))
      .toEqual(["Extra Life", "Moves Quickly", "Extra Damage", "Cold Attacks"]);
  });

  it("every tier's bar is the same size, whatever its frame art", () => {
    const sizes = [{}, { magic: true }, { rare: true, element: "fire" as const }].map((tier) => {
      render(<TargetFrame snapshot={snap([{ id: 1, species: IMP, life: 1, maxLife: 1, ...tier }])} targetId={1} />);
      const w = screen.getByTestId("target-window");
      const size = `${w.style.width} x ${w.style.height}`;
      cleanup();
      return size;
    });
    expect(sizes).toEqual(Array(3).fill(`${TARGET_BAR_W} x ${TARGET_BAR_H}`));
  });

  it("resistances under the right end, weakness in red; ailments under the left with burning's stacks", () => {
    render(
      <TargetFrame
        snapshot={snap([{ id: 1, species: IMP, life: 1, maxLife: 1, res: { fire: 30, lightning: -20 }, debuffs: ["burning", "poison"], ailmentStacks: 3 }])}
        targetId={1}
      />,
    );
    const res = screen.getByTestId("target-res");
    expect([...res.querySelectorAll("img")].map((i) => i.getAttribute("data-element"))).toEqual(["fire", "lightning"]);
    expect(res).toHaveTextContent("+30%");
    expect(screen.getByText("-20%")).toHaveStyle({ color: "#ff5040" });
    const debuffs = screen.getByTestId("target-debuffs");
    expect([...debuffs.querySelectorAll("img")].map((i) => i.getAttribute("src")))
      .toEqual(["/textures/buffs/burning.webp", "/textures/buffs/poison.webp"]);
    expect(debuffs).toHaveTextContent("3");
  });
});

describe("Hud target frame", () => {
  it("is narrower than the boss bar and sits under it while the boss bar is up", () => {
    const s = snap([
      { id: 1, species: IMP, life: 1, maxLife: 1 },
      { id: 10, species: "monster.mother_vhal.v1", boss: true, bossAwake: true, bossPhase: 1, life: 1, maxLife: 1 },
    ]);
    render(<Hud snapshot={s} targetId={1} />);
    const frame = screen.getByTestId("target-frame");
    const boss = screen.getByTestId("boss-bar");
    expect(parseFloat(frame.style.width)).toBeLessThan(parseFloat(boss.style.width));
    expect(parseFloat(frame.style.top)).toBeGreaterThan(parseFloat(boss.style.top) + parseFloat(boss.style.width) * 222 / 1280);
  });

  it("takes the boss bar's place at the top when no boss is up", () => {
    render(<Hud snapshot={snap([{ id: 1, species: IMP, life: 1, maxLife: 1 }])} targetId={1} />);
    expect(screen.getByTestId("target-frame").style.top).toBe("0.6vw");
  });
});
