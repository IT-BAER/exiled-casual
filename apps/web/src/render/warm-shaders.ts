import type { AbstractMesh, AssetContainer, Material } from "@babylonjs/core";

/**
 * Compile a loaded container's shaders now, behind the loading plate.
 *
 * An `AssetContainer` is held OUT of the scene until something instantiates from
 * it (a monster spawns, the hideout is dressed), so `scene.executeWhenReady`
 * never touches it — the first instance of each material compiled its shader on
 * the frame it first drew, a multi-ms main-thread (and cold driver-side) stall
 * per material as a fresh area's population or furniture came into view. That is
 * the fps dip on entering a map and the ramp on returning to the hideout.
 *
 * Compiling the SHARED material against a source mesh it already wears warms the
 * exact effect every future instance reuses (same defines, same material
 * object). Mirrors `primeDissolve` in dissolve.ts, which pays the same one-off
 * compile behind the wardrobe fetch.
 *
 * Never rejects: a compile that fails (headless engine, a driver refusal) leaves
 * the old lazy path, which only ever cost a hitch, not a crash — and a throw
 * here would null the caller's `loaded` and greybox everything the container holds.
 */
export async function warmContainer(container: AssetContainer): Promise<void> {
  const rep = new Map<Material, AbstractMesh>();
  for (const mesh of container.meshes) {
    if (mesh.material && !rep.has(mesh.material)) rep.set(mesh.material, mesh);
  }
  await Promise.all(
    [...rep].map(([material, mesh]) => material.forceCompilationAsync(mesh).catch(() => {})),
  );
}
