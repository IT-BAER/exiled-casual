import { TransformNode } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { SKILL_LOOKS } from "./index";
import type { ActorRef, BurstHandle, ClassSkillLooks, FxHandle, LookContext } from "./types";

/**
 * Every class look built once behind the loading plate and released when it settles,
 * like `warmEntityLooks`: built on the first cast instead, each compiled its shaders
 * mid-fight, and Sunder, Solar Orb and Firestorm stalled a frame for 0.5-0.8 s.
 * Every mesh is drawn whatever the camera sees, since a culled mesh compiles nothing.
 * A look that throws on these stand-in states only keeps its old first-use hitch.
 */
export function warmSkillLooks(scene: Scene, looks: ClassSkillLooks = SKILL_LOOKS): () => void {
  const first = scene.meshes.length;
  const handles: (FxHandle<never> | BurstHandle | { dispose(): void })[] = [];
  const ctx: LookContext = { scene, dt: 1 / 30, now: 0, flash: () => {}, shake: () => {}, adopt: (h) => handles.push(h) };
  const node = new TransformNode("warm-skill-actor", scene);
  const body: ActorRef = { node, x: 0, z: 0, yaw: 0 };
  const attached = { body, remaining: 1, visible: true };
  const keep = (h: { dispose(): void } | void) => { if (h) handles.push(h); };
  const tryEach = (fns: (() => void)[]) => { for (const f of fns) try { f(); } catch { /* old lazy path */ } };

  for (const [skillId, look] of Object.entries(looks.skills)) {
    const dir = { dirX: 0, dirY: 1 };
    const area = { id: -1, skillId, x: 0, y: 0, radius: 2, shape: "disc" as const, ...dir, arc: 0, index: 0, team: 0 };
    tryEach([
      () => keep(look.cast?.start?.(ctx, body, { skillId, windup: 0.3, ...dir })),
      () => keep(look.release?.(ctx, body, { skillId, ...dir })),
      () => {
        // A warning builds what falls only in its last half second, so tick it there.
        const warn = look.area?.warn?.(ctx, { ...area, impactIn: 0.5 });
        keep(warn);
        warn?.update?.(ctx, { ...area, impactIn: 0.2 });
      },
      () => keep(look.area?.impact?.(ctx, { ...area, impactIn: 0 })),
      () => keep(look.ground?.create(ctx, { id: -1, skillId, x: 0, y: 0, radius: 2, remaining: 1, age: 0, team: 0 })),
      () => keep(look.travel?.start?.(ctx, body, { skillId, progress: 0.5, seconds: 0.5, ...dir })),
      () => keep(look.travel?.land?.(ctx, body, { skillId, progress: 1, seconds: 0.5, ...dir })),
      () => keep(look.projectile?.create(ctx, {
        id: -1, skillId, node: new TransformNode("warm-skill-projectile", scene), ...dir, team: 0, spent: false, arrow: false,
      })),
    ]);
  }
  tryEach(Object.values(looks.buffs).map((b) => () => keep(b.create(ctx, { ...attached, aura: true }))));
  tryEach(Object.values(looks.statuses).map((s) => () => keep(s.create(ctx, { ...attached, radius: 0.5, boss: false }))));

  // The kit's templates and pools outlive the warm-up (that is what makes it pay), so
  // the always-drawn flag is handed back rather than left on them.
  const drawn = scene.meshes.slice(first).filter((m) => !m.alwaysSelectAsActiveMesh);
  for (const mesh of drawn) {
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.computeWorldMatrix(true);
  }
  return () => {
    for (const mesh of drawn) mesh.alwaysSelectAsActiveMesh = false;
    for (const h of handles) try { h.dispose(); } catch { /* already gone with its parent */ }
    for (const n of scene.transformNodes.filter((t) => t.name === "warm-skill-projectile")) n.dispose();
    node.dispose();
  };
}
