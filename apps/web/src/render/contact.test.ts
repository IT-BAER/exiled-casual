// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { MeshBuilder, NullEngine, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { contactPoint } from "./contact";

let engine: NullEngine | undefined;
afterEach(() => {
  engine?.dispose();
  engine = undefined;
});

function newScene(): Scene {
  engine = new NullEngine();
  return new Scene(engine);
}

describe("contactPoint", () => {
  it("lands on the face of the body the ray enters, not its centre", () => {
    const scene = newScene();
    const box = MeshBuilder.CreateBox("body", { size: 1 }, scene);
    box.position.set(4, 1, 0);
    box.computeWorldMatrix(true);
    const centre = new Vector3(4, 1, 0);
    const hit = contactPoint(box, new Vector3(0, 1, 0), centre);
    expect(hit.x).toBeCloseTo(3.5, 3);
    expect(Vector3.Distance(hit, centre)).toBeCloseTo(0.5, 3);
  });

  it("follows the surface, not the bounding box, off the centre line", () => {
    const scene = newScene();
    const ball = MeshBuilder.CreateSphere("body", { diameter: 1, segments: 32 }, scene);
    ball.position.set(4, 1, 0);
    ball.computeWorldMatrix(true);
    // At 0.4 above the centre the sphere's skin is at x = 4 - 0.3; its box starts at 3.5.
    const hit = contactPoint(ball, new Vector3(0, 1.4, 0), new Vector3(4, 1.4, 0));
    expect(hit.x).toBeGreaterThan(3.65);
    expect(hit.x).toBeLessThan(3.75);
  });

  it("ignores a rare's aura ring wider than the body", () => {
    const scene = newScene();
    const root = new TransformNode("root", scene);
    root.position.set(4, 0, 0);
    const body = MeshBuilder.CreateBox("body", { size: 1 }, scene);
    body.parent = root;
    body.position.y = 1;
    const aura = MeshBuilder.CreateTorus("rare-aura", { diameter: 3, thickness: 0.1 }, scene);
    aura.parent = root;
    aura.position.y = 1;
    for (const m of [body, aura]) m.computeWorldMatrix(true);
    const centre = new Vector3(4, 1, 0);
    expect(contactPoint(root, new Vector3(0, 1, 0), centre, false).x).toBeCloseTo(3.5, 3);
    expect(contactPoint(root, new Vector3(0, 1, 0), centre, true).x).toBeCloseTo(3.5, 3);
  });

  it("picks a visible child of an empty root", () => {
    const scene = newScene();
    const root = new TransformNode("root", scene);
    root.position.set(0, 0, 4);
    const part = MeshBuilder.CreateBox("part", { size: 2 }, scene);
    part.parent = root;
    part.position.y = 1;
    part.computeWorldMatrix(true);
    const hit = contactPoint(root, new Vector3(0, 1, 0), new Vector3(0, 1, 4));
    expect(hit.z).toBeCloseTo(3, 3);
  });

  it("falls back to the box entry when no triangle is hit, and to the given point with nothing to hit", () => {
    const scene = newScene();
    const box = MeshBuilder.CreateBox("body", { size: 1 }, scene);
    box.position.set(4, 1, 0);
    box.computeWorldMatrix(true);
    const centre = new Vector3(4, 1, 0);
    // Imprecise: the box entry, no triangle test.
    expect(contactPoint(box, new Vector3(0, 1, 0), centre, false).x).toBeCloseTo(3.5, 3);
    const fallback = new Vector3(9, 1, 9);
    expect(contactPoint(null, new Vector3(0, 1, 0), fallback)).toEqual(fallback);
    box.dispose();
    expect(contactPoint(box, new Vector3(0, 1, 0), fallback)).toEqual(fallback);
  });
});
