// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MainMenu } from "./MainMenu";
import { ModeDialog } from "./ModeDialog";
import { _setLiveConfig } from "../telemetry/liveops";
import { DEFAULT_LIVE_CONFIG } from "@exiled/telemetry";

afterEach(() => {
  cleanup();
  _setLiveConfig(DEFAULT_LIVE_CONFIG);
  sessionStorage.clear();
});

describe("MainMenu", () => {
  const props = { characterCount: 0, onPlay: vi.fn(), onOptions: vi.fn(), onAbout: vi.fn() };

  it("offers play, options and credits and nothing that needs a server", () => {
    render(<MainMenu {...props} />);
    expect(screen.getByRole("button", { name: /play/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /options/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /about/i })).toBeTruthy();
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

describe("MainMenu live ops", () => {
  const props = { characterCount: 0, onPlay: vi.fn(), onOptions: vi.fn(), onAbout: vi.fn() };

  it("shows the message of the day and remembers a dismissal by id", () => {
    _setLiveConfig({ ...DEFAULT_LIVE_CONFIG, motd: { id: "m1", text: "Server restarts at noon", level: "info" } });
    const { unmount } = render(<MainMenu {...props} />);
    expect(screen.getByTestId("motd").textContent).toMatch(/restarts at noon/);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByTestId("motd")).toBeNull();
    unmount();
    render(<MainMenu {...props} />);
    expect(screen.queryByTestId("motd")).toBeNull();
    cleanup();
    _setLiveConfig({ ...DEFAULT_LIVE_CONFIG, motd: { id: "m2", text: "New text", level: "warn" } });
    render(<MainMenu {...props} />);
    expect(screen.getByTestId("motd")).toBeTruthy();
  });

  it("maintenance disables PLAY and says why", () => {
    const onPlay = vi.fn();
    _setLiveConfig({ ...DEFAULT_LIVE_CONFIG, maintenance: { text: "Back in ten minutes" } });
    render(<MainMenu {...props} onPlay={onPlay} />);
    const play = screen.getByRole("button", { name: /play/i }) as HTMLButtonElement;
    expect(play.disabled).toBe(true);
    expect(play.title).toMatch(/ten minutes/);
    expect(screen.getByTestId("maintenance").textContent).toMatch(/Back in ten minutes/);
    fireEvent.click(play);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("tells an out-of-date build to reload", () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    _setLiveConfig({ ...DEFAULT_LIVE_CONFIG, minBuiltAt: Date.now() + 1e9 });
    render(<MainMenu {...props} />);
    expect(screen.getByTestId("new-version").textContent).toMatch(/new version is available/i);
    fireEvent.click(screen.getByRole("button", { name: /reload/i }));
    expect(reload).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("shows none of it by default, and links the privacy page in a new tab", () => {
    render(<MainMenu {...props} />);
    expect(screen.queryByTestId("motd")).toBeNull();
    expect(screen.queryByTestId("maintenance")).toBeNull();
    expect(screen.queryByTestId("new-version")).toBeNull();
    const link = screen.getByRole("link", { name: /privacy/i }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/privacy.html");
    expect(link.target).toBe("_blank");
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
