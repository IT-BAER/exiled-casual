// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AssetSpawner } from "./AssetSpawner";
import { SPAWN_KINDS } from "@exiled/protocol";

function renderSpawner(onSim = vi.fn()) {
  render(
    <AssetSpawner
      standing={0}
      onSpawn={vi.fn()}
      onClear={vi.fn()}
      onClose={vi.fn()}
      onSim={onSim}
    />,
  );
  return onSim;
}

describe("AssetSpawner", () => {
  afterEach(cleanup);

  it("offers every lab spawn kind the protocol accepts", () => {
    renderSpawner();
    // The menu is the whole surface: a kind reachable only by a numpad key is a
    // kind nobody finds. SPAWN_KINDS is the list, so adding one fails here first.
    for (const kind of SPAWN_KINDS) {
      expect(screen.getByTestId(`sim-${kind}`)).toBeTruthy();
    }
  });

  it("sends the kind the button names, level up included", () => {
    const onSim = renderSpawner();
    fireEvent.click(screen.getByTestId("sim-levelup"));
    expect(onSim).toHaveBeenCalledWith("levelup");
    fireEvent.click(screen.getByTestId("sim-boss"));
    expect(onSim).toHaveBeenLastCalledWith("boss");
  });
});
