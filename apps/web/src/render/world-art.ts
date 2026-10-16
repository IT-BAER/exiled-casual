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
 * - `floor.webp`: the hideout floor (and the floor of an area without a
 *   tileset), already drawn by the time the loading plate comes down.
 * - `imp_skin.png`, `rare_skin.png`, `robe_cloth.png`: 9 MB between them, and
 *   all three are the GREYBOX fallback — what gets drawn when `monsters.glb` or
 *   `wardrobe.glb` did not load at all. Preloading the fallback for a failure
 *   that already ruins the frame is 9 MB spent on the worst case of the worst case.
 *
 * This file imports nothing, for the same reason `ui-art.ts` imports nothing:
 * the list has to be readable by a test that cannot mount a renderer. And
 * `world-art.test.ts` walks `public/textures` and fails when a file that belongs
 * here is missing, so the list cannot quietly rot behind a new asset.
 */

/** In load order: what the first ten seconds in a map can ask for, first. */
export const WORLD_ART: readonly string[] = [
  // Skill effects. The fire sheet is the first thing a cast wants.
  "/textures/fx/fire_sheet_v1.webp",
  "/textures/fx/haze.webp",
  "/textures/fx/smoke_puff.webp",
  "/textures/fx/ember_cracks_v1.webp",
  // The HUD's own icons: the bar paints these before anything is cast.
  "/textures/skills/ember_bolt.webp",
  "/textures/skills/cinder_ground.webp",
  "/textures/skills/blink.webp",
  "/textures/skills/strike.webp",
  "/textures/skills/heavy_strike.webp",
  "/textures/skills/piercing_shot.webp",
  "/textures/skills/ground_slam.webp",
  "/textures/skills/split_arrow.webp",
  "/textures/skills/town_portal.webp",
  "/textures/skills/snap_shot.webp",
  "/textures/skills/ember_spark.webp",
  "/textures/skills/move.webp",
  "/textures/buffs/grace.webp",
  "/textures/buffs/burning.webp",
  "/textures/buffs/poison.webp",
  "/textures/buffs/bleeding.webp",
  // Level dressing: the sea. Wall plates are per biome, under tilesets/.
  "/textures/water/water_normal.jpg",
  // Item icons: one drop is one icon, and a boss drops five at once.
  "/textures/items/ember_cowl.webp",
  "/textures/items/ember_focus.webp",
  "/textures/items/ember_robe.webp",
  "/textures/items/ember_sash.webp",
  "/textures/items/ember_slippers.webp",
  "/textures/items/ember_wand.webp",
  "/textures/items/ember_kindling_wand.webp",
  "/textures/items/ironsworn_hammer.webp",
  "/textures/items/broadsword.webp",
  "/textures/items/stalker_bow.webp",
  "/textures/items/ember_wraps.webp",
  "/textures/items/ironsworn_gauntlets.webp",
  "/textures/items/ironsworn_girdle.webp",
  "/textures/items/ironsworn_helm.webp",
  "/textures/items/ironsworn_plate.webp",
  "/textures/items/ironsworn_sabatons.webp",
  "/textures/items/ironsworn_tower_shield.webp",
  "/textures/items/stalker_boots.webp",
  "/textures/items/stalker_buckler.webp",
  "/textures/items/stalker_gloves.webp",
  "/textures/items/stalker_hood.webp",
  "/textures/items/stalker_leathers.webp",
  "/textures/items/stalker_strap.webp",
  "/textures/items/orb_alchemy.webp",
  "/textures/items/orb_augmentation.webp",
  "/textures/items/orb_elevation.webp",
  "/textures/items/orb_embers.webp",
  "/textures/items/orb_transmutation.webp",
  "/textures/items/portal_scroll.webp",
  "/textures/items/unique_ashmaw.webp",
  "/textures/items/unique_cinderveil.webp",
  "/textures/items/unique_emberchoir.webp",
  "/textures/items/unique_anvilheart.webp",
  "/textures/items/unique_gravewall.webp",
  "/textures/items/unique_mossback.webp",
  "/textures/items/unique_oathbreaker.webp",
  "/textures/items/unique_quietus.webp",
  "/textures/items/unique_thornward.webp",
  "/textures/items/wisdom_scroll.webp",
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
