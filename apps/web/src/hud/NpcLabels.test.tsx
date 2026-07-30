// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";
import type { Snapshot } from "@exiled/protocol";
import { NpcLabels } from "./NpcLabels";
import { VENDOR_NAME } from "../npc";

afterEach(cleanup);

function snapshotWith(entities: Snapshot["entities"]): Snapshot {
  return { tick: 0, entities } as unknown as Snapshot;
}

const project = (x: number, y: number) => ({ x: x * 10, y: y * 10, visible: true });

describe("NpcLabels", () => {
  it("names every npc in the snapshot", () => {
    render(
      <NpcLabels
        snapshot={snapshotWith([{ id: 7, kind: "vendor", x: 3, y: 4 }] as Snapshot["entities"])}
        project={project}
      />,
    );
    expect(screen.getByTestId("npc-label-7").textContent).toBe(VENDOR_NAME);
  });

  it("labels nothing but npcs", () => {
    render(
      <NpcLabels
        snapshot={snapshotWith([
          { id: 1, kind: "monster", x: 0, y: 0 },
          { id: 2, kind: "stash", x: 1, y: 1 },
        ] as Snapshot["entities"])}
        project={project}
      />,
    );
    expect(screen.queryByTestId("npc-label-1")).toBeNull();
    expect(screen.queryByTestId("npc-label-2")).toBeNull();
  });

  it("draws the name bare: no plate, only a shadow, and never eats a click", () => {
    render(
      <NpcLabels
        snapshot={snapshotWith([{ id: 7, kind: "vendor", x: 3, y: 4 }] as Snapshot["entities"])}
        project={project}
      />,
    );
    const style = screen.getByTestId("npc-label-7").style;
    expect(style.background).toBe("");
    expect(style.border).toBe("");
    expect(style.textShadow).not.toBe("");
    expect(style.pointerEvents).toBe("none");
  });
});
