// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { playSoundPreview } from "../audio/bus";
import { OptionsPanel } from "./OptionsPanel";
import { DEFAULT_SETTINGS, type Settings } from "../settings";

vi.mock("../audio/bus", async (importOriginal) => ({
  ...await importOriginal<typeof import("../audio/bus")>(),
  playSoundPreview: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.mocked(playSoundPreview).mockClear();
});

// The route test below renders App, which imports GameView, which imports
// Babylon. Loading the renderer to click a menu button cost five seconds and
// timed out under a full suite run; the route does not need it to exist.
vi.mock("../GameView", () => ({ GameView: () => null }));

function setup(over: Partial<Settings> = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const settings: Settings = {
    graphics: { ...DEFAULT_SETTINGS.graphics, ...(over.graphics ?? {}) },
    sound: { ...DEFAULT_SETTINGS.sound, ...(over.sound ?? {}) },
    ui: { ...DEFAULT_SETTINGS.ui, ...(over.ui ?? {}) },
  };
  render(<OptionsPanel settings={settings} onChange={onChange} onClose={onClose} />);
  return { onChange, onClose };
}

/** The panel as the game mounts it: docked on the bar, content clear of the globes. */
function renderDocked() {
  render(
    <OptionsPanel
      settings={DEFAULT_SETTINGS}
      onChange={vi.fn()}
      onClose={() => {}}
      dock={{ bottom: "7vw", clear: "2vw" }}
    />,
  );
}

describe("OptionsPanel", () => {
  it("opens on Graphics and offers Sound and UI", () => {
    setup();
    expect(screen.getByRole("tab", { name: /graphics/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /sound/i }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: /^ui$/i }).getAttribute("aria-selected")).toBe("false");
  });

  it("the UI tab toggles the two HUD pieces and reports the whole settings object", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("tab", { name: /^ui$/i }));
    expect(screen.getByRole("checkbox", { name: /minimap/i }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("checkbox", { name: /loot labels/i }));
    const next = onChange.mock.calls[0]![0] as Settings;
    expect(next.ui.minimap).toBe(true);
    expect(next.ui.lootLabels).toBe(false);
    expect(next.graphics).toEqual(DEFAULT_SETTINGS.graphics);
  });

  it("switches tabs", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: /sound/i }));
    expect(screen.getByRole("tab", { name: /sound/i }).getAttribute("aria-selected")).toBe("true");
    for (const label of ["Master", "Music", "Interface", "Skills", "Loot", "Environment"]) {
      expect(screen.getByLabelText(`${label} Volume`)).toBeTruthy();
    }
  });

  it("has no SAVE button, because it applies live", () => {
    setup();
    expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /^close$/i })).toBeTruthy();
  });

  it("closes from CLOSE, from the X and from Escape", () => {
    const a = setup();
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(a.onClose).toHaveBeenCalledTimes(1);
    cleanup();

    const b = setup();
    fireEvent.click(screen.getByRole("button", { name: /close options/i }));
    expect(b.onClose).toHaveBeenCalledTimes(1);
    cleanup();

    const c = setup();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(c.onClose).toHaveBeenCalledTimes(1);
  });

  it("a checkbox reports the whole next settings object, not a patch", () => {
    const { onChange } = setup({ graphics: { ...DEFAULT_SETTINGS.graphics, bloom: true } });
    fireEvent.click(screen.getByRole("checkbox", { name: /bloom/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as Settings;
    expect(next.graphics.bloom).toBe(false);
    expect(next.graphics.shadows).toBe(DEFAULT_SETTINGS.graphics.shadows);
    expect(next.sound).toEqual(DEFAULT_SETTINGS.sound);
  });

  it("a checkbox shows the state it was given", () => {
    setup({ graphics: { ...DEFAULT_SETTINGS.graphics, ambientOcclusion: false } });
    const box = screen.getByRole("checkbox", { name: /ambient occlusion/i });
    expect(box.getAttribute("aria-checked")).toBe("false");
  });

  it("the shadow row offers exactly off, low and high, and marks the current one", () => {
    setup({ graphics: { ...DEFAULT_SETTINGS.graphics, shadows: "low" } });
    const group = screen.getByRole("radiogroup", { name: /shadows/i });
    const names = Array.from(group.querySelectorAll('[role="radio"]')).map((n) => n.textContent);
    expect(names).toEqual(["Off", "Low", "High"]);
    expect(screen.getByRole("radio", { name: /^low$/i }).getAttribute("aria-checked")).toBe("true");
  });

  it("the slider reports its new value", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("tab", { name: /sound/i }));
    const slider = screen.getByLabelText(/master volume/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: "0.25" } });
    const next = onChange.mock.calls[0]![0] as Settings;
    expect(next.sound.master).toBeCloseTo(0.25);
  });

  it("a category slider changes only its own mix", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("tab", { name: /sound/i }));
    fireEvent.change(screen.getByLabelText("Skills Volume"), { target: { value: "0.35" } });
    const next = onChange.mock.calls[0]![0] as Settings;
    expect(next.sound).toEqual({ ...DEFAULT_SETTINGS.sound, skills: 0.35 });
  });

  it("previews the category after the player finishes moving its slider", () => {
    vi.useFakeTimers();
    setup();
    fireEvent.click(screen.getByRole("tab", { name: /sound/i }));
    const slider = screen.getByLabelText("Skills Volume");
    fireEvent.change(slider, { target: { value: "0.35" } });
    fireEvent.change(slider, { target: { value: "0.4" } });
    expect(playSoundPreview).not.toHaveBeenCalled();
    vi.advanceTimersByTime(80);
    expect(playSoundPreview).toHaveBeenCalledOnce();
    expect(playSoundPreview).toHaveBeenCalledWith("skills");
  });

  it("stands full height against the left edge, the way the plate does", () => {
    setup();
    const panel = screen.getByTestId("options-panel").firstElementChild as HTMLElement;
    expect(panel.style.height).toContain("100vh");
    expect(screen.getByTestId("options-panel").style.justifyContent).toBe("flex-start");
  });

  it("off the game it is a dialog: dimmed backdrop, over everything", () => {
    setup();
    const back = screen.getByTestId("options-panel");
    expect(back.style.background).toMatch(/rgba\(0, ?0, ?0/);
    expect(back.style.zIndex).toBe("40");
  });

  it("in the game it is furniture: no dim, and under the globes at 3", () => {
    renderDocked();
    const back = screen.getByTestId("options-panel");
    expect(back.style.background).toBe("");
    expect(Number(back.style.zIndex)).toBeLessThan(3);
  });

  it("in the game it stops on the bottom bar, as the character sheet does", () => {
    renderDocked();
    const panel = screen.getByTestId("options-panel").firstElementChild as HTMLElement;
    expect(panel.style.height).toBe("calc(100vh - 7vw)");
    expect(panel.style.marginBottom).toBe("7vw");
  });

  // The globe rises over the pane's foot on purpose, but it may cover only the
  // bare corner: CLOSE is the one control down there and it has to stay whole.
  it("lifts CLOSE clear of the globe that paints over the pane", () => {
    renderDocked();
    const close = screen.getByRole("button", { name: /^close$/i });
    const footer = close.parentElement as HTMLElement;
    expect(footer.style.marginBottom).toBe("2vw");
  });

  it("dims its gilt with an overlay that cannot swallow a click", () => {
    const { onClose } = setup();
    const gilt = screen.getByTestId("frame-gilt");
    // The whole reason the frame is a second box: the dimming filter would take
    // every row inside the window with it if it sat on the panel itself.
    expect(gilt.style.filter).toMatch(/brightness\(0\.\d+\)/);
    // And a box laid over the frame is a box laid over the controls under it.
    expect(gilt.style.pointerEvents).toBe("none");
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("says what resolution scale costs, since a soft frame reads as a bug", () => {
    setup();
    expect(screen.getByTestId("options-panel").textContent).toMatch(/sharpness/i);
  });
});

describe("the Options route", () => {
  it("the main menu opens the panel, not the old prose screen", async () => {
    // Imported here rather than at the top: App pulls in GameView's module
    // graph, and that would drag Babylon into every test in this file.
    const { App } = await import("../App");
    const { setKv } = await import("../save/roster");
    const { MemoryKv } = await import("@exiled/persistence");
    setKv(new MemoryKv());
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /options/i }));
    expect(screen.getByTestId("options-panel")).toBeTruthy();
    expect(screen.queryByText(/there is nothing to set yet/i)).toBeNull();
    setKv(null);
    // 20s, not the default 5: this is the only test that boots the whole client
    // module graph, and it passes in 3.6s alone but not against a loaded machine.
  }, 20000);
});

