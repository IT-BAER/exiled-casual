/**
 * Every texture the WORLD can ask for after the loading plate has come down.
 *
 * `ui-art.ts` is the same idea for panels, and this is its half: a file that
 * nothing fetches until the moment it is needed is a file that arrives late, and
 * "late" in a map is a frame that took 40 ms because a 300 KB sheet was still on
 * the wire. Every entry below is loaded lazily by something in `render/` — the
 * fire sheet by the first Ember Bolt, an item icon by the first drop, a gear
 * texture by the first piece equipped — so every one of them is a stutter with a
 * trigger the player controls.
 *
 * What is deliberately NOT here:
 *
 * - `textures/ui/**` and `/hud/**`: `preloadUiArt` owns those, in its own order.
 * - `textures/tilesets/**` and `textures/loading/**`: per-area, and the loading
 *   plate already waits on them — it comes down on `scene.executeWhenReady`
 *   plus a painted frame, and both are built during the area message.
 * - `floor.png`, `imp_skin.png`, `rare_skin.png`, `robe_cloth.png`: 9 MB between
 *   them, and all four are the GREYBOX fallback — what gets drawn when
 *   `monsters.glb` or `wardrobe.glb` did not load at all. Preloading the
 *   fallback for a failure that already ruins the frame is 9 MB spent on the
 *   worst case of the worst case.
 *
 * This file imports nothing, for the same reason `ui-art.ts` imports nothing:
 * the list has to be readable by a test that cannot mount a renderer. And
 * `world-art.test.ts` walks `public/textures` and fails when a file that belongs
 * here is missing, so the list cannot quietly rot behind a new asset.
 */

/** In load order: what the first ten seconds in a map can ask for, first. */
export const WORLD_ART: readonly string[] = [
  // Skill effects. The fire sheet is the first thing a cast wants.
  "/textures/fx/fire_sheet_v1.png",
  "/textures/fx/haze.png",
  "/textures/fx/ember_cracks_v1.png",
  // The HUD's own icons: the bar paints these before anything is cast.
  "/textures/skills/ember_bolt.png",
  "/textures/skills/cinder_ground.png",
  "/textures/skills/blink.png",
  "/textures/skills/strike.png",
  "/textures/skills/snap_shot.png",
  "/textures/skills/ember_spark.png",
  "/textures/skills/move.png",
  "/textures/buffs/grace.png",
  // Level dressing: the sea and the rock a coast is cut from.
  "/textures/water/water_normal.jpg",
  "/textures/walls/wall_color.jpg",
  "/textures/walls/wall_normal.jpg",
  "/textures/world/brazier_fire_sheet.png",
  // Item icons: one drop is one icon, and a boss drops five at once.
  "/textures/items/ember_cowl.png",
  "/textures/items/ember_focus.png",
  "/textures/items/ember_robe.png",
  "/textures/items/ember_sash.png",
  "/textures/items/ember_slippers.png",
  "/textures/items/ember_wand.png",
  "/textures/items/ember_wraps.png",
  "/textures/items/ironsworn_gauntlets.png",
  "/textures/items/ironsworn_girdle.png",
  "/textures/items/ironsworn_helm.png",
  "/textures/items/ironsworn_plate.png",
  "/textures/items/ironsworn_sabatons.png",
  "/textures/items/ironsworn_tower_shield.png",
  "/textures/items/stalker_boots.png",
  "/textures/items/stalker_buckler.png",
  "/textures/items/stalker_gloves.png",
  "/textures/items/stalker_hood.png",
  "/textures/items/stalker_leathers.png",
  "/textures/items/stalker_strap.png",
  "/textures/items/orb_alchemy.png",
  "/textures/items/orb_augmentation.png",
  "/textures/items/orb_elevation.png",
  "/textures/items/orb_embers.png",
  "/textures/items/orb_transmutation.png",
  "/textures/items/portal_scroll.png",
  "/textures/items/unique_ashmaw.png",
  "/textures/items/unique_cinderveil.png",
  "/textures/items/unique_emberchoir.png",
  "/textures/items/wisdom_scroll.png",
];

/**
 * Ask for all of it and forget about it.
 *
 * `Image` rather than `fetch`, the same choice `preloadUiArt` makes and for a
 * better reason here: Babylon decodes a `.png`/`.jpg` texture through an
 * `HTMLImageElement` too, so a warm image cache is a texture that arrives
 * decoded rather than one that arrives at all.
 *
 * Fire and forget: a 404 or an offline load leaves the old lazy path, which
 * costs a hitch and never a crash. Returns a promise only so the caller can hold
 * the loading plate up for it, and so a test can await it.
 */
export function preloadWorldArt(): Promise<void> {
  if (typeof Image === "undefined") return Promise.resolve();
  return Promise.all(
    WORLD_ART.map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = src;
        }),
    ),
  ).then(() => undefined);
}
