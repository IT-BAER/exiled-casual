// @vitest-environment jsdom
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import type { MenuStage as Stage } from "../render/menu-scene";

let resolveStage: (stage: Stage) => void = () => {};
vi.mock("../render/menu-scene", () => ({
  createMenuStage: () => new Promise<Stage>((resolve) => { resolveStage = resolve; }),
}));

const { MenuStage } = await import("./MenuStage");

describe("MenuStage", () => {
  /** The wardrobe takes seconds to load; CREATE picks a class inside that window. */
  it("dresses the class picked while the stage was still loading", async () => {
    const setLooks = vi.fn();
    const view = render(<MenuStage classId={null} />);
    view.rerender(<MenuStage classId="class.stalker" />);
    await act(async () => resolveStage({ setLooks, dissolve: vi.fn(), dispose: vi.fn() } as unknown as Stage));
    expect(setLooks).toHaveBeenLastCalledWith(expect.objectContaining({ chest: expect.any(String) }));
  });
});
