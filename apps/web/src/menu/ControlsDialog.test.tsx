// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ControlsDialog } from "./ControlsDialog";
import { DEFAULT_KEYBINDS_BY_MODE } from "../settings";

afterEach(cleanup);

describe("ControlsDialog", () => {
  it("offers both schemes and reports the one picked", () => {
    const onPick = vi.fn();
    render(<ControlsDialog onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /wasd/i }));
    expect(onPick).toHaveBeenCalledWith("wasd");
    fireEvent.click(screen.getByRole("button", { name: /mouse/i }));
    expect(onPick).toHaveBeenLastCalledWith("mouse");
  });

  it("shows each scheme's keys, PoE2's layout", () => {
    render(<ControlsDialog onPick={() => {}} />);
    const mouse = screen.getByTestId("controls-mouse");
    const wasd = screen.getByTestId("controls-wasd");
    expect(mouse.textContent).toContain("QWERT");
    expect(wasd.textContent).toContain("QERTF");
  });

  it("names the keys the player bound, not the defaults", () => {
    const binds = {
      mouse: { ...DEFAULT_KEYBINDS_BY_MODE.mouse, skill1: "z", skill2: "q" },
      wasd: { ...DEFAULT_KEYBINDS_BY_MODE.wasd, moveUp: "q", skill1: "w", flaskLife: " " },
    };
    render(<ControlsDialog onPick={() => {}} keybinds={binds} />);
    expect(screen.getByTestId("controls-mouse").textContent).toContain("ZQERT");
    const wasd = screen.getByTestId("controls-wasd").textContent;
    expect(wasd).toContain("QASD");
    expect(wasd).toContain("WERTF");
    expect(wasd).toContain("Space 2");
  });

  it("keeps game keys from walking or casting while the choice is open", () => {
    const game = vi.fn();
    window.addEventListener("keydown", game);
    render(<ControlsDialog onPick={() => {}} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "q", bubbles: true }));
    expect(game).not.toHaveBeenCalled();
    cleanup();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    expect(game).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", game);
  });
});
