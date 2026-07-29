// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { OptionsPanel } from "./OptionsPanel";
import { DEFAULT_SETTINGS, type Settings } from "../settings";

afterEach(cleanup);

function setup(over: Partial<Settings> = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const settings: Settings = {
    graphics: { ...DEFAULT_SETTINGS.graphics, ...(over.graphics ?? {}) },
    sound: { ...DEFAULT_SETTINGS.sound, ...(over.sound ?? {}) },
  };
  render(<OptionsPanel settings={settings} onChange={onChange} onClose={onClose} />);
  return { onChange, onClose };
}

describe("OptionsPanel", () => {
  it("opens on Graphics and offers Sound", () => {
    setup();
    expect(screen.getByRole("tab", { name: /graphics/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: /sound/i }).getAttribute("aria-selected")).toBe("false");
    // Increment 1 ships two tabs. An empty UI tab would be a lie.
    expect(screen.queryByRole("tab", { name: /^ui$/i })).toBeNull();
  });

  it("switches tabs", () => {
    setup();
    fireEvent.click(screen.getByRole("tab", { name: /sound/i }));
    expect(screen.getByRole("tab", { name: /sound/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByLabelText(/master volume/i)).toBeTruthy();
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

  it("says what resolution scale costs, since a soft frame reads as a bug", () => {
    setup();
    expect(screen.getByTestId("options-panel").textContent).toMatch(/sharpness/i);
  });
});
