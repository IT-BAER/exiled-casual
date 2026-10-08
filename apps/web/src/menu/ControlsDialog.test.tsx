// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ControlsDialog } from "./ControlsDialog";

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
