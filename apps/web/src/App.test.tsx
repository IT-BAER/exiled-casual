// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import { App } from "./App";

// Worker is not available in jsdom — stub it so App can mount without crashing.
beforeAll(() => {
  vi.stubGlobal(
    "Worker",
    vi.fn(() => ({
      postMessage: vi.fn(),
      onmessage: null,
      terminate: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

describe("App", () => {
  it("renders a canvas element", () => {
    const { container } = render(<App />);
    expect(container.querySelector("canvas")).not.toBeNull();
  });
});
