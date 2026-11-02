import { Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { chunkPool, type ChunkKind } from "./chunks";
import { fire, kitPools } from "./core";
import { fissure, scorch, shockRing } from "./ground";

const CHUNK_KINDS: readonly ChunkKind[] = ["rock", "ice", "molten"];

/**
 * The kit's pools and floor shaders stood up under the loading plate. Built on the
 * first hit instead, they compile while that hit plays and it is never drawn: the
 * first Leap Slam of a session landed with no burst at all.
 */
export function warmKit(scene: Scene): void {
  kitPools(scene);
  for (const kind of CHUNK_KINDS) chunkPool(scene, kind);
  const at = Vector3.Zero();
  fire(scene, shockRing(scene, at, { radius: 0.01, duration: 0.05, dust: 0, flash: 0 }));
  fire(scene, scorch(scene, at, { radius: 0.01, hold: 0.05, fade: 0.05, glow: [1, 0.5, 0.1] }));
  fire(scene, fissure(scene, at, { radius: 0.01, grow: 0.01, hold: 0.05, fade: 0.05, embers: 0 }));
}
