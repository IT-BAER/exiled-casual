import {
  Color3,
  MeshBuilder,
  StandardMaterial,
  type Mesh,
  type Scene,
} from "@babylonjs/core";

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

/** Greybox palette so the fight is readable: player vs monster vs rare vs fx. */
const KIND_COLOR: Record<MeshKind, [number, number, number]> = {
  player: [0.25, 0.8, 0.45], // green — you
  monster: [0.82, 0.28, 0.22], // red — cinder imp
  rare: [1.0, 0.55, 0.12], // orange — rare imp
  projectile: [1.0, 0.9, 0.25], // yellow — ember bolt
  groundArea: [1.0, 0.42, 0.12], // ember — cinder ground
};

/** One shared material per kind per scene (reused by every mesh of that kind). */
function materialFor(scene: Scene, kind: MeshKind): StandardMaterial {
  const name = `mat-${kind}`;
  const existing = scene.getMaterialByName(name);
  if (existing) return existing as StandardMaterial;
  const [r, g, b] = KIND_COLOR[kind];
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = new Color3(r, g, b);
  mat.emissiveColor = new Color3(r * 0.35, g * 0.35, b * 0.35); // glow under any light
  mat.specularColor = new Color3(0, 0, 0); // matte greybox
  if (kind === "groundArea") mat.alpha = 0.45; // see the floor through the disc
  return mat;
}

export function makeMesh(scene: Scene, kind: MeshKind, name: string): Mesh {
  let mesh: Mesh;
  switch (kind) {
    case "player":
      mesh = MeshBuilder.CreateCapsule(name, { radius: 0.4, height: 1.8 }, scene);
      break;
    case "rare":
      mesh = MeshBuilder.CreateBox(name, { width: 0.9, height: 2.0, depth: 0.9 }, scene);
      break;
    case "monster":
      mesh = MeshBuilder.CreateBox(name, { size: 0.8 }, scene);
      break;
    case "projectile":
      mesh = MeshBuilder.CreateSphere(name, { diameter: 0.3 }, scene);
      break;
    case "groundArea":
      mesh = MeshBuilder.CreateCylinder(name, { diameter: 5, height: 0.1, tessellation: 24 }, scene);
      break;
  }
  mesh.material = materialFor(scene, kind);
  return mesh;
}
