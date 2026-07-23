import { describe, it, expect } from "vitest";
import { MemoryKv } from "./index";

// IndexedDbKv needs a browser and is exercised live; MemoryKv is the seam
// contract the run-transaction proof relies on.
describe("MemoryKv", () => {
  it("returns null before anything is saved", async () => {
    expect(await new MemoryKv().load()).toBeNull();
  });

  it("round-trips the saved blob", async () => {
    const kv = new MemoryKv();
    await kv.save("hello");
    expect(await kv.load()).toBe("hello");
  });

  it("overwrites wholesale on re-save", async () => {
    const kv = new MemoryKv();
    await kv.save("first");
    await kv.save("second");
    expect(await kv.load()).toBe("second");
  });
});
