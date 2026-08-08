// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import type { Snapshot } from "@exiled/protocol";
import { MonsterHealthBars } from "./MonsterHealthBars";

afterEach(cleanup);

function snapshotWith(entities: Snapshot["entities"]): Snapshot {
  return { tick: 0, entities } as unknown as Snapshot;
}

const project = (x: number, y: number) => ({ x: x * 10, y: y * 10, visible: true });

const monster = (over: Record<string, unknown>) =>
  ({ id: 1, kind: "monster", x: 0, y: 0, life: 40, maxLife: 100, ...over });

describe("MonsterHealthBars", () => {
  it("shows a bar over a damaged monster with the fill at its life fraction", () => {
    render(
      <MonsterHealthBars
        snapshot={snapshotWith([monster({ id: 3 })] as Snapshot["entities"])}
        project={project}
      />,
    );
    const fill = screen.getByTestId("monster-hp-3").firstElementChild as HTMLElement;
    expect(fill.style.width).toBe("40%");
  });

  it("stays hidden at full life: the bar appears only once damage lands", () => {
    render(
      <MonsterHealthBars
        snapshot={snapshotWith([monster({ id: 3, life: 100 })] as Snapshot["entities"])}
        project={project}
      />,
    );
    expect(screen.queryByTestId("monster-hp-3")).toBeNull();
  });

  it("draws nothing over the dead, the boss, or anything that is not a monster", () => {
    render(
      <MonsterHealthBars
        snapshot={snapshotWith([
          monster({ id: 1, life: 0 }),
          monster({ id: 2, boss: true }),
          monster({ id: 4, kind: "vendor" }),
        ] as Snapshot["entities"])}
        project={project}
      />,
    );
    expect(screen.queryByTestId("monster-hp-1")).toBeNull();
    expect(screen.queryByTestId("monster-hp-2")).toBeNull();
    expect(screen.queryByTestId("monster-hp-4")).toBeNull();
  });

  it("never eats a click", () => {
    render(
      <MonsterHealthBars
        snapshot={snapshotWith([monster({ id: 3 })] as Snapshot["entities"])}
        project={project}
      />,
    );
    expect(screen.getByTestId("monster-hp-3").style.pointerEvents).toBe("none");
  });
});
