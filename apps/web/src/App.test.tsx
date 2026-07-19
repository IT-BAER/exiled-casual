// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";

// The App effect instantiates a real Babylon Engine (WebGL) + Worker, neither of
// which exists in jsdom. Mock the WebGL/worker-touching pieces so App can mount;
// the real Babylon + Worker integration is verified manually in Task 23.
vi.mock("@babylonjs/core", () => ({
  Engine: vi.fn(() => ({ runRenderLoop: vi.fn(), resize: vi.fn(), dispose: vi.fn() })),
}));
vi.mock("./render/engine", () => ({
  createScene: () => ({ scene: { render: vi.fn() } }),
}));
vi.mock("./render/renderer", () => ({
  SnapshotRenderer: vi.fn(() => ({ apply: vi.fn() })),
}));
vi.mock("./input/bindings", () => ({
  attachBindings: () => () => {},
}));

import { App } from "./App";

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
