import { describe, it, expect } from "vitest";
import { urlVolumeScale } from "./bus";

describe("urlVolumeScale", () => {
  it("reads ?volume= as a percentage, defaults a bot run to 10%, leaves play alone", () => {
    expect(urlVolumeScale("?play&volume=25")).toBe(0.25);
    expect(urlVolumeScale("?play&bot")).toBe(0.1);
    expect(urlVolumeScale("?play&bot&volume=50")).toBe(0.5);
    expect(urlVolumeScale("?play")).toBe(1);
    expect(urlVolumeScale("?volume=900")).toBe(1);
    expect(urlVolumeScale("?volume=abc")).toBe(1);
  });
});
