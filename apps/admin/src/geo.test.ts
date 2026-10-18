import { describe, expect, it } from "vitest";
import { geometryPath, graticule, nodeRadius, project } from "./geo";

describe("equirectangular projection", () => {
  it("maps the corners and the centre of the world", () => {
    expect(project(-180, 90, 360, 180)).toEqual([0, 0]);
    expect(project(180, -90, 360, 180)).toEqual([360, 180]);
    expect(project(0, 0, 800, 400)).toEqual([400, 200]);
  });

  it("is linear in both axes", () => {
    const [x, y] = project(13.4, 52.5, 1000, 500);
    expect(x).toBeCloseTo(((13.4 + 180) / 360) * 1000, 9);
    expect(y).toBeCloseTo(((90 - 52.5) / 180) * 500, 9);
  });

  it("draws a polygon ring as a closed path", () => {
    const d = geometryPath({ type: "Polygon", coordinates: [[[-180, 90], [0, 90], [0, 0], [-180, 90]]] }, 360, 180);
    expect(d).toBe("M0 0L180 0L180 90L0 0Z");
  });

  it("breaks a ring where it wraps across the antimeridian", () => {
    const d = geometryPath({ type: "Polygon", coordinates: [[[170, 0], [-170, 0], [-170, 10]]] }, 360, 180);
    expect(d).toBe("M350 90M10 90L10 80Z");
  });

  it("draws every polygon of a multipolygon", () => {
    const d = geometryPath(
      { type: "MultiPolygon", coordinates: [[[[0, 0], [10, 0], [0, 0]]], [[[20, 0], [30, 0], [20, 0]]]] },
      360,
      180,
    );
    expect(d.match(/M/g)).toHaveLength(2);
  });

  it("draws meridians and parallels at the step", () => {
    const lines = graticule(30, 360, 180);
    expect(lines.filter((l) => l.kind === "meridian")).toHaveLength(13);
    expect(lines.filter((l) => l.kind === "parallel")).toHaveLength(5);
    expect(lines.find((l) => l.kind === "parallel" && l.deg === 0)?.d).toBe("M0 90H360");
  });

  it("sizes nodes by the square root of sessions", () => {
    expect(nodeRadius(0, 100)).toBe(3);
    expect(nodeRadius(100, 100)).toBe(12);
    expect(nodeRadius(25, 100)).toBeCloseTo(7.5, 9);
    expect(nodeRadius(5, 0)).toBe(3);
  });
});
