import { Ray, Vector3 } from "@babylonjs/core";
import type { AbstractMesh, TransformNode } from "@babylonjs/core";

/**
 * Where a blow from `from` meets the body `target` draws, on its CURRENT pose.
 *
 * The ray runs from `from` through `fallback` (the body's centre at the height of
 * the blow). `precise` picks the visible meshes' triangles, skinned ones re-posed
 * on the CPU first (`refreshBoundingInfo({ applySkeleton })`), which costs a pass
 * over their vertices: callers budget it. Imprecise, or on a miss, it is where
 * the ray enters the hierarchy's world box; with nothing to hit, `fallback` itself.
 */
export function contactPoint(
  target: TransformNode | null | undefined,
  from: Vector3,
  fallback: Vector3,
  precise = true,
): Vector3 {
  if (!target || target.isDisposed()) return fallback;
  const toward = fallback.subtract(from);
  const dist = toward.length();
  if (dist < 1e-4) return fallback;
  const dir = toward.scaleInPlace(1 / dist);

  if (precise) {
    const ray = new Ray(from, dir, dist * 2);
    let best: Vector3 | null = null;
    let bestDist = Infinity;
    for (const mesh of bodyMeshes(target)) {
      if (mesh.skeleton) mesh.refreshBoundingInfo({ applySkeleton: true });
      const pick = ray.intersectsMesh(mesh);
      if (pick.hit && pick.pickedPoint && pick.distance < bestDist) {
        bestDist = pick.distance;
        best = pick.pickedPoint.clone();
      }
    }
    if (best) return best;
  }

  const { min, max } = target.getHierarchyBoundingVectors(true, (m) => m.isVisible && m.isEnabled() && !isDecor(m));
  const t = slabEntry(from, dir, min, max);
  return t === null || t > dist * 2 ? fallback : from.add(dir.scale(t));
}

/** Marks drawn around a body, not the body: a rare's aura ring, the ground blob. */
function isDecor(m: AbstractMesh): boolean {
  return m.name === "rare-aura" || m.name.startsWith("groundblob-");
}

function bodyMeshes(target: TransformNode): AbstractMesh[] {
  const visible = (m: AbstractMesh): boolean => m.isVisible && m.isEnabled() && m.getTotalVertices() > 0 && !isDecor(m);
  const all = target.getChildMeshes(false).filter(visible);
  const self = target as AbstractMesh;
  if (typeof self.getTotalVertices === "function" && visible(self)) all.push(self);
  return all;
}

/** Distance along the ray to where it enters the box, 0 from inside, null on a miss. */
function slabEntry(o: Vector3, d: Vector3, min: Vector3, max: Vector3): number | null {
  let near = 0;
  let far = Infinity;
  for (const axis of ["x", "y", "z"] as const) {
    if (Math.abs(d[axis]) < 1e-9) {
      if (o[axis] < min[axis] || o[axis] > max[axis]) return null;
      continue;
    }
    let t1 = (min[axis] - o[axis]) / d[axis];
    let t2 = (max[axis] - o[axis]) / d[axis];
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return null;
  }
  return near;
}
