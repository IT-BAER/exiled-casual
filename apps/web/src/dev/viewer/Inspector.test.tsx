// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NO_LOOKS } from "../../render/rig";
import { Inspector, type InspectorProps } from "./Inspector";

afterEach(cleanup);

function props(over: Partial<InspectorProps>): InspectorProps {
  return {
    hidden: false, kind: "character", vocab: {}, looks: NO_LOOKS, onLooks: vi.fn(), onPreset: vi.fn(),
    gait: "idle", dir: "f", onMotion: vi.fn(), onShot: vi.fn(), repeat: false, onRepeat: vi.fn(),
    onCreature: vi.fn(), creatureAction: "idle", creatureActions: ["idle", "walk", "attack", "death"], dead: false, onReset: vi.fn(),
    rawClips: [], raw: null, onRaw: vi.fn(), onFx: vi.fn(),
    light: "workshop", camera: "front", toggles: { grid: false, wireframe: false, skeleton: false, turntable: false },
    onLight: vi.fn(), onCamera: vi.fn(), onToggles: vi.fn(), stats: null, onCapture: vi.fn(), onClose: vi.fn(),
    ...over,
  } as InspectorProps;
}

describe("Inspector actions loop", () => {
  it.each(["character", "creature"] as const)("offers a labelled loop beside the %s's actions", (kind) => {
    const onRepeat = vi.fn();
    const { rerender } = render(<Inspector {...props({ kind, onRepeat })} />);
    const loop = screen.getByRole("button", { name: /loop/i });
    expect(loop).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(loop);
    expect(onRepeat).toHaveBeenCalledWith(true);
    rerender(<Inspector {...props({ kind, onRepeat, repeat: true })} />);
    expect(screen.getByRole("button", { name: /loop/i })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Inspector NPC", () => {
  it("plays an NPC's clips like the character's but never dresses her", () => {
    const onShot = vi.fn();
    const onRaw = vi.fn();
    render(<Inspector {...props({ kind: "npc", onShot, onRaw, rawClips: ["Rig|Idle_Talking_Loop"] })} />);
    expect(screen.queryByRole("heading", { name: "Looks" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Class" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Cast/ }));
    expect(onShot).toHaveBeenCalledWith("cast");
    fireEvent.click(screen.getByRole("button", { name: "Idle Talking Loop" }));
    expect(onRaw).toHaveBeenCalledWith("Rig|Idle_Talking_Loop");
  });
});

describe("Inspector creature tells", () => {
  it("offers only the tells this creature has, and plays the one pressed", () => {
    const onCreature = vi.fn();
    const { rerender } = render(<Inspector {...props({ kind: "creature", onCreature })} />);
    expect(screen.queryByRole("button", { name: "Charge" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Slam" })).toBeNull();
    rerender(<Inspector {...props({ kind: "creature", onCreature, creatureActions: ["idle", "walk", "attack", "death", "charge"] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Charge" }));
    expect(onCreature).toHaveBeenCalledWith("charge");
    expect(screen.queryByRole("button", { name: "Slam" })).toBeNull();
  });

  it("names a boss's own attacks and its last phase, and plays the one pressed", () => {
    const onCreature = vi.fn();
    render(<Inspector {...props({ kind: "creature", onCreature, creatureActions: ["idle", "attack", "ability:magma_rift", "phase3"] })} />);
    fireEvent.click(screen.getByRole("button", { name: "Magma Rift" }));
    expect(onCreature).toHaveBeenCalledWith("ability:magma_rift");
    fireEvent.click(screen.getByRole("button", { name: "Phase 3" }));
    expect(onCreature).toHaveBeenCalledWith("phase3");
  });
});
