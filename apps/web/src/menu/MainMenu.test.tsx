// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MainMenu } from "./MainMenu";
import { ModeDialog } from "./ModeDialog";

afterEach(cleanup);

describe("MainMenu", () => {
  const props = { characterCount: 0, onPlay: vi.fn(), onOptions: vi.fn(), onCredits: vi.fn() };

  it("offers play, options and credits and nothing that needs a server", () => {
    render(<MainMenu {...props} />);
    expect(screen.getByRole("button", { name: /play/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /options/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /credits/i })).toBeTruthy();
    // The reference's gateway row and LOG IN column are deliberately absent.
    expect(screen.queryByText(/log in/i)).toBeNull();
    expect(screen.queryByText(/gateway/i)).toBeNull();
  });

  it("play reports up rather than starting a game itself", () => {
    const onPlay = vi.fn();
    render(<MainMenu {...props} onPlay={onPlay} />);
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("the boot log counts what the save actually holds", () => {
    const { rerender } = render(<MainMenu {...props} characterCount={0} />);
    expect(screen.getByTestId("boot-log").textContent).toMatch(/no characters yet/i);
    rerender(<MainMenu {...props} characterCount={1} />);
    expect(screen.getByTestId("boot-log").textContent).toMatch(/1 character found/i);
    rerender(<MainMenu {...props} characterCount={3} />);
    expect(screen.getByTestId("boot-log").textContent).toMatch(/3 characters found/i);
  });

  it("draws the atmosphere behind it", () => {
    render(<MainMenu {...props} />);
    expect(screen.getByTestId("menu-atmosphere")).toBeTruthy();
  });
});

describe("ModeDialog", () => {
  it("lets local through and refuses online out loud", () => {
    const onPick = vi.fn();
    render(<ModeDialog onPick={onPick} onCancel={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /play local/i }));
    expect(onPick).toHaveBeenCalledWith("local");

    const online = screen.getByRole("button", { name: /coming soon/i }) as HTMLButtonElement;
    expect(online.disabled).toBe(true);
    fireEvent.click(online);
    expect(onPick).toHaveBeenCalledTimes(1);
    // A disabled control owes the player its reason.
    expect(online.title).toMatch(/not implemented/i);
  });

  it("says the two pools never mix, because that cannot be undone later", () => {
    render(<ModeDialog onPick={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByTestId("mode-dialog").textContent).toMatch(/can never move across/i);
  });

  it("escape backs out", () => {
    const onCancel = vi.fn();
    render(<ModeDialog onPick={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});
