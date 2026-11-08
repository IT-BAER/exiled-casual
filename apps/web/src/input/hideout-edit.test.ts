// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { NullEngine, Scene } from "@babylonjs/core";
import { fp } from "@exiled/fixed-point";
import { HIDEOUT_SERVICES, decorById, yawToRot } from "@exiled/content-runtime";
import type { Intent, Snapshot } from "@exiled/protocol";
import { attachHideoutEdit } from "./hideout-edit";

const at = (sx: number, sy: number) => ({ x: (sx - sy) * Math.SQRT1_2, z: (sx + sy) * Math.SQRT1_2 });
const V = HIDEOUT_SERVICES.vendor;
const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  tick: 10, area: "hideout", hideoutLayout: [],
  player: { x: 0, y: 0 }, entities: [{ id: 9, kind: "vendor", x: V.x, y: V.z, yaw: V.yaw }],
  ...over,
} as unknown as Snapshot);

function rig() {
  const scene = new Scene(new NullEngine());
  const canvas = document.createElement("canvas");
  const posted: Intent[] = [];
  const renderer = { overridePlacement: vi.fn() };
  const onExit = vi.fn();
  const edit = attachHideoutEdit({ canvas, scene, renderer, post: (i) => posted.push(i), serviceYawShift: 0, onExit });
  edit.onSnapshot(snap());
  edit.setActive(true);
  return { edit, posted, renderer, onExit };
}

describe("Edit Hideout controller", () => {
  it("picks a piece up, turns it a notch, and asks the sim to stand it where it was carried", () => {
    const { edit, posted } = rig();
    const crate = decorById("crate-carto")!;
    expect(edit.pickUp(crate.id)).toBe(true);
    const to = at(-2, -2.5);
    edit.carryTo(to.x, to.z);
    edit.rotate(1);
    expect(edit.state()).toMatchObject({ carrying: crate.id, valid: true });
    expect(edit.place()).toBe(true);
    expect(posted).toEqual([{
      kind: "placeHideoutPiece", pieceId: crate.id, x: fp(to.x), y: fp(to.z), rot: (yawToRot(crate.yaw) + 15) % 360,
    }]);
    expect(edit.state().carrying).toBeNull();
    edit.detach();
  });

  it("will not put a piece down on the player or the arrival spot, and keeps it in hand", () => {
    const { edit, posted } = rig();
    edit.pickUp("crate-carto");
    edit.carryTo(0, 0);
    expect(edit.state().valid).toBe(false);
    expect(edit.place()).toBe(false);
    expect(posted).toEqual([]);
    expect(edit.state().carrying).toBe("crate-carto");
    edit.cancel();
    expect(edit.state().carrying).toBeNull();
    edit.detach();
  });

  it("carries a service by drawing its entity at the cursor, and lets go on cancel", () => {
    const { edit, renderer } = rig();
    expect(edit.pickUp("vendor")).toBe(true);
    edit.carryTo(1, -3);
    expect(renderer.overridePlacement).toHaveBeenLastCalledWith(9, { x: 1, z: -3, yaw: (yawToRot(V.yaw) * Math.PI) / 180 });
    edit.cancel();
    expect(renderer.overridePlacement).toHaveBeenLastCalledWith(9, null);
    edit.detach();
  });

  it("Escape puts a carried piece back first, and only then leaves the mode", () => {
    const { edit, onExit } = rig();
    edit.pickUp("crate-carto");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(edit.state().carrying).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onExit).toHaveBeenCalledOnce();
    edit.detach();
  });

  it("switches itself off when the player leaves the hideout", () => {
    const { edit, onExit } = rig();
    edit.onSnapshot(snap({ area: "map" }));
    expect(edit.state().active).toBe(false);
    expect(onExit).toHaveBeenCalled();
    edit.detach();
  });
});
