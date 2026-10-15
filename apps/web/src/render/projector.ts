import { Matrix, Vector3, type Camera, type Scene } from "@babylonjs/core";
import type { Projector } from "../hud/LootLabels";

/** The slice of the engine the projection reads. */
export type RenderSize = {
  getRenderWidth(): number;
  getRenderHeight(): number;
  getHardwareScalingLevel(): number;
};

/**
 * World -> canvas projection for the DOM overlays. Sim (x, y) maps to world (x, z).
 * The drawing buffer is the CSS size divided by the hardware scaling level (the
 * resolution option), so the buffer size times that level is the canvas in CSS pixels.
 */
export function canvasProjector(scene: Scene, camera: Camera, engine: RenderSize): Projector {
  return (x, y, worldY = 0) => {
    const level = engine.getHardwareScalingLevel();
    const p = Vector3.Project(
      new Vector3(x, worldY, y),
      Matrix.Identity(),
      scene.getTransformMatrix(),
      camera.viewport.toGlobal(engine.getRenderWidth() * level, engine.getRenderHeight() * level),
    );
    return { x: p.x, y: p.y, visible: p.z > 0 && p.z < 1 };
  };
}
