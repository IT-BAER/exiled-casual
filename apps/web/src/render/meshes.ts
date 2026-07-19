import { MeshBuilder, type Mesh, type Scene } from "@babylonjs/core";

export type MeshKind = "player" | "monster" | "rare" | "projectile" | "groundArea";

/** Y-lift off the ground plane per kind (render only). */
const Y_LIFT: Record<MeshKind, number> = {
  player: 0.5,
  monster: 0.5,
  rare: 1.0,
  projectile: 0.3,
  groundArea: 0.05,
};

export { Y_LIFT };

export function makeMesh(scene: Scene, kind: MeshKind, name: string): Mesh {
  switch (kind) {
    case "player":
      return MeshBuilder.CreateCapsule(name, { radius: 0.4, height: 1.8 }, scene);
    case "rare":
      return MeshBuilder.CreateBox(name, { width: 0.9, height: 2.0, depth: 0.9 }, scene);
    case "monster":
      return MeshBuilder.CreateBox(name, { size: 0.8 }, scene);
    case "projectile":
      return MeshBuilder.CreateSphere(name, { diameter: 0.3 }, scene);
    case "groundArea":
      return MeshBuilder.CreateCylinder(name, { diameter: 5, height: 0.1, tessellation: 24 }, scene);
  }
}
