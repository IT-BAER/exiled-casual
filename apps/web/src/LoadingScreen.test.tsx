// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { LoadingScreen } from "./LoadingScreen";
import { TIPS, pickTip } from "./tips";

afterEach(cleanup);

describe("LoadingScreen", () => {
  it("names the place being entered and prints the tip it was given", () => {
    render(<LoadingScreen areaName="Vaal Stone" tip="Press C for the character sheet." />);
    expect(screen.getByTestId("loading-area-name")).toHaveTextContent("Vaal Stone");
    expect(screen.getByTestId("loading-tip")).toHaveTextContent("Press C for the character sheet.");
  });

  it("never dismisses itself", () => {
    // docs/09-reward-psychology.md rule 8: latency is a dopamine tax, so the plate
    // is not allowed to own a clock. It goes away when the game is ready and at no
    // other moment. This fails the day someone adds a setTimeout to make it "feel"
    // like a loading screen.
    vi.useFakeTimers();
    try {
      render(<LoadingScreen areaName="Desert" tip="anything" />);
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(screen.getByTestId("loading-screen")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the dark plate when a biome's wallpaper is missing", () => {
    // The case this protects: a biome added before its plate was rendered. A
    // broken-image glyph across the whole screen is worse than no painting.
    render(<LoadingScreen areaName="Forest" tip="t" wallpaper="/textures/loading/nope.jpg" />);
    const img = screen.getByTestId("loading-wallpaper");
    fireEvent.error(img);
    expect(screen.queryByTestId("loading-wallpaper")).not.toBeInTheDocument();
    expect(screen.getByTestId("loading-area-name")).toHaveTextContent("Forest");
  });

  it("draws no wallpaper at all when none was given", () => {
    render(<LoadingScreen areaName="Hideout" tip="t" />);
    expect(screen.queryByTestId("loading-wallpaper")).not.toBeInTheDocument();
  });
});

describe("tips", () => {
  it("returns a real line for every point in the random range", () => {
    // pickTip indexes with Math.floor(r * len); r = 1 would be off the end, and
    // Math.random() never returns 1, but a caller passing its own generator can.
    for (const r of [0, 0.5, 0.999999, 1]) {
      expect(TIPS).toContain(pickTip(() => r));
    }
  });
});
