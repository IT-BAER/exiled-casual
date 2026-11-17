/**
 * The game's hideout programs, linked while the roster and create screens are up.
 *
 * A cold first visit compiled ~100 programs under the loading plate, the GPU
 * process taking them one after another (link-pacing.ts). Here a throwaway game
 * scene, built the way GameView builds the hideout, is drawn on the SHARED engine
 * (shared-engine.ts) under a link hold: its programs are linked, nothing on the
 * main thread waits for them, and the GPU process compiles them during the median
 * 24 s players spend in the menu. `Effect.PersistentMode` keeps them after the
 * scene goes, so GameView's materials get the same programs back from Babylon's
 * cache, and `endGameWarm` puts them back in the finalize line.
 *
 * Imported dynamically by the menu and statically by GameView; no menu module
 * imports GameView. A head start, never a prerequisite: any failure just stops it.
 */
import { Vector3, type AbstractEngine, type Observer } from "@babylonjs/core";
import { characterClass } from "@exiled/content-runtime";
import type { GraphicsSettings } from "../settings";
import { looksForClass } from "../menu/class-looks";
import { applyGraphics, capMaterialLights, createScene, setMapFill } from "./engine";
import { buildSkyEnvironment, ENVIRONMENT_INTENSITY, GROUND_COLOR, SKY_COLOR } from "./environment";
import { warmFireFlames } from "./flames";
import { setGroundPatch } from "./ground-patch";
import { buildHideoutDecor } from "./hideout";
import { applyBiomeTint, applyTilesetFloor, buildLevel, tilesetDir } from "./level";
import { resetFireLights } from "./lights";
import { makeMesh, warmEntityLooks, warmProjectiles } from "./meshes";
import { loadMonsters, resetMonsters } from "./monsters";
import { loadPet, resetPet } from "./pet";
import { loadProps, resetProps } from "./props";
import { loadPlayerRig, resetPlayerRig, rigOf, type Body } from "./rig";
import { loadRocks, resetRocks } from "./rocks";
import { buildSea } from "./sea";
import { sharedGl } from "./shared-engine";
import { drawAllCasters } from "./shadow-cull";
import { warmSkillFx } from "./skill-fx";
import { warmBossFx } from "./boss-fx";
import { warmKit } from "./skills/kit";
import { warmSkillLooks } from "./skills/warm-looks";

/** Stop once this long has passed with no new program: every link of the scene is in. */
const QUIET_MS = 2000;
/** Nothing held by then: no parallel compile here, so every link already compiled where it stood. */
const GIVE_UP_MS = 20000;

let started = false;
let stopLive: (() => void) | null = null;

export function startGameWarm({ classId, graphics }: { classId: string | null; graphics: GraphicsSettings }): void {
  if (started) return;
  started = true;
  const { engine, links } = sharedGl();
  // Before the scene: its post processes create their effects in their constructors.
  links.hold(true);
  const { scene, detachZoom } = createScene(engine);
  // Null engine: the resolution scale belongs to the menu while it is up.
  applyGraphics(scene, null, graphics);
  let stopped = false;
  let observer: Observer<AbstractEngine> | null = null;
  const releases: (() => void)[] = [];
  const stop = () => {
    if (stopped) return;
    stopped = true;
    stopLive = null;
    // What it linked stays held until GameView releases it; the menu's later links are its own.
    links.hold(false);
    if (observer) engine.onBeginFrameObservable.remove(observer);
    for (const release of releases) release();
    detachZoom();
    // GameView's own teardown list: the loaders cache per scene or per page.
    resetPlayerRig(scene);
    resetProps();
    resetFireLights();
    resetMonsters();
    resetRocks();
    resetPet();
    scene.dispose();
  };
  stopLive = stop;

  const body: Body = classId ? characterClass(classId).body : "male";
  const bodies = [...new Set<Body>(["male", "female", body])];
  void Promise.all([loadPlayerRig(scene, bodies), loadProps(scene), loadRocks(scene), loadMonsters(scene), loadPet(scene)])
    .then(() => {
      if (stopped) return;
      // The hideout, as GameView builds it on a session's first area message.
      buildLevel(scene, null, undefined, [], []);
      buildSea(scene, null, false);
      setMapFill(scene, false);
      buildHideoutDecor(scene);
      applyTilesetFloor(scene, null);
      setGroundPatch(scene, null, tilesetDir);
      applyBiomeTint(scene, null, 1, false);
      warmSkillFx(scene);
      warmKit(scene);
      warmBossFx(scene);
      warmProjectiles(scene);
      // Who stands in it: the snapshot's hideout entities.
      const player = makeMesh(scene, "player", "warm-player", Vector3.Zero(), body);
      if (classId) rigOf(player)?.setLooks(looksForClass(classId));
      for (const kind of ["mapDevice", "stash", "vendor", "cartographer"] as const) {
        makeMesh(scene, kind, `warm-${kind}`, Vector3.Zero());
      }
      releases.push(warmEntityLooks(scene, { map: false }), warmSkillLooks(scene), warmFireFlames());
      buildSkyEnvironment(scene, { sky: SKY_COLOR, ground: GROUND_COLOR, intensity: ENVIRONMENT_INTENSITY });
      // The whole hideout, not the first view of it: nothing here is drawn anyway.
      for (const mesh of scene.meshes) mesh.alwaysSelectAsActiveMesh = true;
      capMaterialLights(scene);
      drawAllCasters(scene, Number.MAX_SAFE_INTEGER);
      let lastHeld = -1;
      const begun = performance.now();
      let quietSince = begun;
      // Before the menu's own render, which clears the canvas after it.
      observer = engine.onBeginFrameObservable.add(() => {
        try {
          scene.render();
        } catch {
          stop();
          return;
        }
        const now = performance.now();
        if (links.held() !== lastHeld) {
          lastHeld = links.held();
          quietSince = now;
        } else if (now - quietSince > QUIET_MS && (lastHeld > 0 || now - begun > GIVE_UP_MS)) {
          stop();
        }
      });
    })
    .catch(() => stop());
}

/** GameView, on mount: drop the warm scene if it is still up and give the game its programs. */
export function endGameWarm(): void {
  stopLive?.();
  sharedGl().links.release();
}
