// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { Presence, ScreenFade } from "./presence";

afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

/** jsdom has no Web Animations: a stand-in that finishes when told to. */
function fakeAnimate() {
  const runs: { keyframes: Keyframe[]; finish: () => void }[] = [];
  (HTMLElement.prototype as { animate?: unknown }).animate = vi.fn(function (keyframes: Keyframe[]) {
    let done: () => void = () => {};
    const finished = new Promise<void>((r) => { done = r; });
    const run = { keyframes, finish: () => done() };
    runs.push(run);
    return { finished, cancel: () => {} };
  });
  return runs;
}

describe("Presence", () => {
  it("animates a panel in when it opens", () => {
    const runs = fakeAnimate();
    render(<Presence open><div data-testid="panel">hi</div></Presence>);
    expect(screen.getByTestId("panel")).toBeTruthy();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.keyframes[0]!.opacity).toBe(0);
  });

  it("keeps a closing panel on screen until its exit finishes, inert", async () => {
    const runs = fakeAnimate();
    const { rerender } = render(<Presence open><div data-testid="panel">hi</div></Presence>);
    rerender(<Presence open={false}><div data-testid="panel">hi</div></Presence>);
    const panel = screen.getByTestId("panel");
    expect(panel.closest("[inert]")).not.toBeNull();
    expect(runs).toHaveLength(2);
    expect(runs[1]!.keyframes[1]!.opacity).toBe(0);
    await act(async () => { runs[1]!.finish(); });
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("keeps the last children while closing, even if the caller renders none", () => {
    fakeAnimate();
    const { rerender } = render(<Presence open><div data-testid="panel">hi</div></Presence>);
    rerender(<Presence open={false}>{null}</Presence>);
    expect(screen.getByTestId("panel")).toBeTruthy();
  });

  it("reopening during the exit keeps the panel and drops the pending unmount", async () => {
    const runs = fakeAnimate();
    const { rerender } = render(<Presence open><div data-testid="panel">a</div></Presence>);
    rerender(<Presence open={false}><div data-testid="panel">a</div></Presence>);
    rerender(<Presence open><div data-testid="panel">b</div></Presence>);
    await act(async () => { runs[1]!.finish(); });
    expect(screen.getByTestId("panel").textContent).toBe("b");
    expect(screen.getByTestId("panel").closest("[inert]")).toBeNull();
  });

  it("unmounts at once where there is no animation support", () => {
    const { rerender } = render(<Presence open><div data-testid="panel">hi</div></Presence>);
    rerender(<Presence open={false}><div data-testid="panel">hi</div></Presence>);
    expect(screen.queryByTestId("panel")).toBeNull();
  });

  it("renders nothing while closed", () => {
    render(<Presence open={false}><div data-testid="panel">hi</div></Presence>);
    expect(screen.queryByTestId("panel")).toBeNull();
  });
});

describe("ScreenFade", () => {
  it("lifts a black veil off each new screen", () => {
    const runs = fakeAnimate();
    const { rerender } = render(<ScreenFade screen="menu" />);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.keyframes[0]!.opacity).toBe(1);
    expect(runs[0]!.keyframes[1]!.opacity).toBe(0);
    rerender(<ScreenFade screen="select" />);
    expect(runs).toHaveLength(2);
    rerender(<ScreenFade screen="select" />);
    expect(runs).toHaveLength(2);
  });
});
