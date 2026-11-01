import { Color3, MeshBuilder, StandardMaterial, Vector3, type Mesh, type Scene } from "@babylonjs/core";
import { dustPuff, emberBurst, FALLBACK_FX, groundSlam, meleeImpact, type FxProfile } from "../skill-fx";
import type { AreaLook, BuffLook, FxHandle, AttachedState, StatusLook, AreaState, LookContext } from "./types";

/**
 * Stand-in looks the per-class modules start from: built from the shipped skill
 * FX and plain floor geometry, so a new skill shows something readable (never a
 * white slab) until its own look replaces it. Every piece is real geometry.
 */

let serial = 0;

/** An unlit, additive ring lying on the floor (or at `y`), its own material. */
function ring(scene: Scene, name: string, colour: Color3, radius: number, thickness: number, y: number): Mesh {
  const mesh = MeshBuilder.CreateTorus(`${name}-${serial++}`, { diameter: radius * 2, thickness, tessellation: 40 }, scene);
  const mat = new StandardMaterial(`${mesh.name}-mat`, scene);
  mat.emissiveColor = colour;
  mat.diffuseColor = Color3.Black();
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.alphaMode = 1; // ALPHA_ADD
  mat.alpha = 0.8;
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.position.y = y;
  mesh.onDisposeObservable.addOnce(() => mat.dispose());
  return mesh;
}

/** A ring that grows to the area's edge as the impact nears, then the profile's burst. */
export function placeholderArea(colour: Color3, impact: "fire" | "slam" | "dust" | "spark", fx: FxProfile = FALLBACK_FX): AreaLook {
  return {
    warn(ctx: LookContext, a: AreaState): FxHandle<AreaState> {
      const mesh = ring(ctx.scene, "skill-warn", colour, 1, 0.05, 0.06);
      const total = Math.max(a.impactIn, 0.05);
      const place = (s: AreaState) => {
        mesh.position.set(s.x, 0.06, s.y);
        const k = s.radius * (1 - 0.6 * Math.min(1, s.impactIn / total));
        mesh.scaling.set(k, 1, k);
      };
      place(a);
      return { update: (_c, s) => place(s), dispose: () => mesh.dispose() };
    },
    impact(ctx: LookContext, a: AreaState): void {
      const at = new Vector3(a.x, 0.4, a.y);
      if (impact === "fire") emberBurst(ctx.scene, at, { ...fx, blast: Math.max(fx.blast ?? 1, a.radius * 0.8) });
      else if (impact === "slam") groundSlam(ctx.scene, new Vector3(a.x, 0, a.y), a.dirX, a.dirY);
      else if (impact === "spark") meleeImpact(ctx.scene, at, a.dirX, a.dirY, fx.flash);
      else {
        ctx.flash(at, fx.flash);
        for (let i = 0; i < 6; i++) {
          const t = (i / 6) * Math.PI * 2;
          dustPuff(ctx.scene, a.x + Math.cos(t) * a.radius * 0.6, a.y + Math.sin(t) * a.radius * 0.6, 0.6 + a.radius * 0.2);
        }
      }
    },
  };
}

/** A slow-turning ring at the body's feet (a buff) or over its head (a status). */
function attachedRing(colour: Color3, at: "feet" | "head") {
  return (ctx: LookContext, s: AttachedState & { radius?: number }): FxHandle<AttachedState> => {
    const r = Math.max(0.35, (s.radius ?? 0.45) * 1.1);
    const mesh = ring(ctx.scene, at === "feet" ? "skill-buff" : "skill-status", colour, at === "feet" ? r : r * 0.5, 0.04, at === "feet" ? 0.05 : 2.1);
    mesh.parent = s.body.node;
    let fade = 1;
    return {
      update(c, state) {
        mesh.setEnabled(state.visible);
        mesh.rotation.y += c.dt * 1.2;
      },
      fade(c, seconds) {
        fade = Math.max(0, 1 - seconds / 0.3);
        (mesh.material as StandardMaterial).alpha = 0.8 * fade;
        return fade > 0;
      },
      dispose: () => mesh.dispose(),
    };
  };
}

export const placeholderBuff = (colour: Color3): BuffLook => ({ create: attachedRing(colour, "feet") });
export const placeholderStatus = (colour: Color3): StatusLook => ({ create: attachedRing(colour, "head") });
