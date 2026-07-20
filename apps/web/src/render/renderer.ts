import type { Scene } from "@babylonjs/core";
import type { Mesh } from "@babylonjs/core";
import type { Snapshot, SnapshotEntity } from "@pact/protocol";
import { animateActor, makeMesh, Y_LIFT } from "./meshes";
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
  /** Walk-cycle position per entity, advanced by distance walked (radians/unit). */
  private readonly gait = new Map<number, number>();
  private static readonly GAIT_PER_UNIT = 3.2;

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
        this.gait.delete(id);
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
    const fresh = !mesh;
    if (!mesh) {
      mesh = makeMesh(this.scene, kind, `entity-${id}`);
      this.meshes.set(id, mesh);
    }
    const wasX = mesh.position.x;
    const wasZ = mesh.position.z;
    mesh.position.x = lerp(prevX, nextX, alpha);
    mesh.position.z = lerp(prevY, nextY, alpha);
    mesh.position.y = Y_LIFT[kind];

    // Advance the walk cycle by how far the mesh actually moved on screen this
    // frame, not by the snapshot delta: apply() runs several times per snapshot
    // while interpolating, so a snapshot delta would count the same step twice.
    // A mesh spawning at the origin teleports on its first frame, which is not
    // a step.
    const step = fresh ? 0 : Math.hypot(mesh.position.x - wasX, mesh.position.z - wasZ);
    const phase = (this.gait.get(id) ?? 0) + step * SnapshotRenderer.GAIT_PER_UNIT;
    this.gait.set(id, phase);
    animateActor(mesh, phase, step > 1e-5);

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
