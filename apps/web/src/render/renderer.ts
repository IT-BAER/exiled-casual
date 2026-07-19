import type { Scene } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core";
import type { Snapshot, SnapshotEntity } from "@pact/protocol";
import { makeMesh, Y_LIFT } from "./meshes";
import type { MeshKind } from "./meshes";
import { lerp, lerpAngle } from "./interp";

function kindOf(e: SnapshotEntity): MeshKind {
  if (e.kind === "monster") return e.rare ? "rare" : "monster";
  if (e.kind === "projectile") return "projectile";
  return "groundArea";
}

export class SnapshotRenderer {
  private readonly scene: Scene;
  // keyed by entity id (player id = player.id)
  private readonly meshes = new Map<number, Mesh>();

  constructor(scene: Scene) {
    this.scene = scene;
  }

  apply(prev: Snapshot | null, next: Snapshot, alpha: number): void {
    // Collect the full set of ids that should exist after this call
    const liveIds = new Set<number>();

    // Player
    liveIds.add(next.player.id);
    this.syncMesh(
      next.player.id,
      "player",
      prev?.player.x ?? next.player.x,
      prev?.player.y ?? next.player.y,
      next.player.x,
      next.player.y,
      alpha,
    );

    // Entities
    for (const e of next.entities) {
      liveIds.add(e.id);
      const prevE = prev?.entities.find((p) => p.id === e.id);
      this.syncMesh(
        e.id,
        kindOf(e),
        prevE?.x ?? e.x,
        prevE?.y ?? e.y,
        e.x,
        e.y,
        alpha,
      );
    }

    // Dispose meshes for entities that no longer exist
    for (const [id, mesh] of this.meshes) {
      if (!liveIds.has(id)) {
        mesh.dispose();
        this.meshes.delete(id);
      }
    }
  }

  private syncMesh(
    id: number,
    kind: MeshKind,
    prevX: number,
    prevY: number,
    nextX: number,
    nextY: number,
    alpha: number,
  ): void {
    let mesh = this.meshes.get(id);
    if (!mesh) {
      mesh = makeMesh(this.scene, kind, `entity-${id}`);
      this.meshes.set(id, mesh);
    }
    mesh.position.x = lerp(prevX, nextX, alpha);
    mesh.position.z = lerp(prevY, nextY, alpha);
    mesh.position.y = Y_LIFT[kind];

    // Turn the actor to face where it's heading (sim x,y -> world x,z). The
    // meshes are authored facing +z; yaw = atan2(dx, dz) aligns +z with the
    // movement direction. Only turn while actually moving so idle actors hold
    // their last heading instead of snapping back to +z.
    const dx = nextX - prevX;
    const dz = nextY - prevY;
    if (dx * dx + dz * dz > 1e-6) {
      mesh.rotation.y = lerpAngle(mesh.rotation.y, Math.atan2(dx, dz), 0.25);
    }
  }
}