describe("graphics defaults", () => {
  it("puts every graphics setting back, and touches nothing else", () => {
    const { onChange } = setup({
      graphics: { ...DEFAULT_SETTINGS.graphics, shadows: "off", torchWarmth: 0.1 },
      sound: { ...DEFAULT_SETTINGS.sound, master: 0.2 },
    });
    fireEvent.click(screen.getByText("Reset to Default"));
    const next = onChange.mock.calls[0]![0] as Settings;
    expect(next.graphics).toEqual(DEFAULT_SETTINGS.graphics);
    expect(next.sound.master).toBe(0.2);
  });

  it("offers the torch warmth as a slider", () => {
    setup();
    expect(screen.getByLabelText("Torch Warmth")).toBeTruthy();
  });
});

describe("keybinds tab", () => {
  const openTab = () => fireEvent.click(screen.getByRole("tab", { name: /keybinds/i }));

  it("shows every action with its bound key", () => {
    setup();
    openTab();
    expect(screen.getByRole("button", { name: /move up key/i }).textContent).toBe("W");
    expect(screen.getByRole("button", { name: /overlay map key/i }).textContent).toBe("Tab");
  });

  it("rebinds on the next press and reports the whole settings object", () => {
    const { onChange } = setup();
    openTab();
    fireEvent.click(screen.getByRole("button", { name: /pick up item key/i }));
    fireEvent.keyDown(window, { key: "f" });
    const next = onChange.mock.calls[0]![0] as Settings;
    expect(next.ui.keybinds.pickup).toBe("f");
    expect(next.ui.keybinds.moveUp).toBe("w");
  });

  it("a stolen key swaps: the other action takes the old one", () => {
    const { onChange } = setup();
    openTab();
    fireEvent.click(screen.getByRole("button", { name: /life flask key/i }));
    fireEvent.keyDown(window, { key: "g" });
    const next = onChange.mock.calls[0]![0] as Settings;
    expect(next.ui.keybinds.flaskLife).toBe("g");
    expect(next.ui.keybinds.pickup).toBe("q");
  });

  it("Escape cancels the listen without closing the panel or binding", () => {
    const { onChange, onClose } = setup();
    openTab();
    fireEvent.click(screen.getByRole("button", { name: /portal to hideout key/i }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("refuses a skill-row digit", () => {
    const { onChange } = setup();
    openTab();
    fireEvent.click(screen.getByRole("button", { name: /portal to hideout key/i }));
    fireEvent.keyDown(window, { key: "3" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("resets the keybinds alone", () => {
    const { onChange } = setup({
      ui: { ...DEFAULT_SETTINGS.ui, keybinds: { ...DEFAULT_SETTINGS.ui.keybinds, pickup: "f" } },
    });
    openTab();
    fireEvent.click(screen.getByText("Reset to Default"));
    const next = onChange.mock.calls[0]![0] as Settings;
    expect(next.ui.keybinds).toEqual(DEFAULT_SETTINGS.ui.keybinds);
    expect(next.graphics).toEqual(DEFAULT_SETTINGS.graphics);
  });
});
