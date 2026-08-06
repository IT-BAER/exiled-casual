import React, { useEffect, useRef, useState } from "react";
import { Engine, Matrix, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { applyGraphics, createScene, setMapFill } from "./render/engine";
import { buildLevel, applyBiomeTint, applyTilesetFloor } from "./render/level";
import { buildSea } from "./render/sea";
import { buildHideoutDecor, clearHideoutDecor } from "./render/hideout";
import { SnapshotRenderer } from "./render/renderer";
import { loadProps, resetProps } from "./render/props";
import { loadMonsters, resetMonsters } from "./render/monsters";
import { enablePhysics, resetPhysics } from "./render/ragdoll";
import { toggleGallery } from "./render/gallery";
import { resetFireLights } from "./render/lights";
import { loadRocks, resetRocks } from "./render/rocks";
import { loadPlayerRig, resetPlayerRig } from "./render/rig";
import { attachBindings } from "./input/bindings";
import { CORE_SFX, playSfx, preloadSfx, setAmbient, stopAmbient } from "./audio/sfx";
import { createSoundscape } from "./audio/soundscape";
import { preloadUiArt } from "./ui-art";
import { setTitle } from "./title";
import { FeedbackDialog, type FeedbackKind } from "./menu/FeedbackDialog";
import { Hud, BAR_H, ORB_RISE } from "./hud/Hud";
import { PreparationPanel } from "./hud/PreparationPanel";
import { InventoryPanel } from "./hud/InventoryPanel";
import { CharacterPanel } from "./hud/CharacterPanel";
import { LootLabels } from "./hud/LootLabels";
import { NpcLabels } from "./hud/NpcLabels";
import { Minimap } from "./hud/Minimap";
import { BuffBar } from "./hud/BuffBar";
import { DebugStats } from "./hud/DebugStats";
import { Divider, FramedPanel, GOLD, MenuButton, DISPLAY, SERIF } from "./menu/frames";
import { LoadingScreen, LOADING_ART, FADE_MS } from "./LoadingScreen";
import { pickTip } from "./tips";
import { OptionsPanel } from "./menu/OptionsPanel";
import { DEFAULT_SETTINGS, MOUSE_SLOT_BASE, MOVE_SOCKET, type Settings } from "./settings";
import type { FrameHook, Projector } from "./hud/LootLabels";
import type { AreaLayout } from "@exiled/mapgen";
import { BIOMES, mapBase } from "@exiled/content-runtime";
import type { Snapshot, FromWorker, ToWorker } from "@exiled/protocol";
import { atlasGraph, atlasNodeTier, isNodeReachable, mapBaseIdForNode } from "@exiled/rules";

const LAB_SEED = 42;
// ponytail: fixed seed for the lab; M3 will thread seed from game state
const MS_PER_TICK = 1000 / 30;

export interface GameViewProps {
  /**
   * The roster entry being played. Empty means the pre-roster single save, which
   * is what the lab and the tests boot; the worker keeps both paths.
   */
  characterId?: string;
  /** Leave the game and go back to character select. */
  onExit?: () => void;
  /** What the player has set. Defaulted so the lab and the tests can boot bare. */
  settings?: Settings;
  /** Report a change up; App is what applies sound and persists. */
  onSettingsChange?: (next: Settings) => void;
}

export function GameView({
  characterId = "",
  onExit,
  settings = DEFAULT_SETTINGS,
  onSettingsChange,
}: GameViewProps = {}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [hoveredEntityId, setHoveredEntityId] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  // Backpack cell holding the waystone seated in the map-device socket, null while empty.
  const [socketedCell, setSocketedCell] = useState<{ x: number; y: number } | null>(null);
  // PoE opens the stash beside the inventory, never on its own.
  const [stashOpen, setStashOpen] = useState(false);
  // The bench takes the same left-hand slot as the stash, so one closes the other.
  const [vendorOpen, setVendorOpen] = useState(false);
  const [characterOpen, setCharacterOpen] = useState(false);
  // The Escape menu: the only way back out to character select.
  const [gameMenuOpen, setGameMenuOpen] = useState(false);
  /** Which report dialog is open, if any. Overlays take turns here too. */
  const [feedback, setFeedback] = useState<FeedbackKind | null>(null);

  /**
   * Escape stops the world.
   *
   * The panel said "Paused" and nothing was: monsters kept walking in behind the
   * menu and a burning ground kept burning while the player read it. The sim
   * lives in a worker with its own clock, so pausing is one message and the
   * clock stops — no tick is skipped and the run resumes exactly where it was.
   *
   * Only the pause menu pauses. The inventory, the Atlas and the character sheet
   * are all things PoE leaves the world running behind, and a game that freezes
   * whenever a panel is open is a game you can stand still in to think.
   */
  useEffect(() => {
    workerRef.current?.postMessage({ type: "pause", paused: gameMenuOpen } satisfies ToWorker);
  }, [gameMenuOpen]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // F3 performance readout. Render-only; toggleable even on the death screen.
  const [statsOpen, setStatsOpen] = useState(false);
  // Tab's big centred map, meant to be left open while running. Render-only.
  const [overlayMapOpen, setOverlayMapOpen] = useState(false);
  // The Options panel applies graphics to the LIVE scene, and the scene is built
  // inside the mount effect where nothing else can reach it.
  const sceneRef = useRef<Scene | null>(null);
  const engineRef = useRef<Engine | null>(null);
  // The keydown listener is attached once, so it cannot read these flags
  // directly without reading them as they were on mount. One mirror ref is
  // cheaper than five functional updates that also have to decide something.
  const overlayOpenRef = useRef(false);
  overlayOpenRef.current =
    panelOpen || inventoryOpen || stashOpen || vendorOpen || characterOpen || optionsOpen;
  /**
   * Down and waiting on the death screen. Same mirror-ref trick as above, and for
   * the same reason: the keydown listener is attached once. While it is set, no
   * hotkey opens anything — the screen has exactly two answers and neither of them
   * is the inventory.
   */
  const deadRef = useRef(false);
  deadRef.current = snapshot !== null && !snapshot.player.alive;
  /**
   * The skill bar, mirrored for the same reason: `attachBindings` is called once on
   * mount and its key handler has to fire whatever is in the socket NOW, not
   * whatever was in it when the game started.
   */
  const skillBarRef = useRef(settings.ui.skillBar);
  skillBarRef.current = settings.ui.skillBar;
  // The map's layout, kept for the minimap. Null in the hideout, which has none.
  const [areaLayout, setAreaLayout] = useState<AreaLayout | null>(null);
  const [project, setProject] = useState<Projector | null>(null);
  const [afterFrame, setAfterFrame] = useState<FrameHook | null>(null);
  const [pick, setPick] = useState<((id: number, x: number, y: number) => void) | null>(null);
  const workerRef = useRef<Worker | null>(null);
  /**
   * The loading plate. True from mount, and true again from the moment an `area`
   * message lands until a frame has actually been PAINTED for that area.
   *
   * There is no timer anywhere in this path on purpose (`docs/09` rule 8). The
   * three other facts — assets loaded, level built, textures ready — are all
   * upstream of the painted frame, so one signal covers them: the render loop
   * only starts after `loadPlayerRig`/`loadProps`/`loadRocks`/`loadMonsters` resolve, and the
   * paint is only armed once `scene.executeWhenReady` says the new area's
   * materials are in. A scene can report every other kind of ready and still
   * draw one black frame, which is the frame the player would have seen.
   */
  const [loading, setLoading] = useState(true);
  /** The world is ready and the plate is dissolving off it. Cleared by the next area. */
  const [leaving, setLeaving] = useState(false);
  /** Where we are going, already resolved. The plate names the destination, not the origin. */
  const [area, setArea] = useState<{ name: string; art: string | undefined }>({
    name: "Hideout",
    art: `${LOADING_ART}/hideout.jpg`,
  });

  // The tab names the place the character is standing in.
  useEffect(() => { setTitle(area.name); }, [area.name]);
  /** Chosen when a load STARTS, so a re-render mid-load cannot swap the line being read. */
  const [tip, setTip] = useState(() => pickTip());

  // Resolve the socketed item on each render; clear the cell when the item is gone.
  const socketedItem = socketedCell && snapshot
    ? snapshot.inventory.items.find(
        (i) => i.x === socketedCell.x && i.y === socketedCell.y && i.baseId === "map.waystone",
      ) ?? null
    : null;
  // ponytail: derive socketedStone inline; a separate useEffect would re-render twice per snapshot.
  const socketedStone = socketedItem?.waystone
    ? { ...socketedCell!, ...socketedItem.waystone }
    : null;
  // Clear the cell reference once the item moves away (consumed, moved, or picked up).
  useEffect(() => {
    if (socketedCell && !socketedItem) setSocketedCell(null);
  }, [snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Spawn sim worker
    const worker = new Worker(
      new URL("./worker/sim-worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    worker.postMessage({ type: "init", seed: LAB_SEED, characterId });

    let prevSnap: Snapshot | null = null;
    let curSnap: Snapshot | null = null;
    let prevTickTime = performance.now();
    /**
     * Armed by an `area` message once the scene reports ready, cleared by the
     * first frame painted after it. A local rather than a ref because it is only
     * ever read and written inside this effect, and it must die with the scene
     * it describes — this component's own cleanup is the only correct lifetime
     * for it, StrictMode's second mount included.
     */
    let needsPaint = false;
    /** Pending unmount of the plate, one fade after ready. Cancelled by a new area. */
    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * The fight, heard. Fed every snapshot and reset on every area, since it
     * works by diffing consecutive ones and a rebuilt area shares no entity ids
     * with the one before it. Loading starts here rather than on first use so the
     * opening bolt of a session is not the one that fires in silence.
     */
    const soundscape = createSoundscape();
    void preloadSfx(CORE_SFX);

    // Babylon engine + render loop
    // Ask for the discrete GPU on dual-GPU laptops; context-loss recovery is a
    // reload anyway, so skip the bookkeeping Babylon does to support it.
    const engine = new Engine(canvas, true, {
      powerPreference: "high-performance",
      doNotHandleContextLost: true,
    });
    const { scene, camera, detachZoom } = createScene(engine);
    sceneRef.current = scene;
    engineRef.current = engine;
    const renderer = new SnapshotRenderer(scene);

    // Ground-item name plates live in the DOM, so they need the camera's
    // world -> canvas projection. Sim (x, y) maps to world (x, z).
    setProject(() => (x: number, y: number, worldY = 0) => {
      const p = Vector3.Project(
        new Vector3(x, worldY, y),
        Matrix.Identity(),
        scene.getTransformMatrix(),
        camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
      );
      return { x: p.x, y: p.y, visible: p.z > 0 && p.z < 1 };
    });

    // Labels are placed after the frame is drawn, never on their own rAF: see
    // FrameHook in hud/LootLabels.tsx for what a frame of lag looks like.
    // Guarded: a test's stub scene has no observables, and the labels fall back
    // to their own frame callback when this stays null.
    if (scene.onAfterRenderObservable) {
      setAfterFrame(() => (cb: () => void) => {
        const observer = scene.onAfterRenderObservable.add(cb);
        return () => { scene.onAfterRenderObservable.remove(observer); };
      });
    }

    // Bindings need the scene for ground picking, and must be attached before the
    // onmessage handler below so onSnapshot exists when the worker starts sending.
    const { detach, onSnapshot, approach, getAim } = attachBindings(
      canvas,
      worker,
      scene,
      () => renderer.cyclePlayerOutfit(),
      (id) => {
        // Both the renderer (mesh highlight) and React (HUD label) must update.
        renderer.setHoveredEntity(id);
        setHoveredEntityId(id);
      },
      // The device opens with a run already open now: activating a different place
      // abandons the old run and starts the new one (systems/interact.ts). This
      // used to refuse, back when the sim refused too, and the result was that an
      // open map made the Atlas unreachable until you finished or died in it.
      (open) => {
        setPanelOpen(open);
        // Opening the device also opens the inventory so the player can drag a waystone.
        if (open) setInventoryOpen(true);
      },
      // Walking up to the furniture opens the inventory with it, so walking off has
      // to take it away again: a panel the player never asked for cannot outlive the
      // thing that raised it. Closing with the X is a different path and still leaves
      // the inventory up, which is the case where it IS the player's own panel.
      (open) => { setStashOpen(open); setInventoryOpen(open); if (open) { setVendorOpen(false); setCharacterOpen(false); } },
      (open) => { setVendorOpen(open); setInventoryOpen(open); if (open) { setStashOpen(false); setCharacterOpen(false); } },
      // The key row IS the bar's order: `1` fires the first socket, whatever the
      // player last dragged into it.
      (key) => skillBarRef.current[Number(key) - 1] ?? null,
      // Returns the raw socket value: MOVE_SOCKET, a skill id, or null (cleared).
      // The bindings layer decides what each means.
      (button) => skillBarRef.current[MOUSE_SLOT_BASE + button] ?? null,
    );

    // Loot plates are DOM, so their click has to reach the same approach-then-act
    // path the canvas picker uses for portals and devices.
    setPick(() => approach);

    // `?play&map` / `?play&map=<node name>`: the driven-browser leg of the ?play
    // harness (App.tsx). Bare `map` opens the device panel on arrival; a name
    // sockets the permanent waystone into that node, activates it, and walks
    // into the first portal — a map session with no clicks a script cannot aim.
    // DEV only, like ?play itself.
    let harness: "panel" | "activate" | "portal" | "done" = "done";
    if (import.meta.env?.DEV && typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.has("map")) harness = params.get("map") ? "activate" : "panel";
    }
    let harnessTicks = 0;
    /**
     * Snapshots to let pass before the harness touches anything.
     *
     * The worker answers `init` by starting the clock AND kicking off an async
     * `hydrate()` that restores the saved session. Snapshots flow in between: an
     * activateMap accepted in that window is applied to a session the restore
     * then overwrites, so the map opens and is silently forgotten. Every symptom
     * of that is invisible from here — the intent is valid, the sim accepts it,
     * and the hideout just sits there.
     */
    const HARNESS_SETTLE_TICKS = 45;
    /**
     * When to stop waiting and show whatever we are standing in.
     *
     * The loading plate is held up for the whole hideout leg (see `needsPaint`),
     * which is the only way `?play&map=<node>` opens ON the beach instead of
     * showing a hideout, a walk and a portal first. The cost of that is a black
     * screen if the harness ever gets stuck — a node the sim quietly refuses, a
     * portal that never spawns — so it gives up after twenty seconds and lets
     * the hideout through rather than hanging on a plate forever.
     */
    const HARNESS_GIVE_UP_TICKS = 30 * 20;
    const harnessStep = (snap: Snapshot): void => {
      if (harnessTicks++ < HARNESS_SETTLE_TICKS) return;
      if (harnessTicks > HARNESS_GIVE_UP_TICKS) {
        console.warn("?map: gave up waiting; showing the area we are in");
        harness = "done";
        return;
      }
      if (harness === "panel") {
        if (snap.entities.some((e) => e.kind === "mapDevice")) {
          setPanelOpen(true);
          setInventoryOpen(true);
          harness = "done";
        }
      } else if (harness === "activate") {
        // A run already open (the stone is spent) still has portals standing.
        if (snap.mapOpen) {
          harness = "portal";
          return;
        }
        const wanted = `node.${new URLSearchParams(window.location.search).get("map")}`;
        // Which PLACE the URL asks for, and a stone good enough to open it.
        //
        // Both halves need care because the Atlas is seeded PER CHARACTER. The
        // node named on the URL is often unreachable (the sim refuses, silently
        // from here), and a reachable node of the same base may sit further out
        // than a Tier 1 stone can open — the two rules together are why this
        // harness used to strand itself in the hideout after a couple of runs.
        const graph = atlasGraph(snap.atlasSeed);
        const exact = graph.find((n) => n.id === wanted);
        if (!exact) {
          console.warn(`?map: no node "${wanted}"; have`, graph.map((n) => n.id));
          harness = "done";
          return;
        }
        const base = mapBaseIdForNode(exact.id);
        const stones = snap.inventory.items
          .filter((i) => i.baseId === "map.waystone" && i.waystone)
          .sort((a, b) => a.waystone!.tier - b.waystone!.tier);
        if (stones.length === 0) return;
        const candidates = [exact, ...graph.filter((n) => n.id !== exact.id)]
          .filter((n) =>
            mapBaseIdForNode(n.id) === base &&
            isNodeReachable(graph, snap.completedNodes, n.id) &&
            !snap.completedNodes.includes(n.id))
          .sort((a, b) => atlasNodeTier(graph, a.id) - atlasNodeTier(graph, b.id));
        const node = candidates.find((n) =>
          stones.some((st) => st.waystone!.tier >= atlasNodeTier(graph, n.id)));
        if (!node) {
          console.warn(`?map: no reachable "${base}" node this character can open`);
          harness = "done";
          return;
        }
        const stone = stones.find((st) => st.waystone!.tier >= atlasNodeTier(graph, node.id))!;
        console.info("?map: opening", node.id, "tier", atlasNodeTier(graph, node.id), "with stone tier", stone.waystone!.tier);
        // `worker`, not `workerRef.current`: this runs from THIS worker's own
        // message handler, and under StrictMode the ref has already been
        // repointed (or nulled by the first mount's cleanup) by the time a
        // snapshot arrives. `?.` then swallowed the whole intent, which is why
        // the harness sat in the hideout with a perfectly good Waystone in the
        // bag and nothing in the console.
        worker.postMessage({
          type: "intent",
          intent: { kind: "activateMap", atlasNodeId: node.id, x: stone.x, y: stone.y },
        } satisfies ToWorker);
        harness = "portal";
      } else if (harness === "portal") {
        // Re-issued once a second, not fired-and-done: the first snapshots come
        // in behind the loading fade, where an intent can land before the sim
        // is taking them. The area handler below ends it when the map arrives.
        const portal = snap.entities.find((e) => e.kind === "portal");
        if (portal && harnessTicks % 30 === 0) approach(portal.id, portal.x, portal.y);
      }
    };

    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      if (msg.type === "snapshot") {
        prevSnap = curSnap;
        curSnap = msg.snapshot;
        // DEV: the only handle on sim state from the devtools console. The
        // renderer can be read through `__scene`; without this the sim cannot,
        // and "why did the harness not enter the map" has no answer.
        if (import.meta.env?.DEV && typeof window !== "undefined") {
          (window as unknown as { __snap?: unknown }).__snap = msg.snapshot;
        }
        prevTickTime = performance.now();
        soundscape.observe(msg.snapshot);
        setSnapshot(msg.snapshot);
        // The RISING edge, not the state: the device opens with a run already
        // running now, and a flat `if (mapOpen)` closed that panel again on the
        // very next snapshot.
        if (msg.snapshot.mapOpen && !(prevSnap?.mapOpen ?? false)) {
          setPanelOpen(false);
          setInventoryOpen(false);
        }
        // Let bindings fire the interact intent once the pending target is inRange.
        onSnapshot(msg.snapshot);
        if (harness !== "done") harnessStep(msg.snapshot);
      } else if (msg.type === "area") {
        // The ?map harness's destination: once a map area arrives, its job is done.
        if (msg.area === "map") harness = "done";
        // Dungeon walls belong to the "map". The hideout is an open lab: pass an
        // empty grid so buildLevel clears any stale walls and draws none.
        const grid = msg.area === "map" ? msg.layout.grid : null;
        // The base says what the place is made of: which stone the walls take,
        // and what colour its light is. The hideout has no base, so it gets the
        // neutral rig back rather than keeping the last map's mood.
        const base = msg.mapBaseId ? mapBase(msg.mapBaseId) : null;
        // Cover the swap before it starts. Disarming first matters: a frame
        // already in flight for the OLD area must not be allowed to report the
        // new one ready.
        needsPaint = false;
        // The one sound the player makes and never hears an entity for: the
        // crossing itself. Every id in the new area is new, so the diff has to
        // start over or the whole old population would be reported dead.
        playSfx("portal-enter");
        // The base also says what the floor is, which is what his boots land on.
        soundscape.reset(base?.biomeId ?? null);
        setAmbient(base?.biomeId ?? null);
        // Nothing the player had open belongs to the place they just left. The
        // inventory in particular: opening a map from the device leaves it up, and
        // stepping through the portal used to land you in the map reading a bag.
        setPanelOpen(false);
        setInventoryOpen(false);
        setStashOpen(false);
        setVendorOpen(false);
        setCharacterOpen(false);
        // A place that arrives mid-dissolve takes the plate back at full
        // opacity, and the unmount that dissolve had queued must not fire on it.
        clearTimeout(fadeTimer);
        setLoading(true);
        setLeaving(false);
        setTip(pickTip());
        const biome = base ? BIOMES[base.biomeId] : null;
        setArea({
          name: biome?.name ?? "Hideout",
          art: `${LOADING_ART}/${base?.biomeId ?? "hideout"}.jpg`,
        });
        buildLevel(scene, grid, base?.tilesetId);
        buildSea(scene, grid, base ? BIOMES[base.biomeId].sea === true : false);
        setMapFill(scene, msg.area === "map");
        // Furniture, and only in the hideout: a map is a place you pass through.
        if (msg.area === "hideout") buildHideoutDecor(scene);
        else clearHideoutDecor(scene);
        applyTilesetFloor(scene, base?.tilesetId ?? null);
        applyBiomeTint(
          scene,
          base ? BIOMES[base.biomeId].tint : null,
          base ? BIOMES[base.biomeId].light ?? 1 : 1,
          base ? BIOMES[base.biomeId].sea === true : false,
        );
        setAreaLayout(msg.area === "map" ? msg.layout : null);
        // Arms the paint only once this area's materials and textures are in.
        // Babylon defers this through a timeout even when nothing is pending, so
        // the plate always gets at least one render to appear in.
        scene.executeWhenReady(() => { needsPaint = true; });
      }
    };

    const renderFrame = () => {
      if (!curSnap) return;
      // ponytail: float alpha for lerp — never fed into sim
      const alpha = Math.min(1, (performance.now() - prevTickTime) / MS_PER_TICK);
      renderer.apply(prevSnap, curSnap, alpha);
      // The aim target updates every frame so the arm tracks the cursor live.
      const aim = getAim();
      renderer.setAim(aim.x, aim.y);
      // Camera follows the player (interpolated) so they stay centred like an ARPG.
      // The 4th arg (cloneAlphaBetaRadius=true) keeps the orbit fixed and moves the
      // camera WITH the target; the default recomputes the angles and drifts.
      const p = curSnap.player;
      const pp = prevSnap?.player ?? p;
      camera.setTarget(
        new Vector3(pp.x + (p.x - pp.x) * alpha, 0, pp.y + (p.y - pp.y) * alpha),
        false,
        false,
        true,
      );
      scene.render();
      // The one place the loading plate is allowed to come down: a frame for
      // this area is now on the glass. Guarded by the flag rather than by state,
      // so this costs one boolean read per frame and sets React state once.
      // Held up for the whole `?play&map=<node>` leg: the harness's hideout,
      // its walk and its portal are staging, not a place, and showing them was
      // the difference between "the URL opens the map" and "the URL watches
      // someone else open it". The plate comes down on the MAP's first frame.
      // `harness` is already "done" in normal play, so this costs nothing there,
      // and it gives up on its own after twenty seconds (HARNESS_GIVE_UP_TICKS)
      // rather than hanging on a black plate.
      if (needsPaint && harness === "done") {
        needsPaint = false;
        // Dissolve rather than cut. The world under it is finished either way —
        // this fade costs the player nothing, because the frame behind it is
        // already the one they were waiting for.
        setLeaving(true);
        fadeTimer = setTimeout(() => setLoading(false), FADE_MS);
      }
    };

    // Wait for the humanoid and the hideout props before the first frame, so
    // nothing is ever built as a greybox and then swapped for its real asset
    // mid-run. A failed load resolves too and leaves the primitive fallback in
    // place.
    let unmounted = false;
    void Promise.all([loadPlayerRig(scene), loadProps(scene), loadRocks(scene), loadMonsters(scene)]).then(() => {
      if (!unmounted) engine.runRenderLoop(renderFrame);
      // AFTER the models, never before: these are panels nobody has asked for yet,
      // and the first frame is what the player is actually waiting on. Warming them
      // here is why the first Escape no longer draws a frameless panel — see
      // ui-art.ts for why the request, not the art, was the slow part.
      preloadUiArt();
      // Two megabytes of wasm, and nothing waits on it: the first body to die
      // before it lands simply vanishes the way it always did.
      void enablePhysics(scene);
    });

    window.addEventListener("resize", () => engine.resize());

    // i = inventory, c = character sheet. Both render-only; the sim never hears
    // about either, and both can be open at once the way PoE2 has them.
    // Escape clears the screen: every overlay at once, not just the topmost. A player
    // who wants the world back should not have to count the panels they opened.
    const onInvKey = (ev: KeyboardEvent) => {
      // Before the death gate: a perf readout is diagnostics, not play.
      if (ev.key === "F3") {
        ev.preventDefault();
        setStatsOpen((v) => !v);
        return;
      }
      // F4 stands every prop and every species in rows on the floor. DEV only,
      // like the ?play harness: it is a way to look at the art, not a cheat, and
      // it has no sim side at all.
      if (ev.key === "F4" && import.meta.env?.DEV) {
        ev.preventDefault();
        if (sceneRef.current) toggleGallery(sceneRef.current, camera.target);
        return;
      }
      if (deadRef.current) return;
      // Tab is the overlay map, and must not walk the browser's focus ring.
      if (ev.key === "Tab") {
        ev.preventDefault();
        setOverlayMapOpen((v) => !v);
        return;
      }
      const k = ev.key.toLowerCase();
      if (k === "i") { setInventoryOpen((v) => !v); setStashOpen(false); }
      // The sheet is cut from the stash's pane and docks where the stash docks, so
      // the three take turns in that slot. Unconditional: the only way the stash is
      // up when `c` is pressed is if the sheet was already down.
      if (k === "c") { setCharacterOpen((v) => !v); setStashOpen(false); setVendorOpen(false); }
      if (k === "escape") {
        // Escape clears the screen first and only raises the game menu once the
        // screen is already clear. The other way round, one stray Escape while
        // the inventory is up would offer to leave the game.
        if (overlayOpenRef.current) {
          setPanelOpen(false);
          setInventoryOpen(false);
          setStashOpen(false);
          setVendorOpen(false);
          setCharacterOpen(false);
          setOptionsOpen(false);
        } else {
          setGameMenuOpen((open) => !open);
        }
      }
    };
    window.addEventListener("keydown", onInvKey);

    return () => {
      unmounted = true;
      clearTimeout(fadeTimer);
      detach();
      detachZoom(); // the canvas outlives the engine, so its listener must go
      window.removeEventListener("keydown", onInvKey);
      resetPlayerRig(); // containers belong to the scene we are about to dispose
      resetProps();
      resetFireLights();
      resetMonsters();
      resetPhysics();
      resetRocks();
      stopAmbient();
      sceneRef.current = null;
      engineRef.current = null;
      engine.dispose();
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  /**
   * Graphics apply to the scene the mount effect built. Declared AFTER it on
   * purpose: effects run in declaration order, so the refs are already set on
   * the first pass, which is also what applies the SAVED settings at boot.
   */
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene === null) return;
    applyGraphics(scene, engineRef.current, settings.graphics);
  }, [settings.graphics]);

  /**
   * A panel coming up gets one rustle of leather and parchment.
   *
   * Watched as a count rather than hooked at each call site: these open from the
   * keyboard, from walking up to the furniture, and from each other's buttons, and
   * the one thing they all have in common is that there is now one more of them.
   */
  const panelsOpen =
    [panelOpen, inventoryOpen, stashOpen, vendorOpen, characterOpen].filter(Boolean).length;
  const panelsWere = useRef(0);
  useEffect(() => {
    if (panelsOpen > panelsWere.current) playSfx("ui-panel-open");
    panelsWere.current = panelsOpen;
  }, [panelsOpen]);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      {/* First in the tree and highest in z: the canvas underneath it is still
          being built, and the HUD below is reading a snapshot from the area the
          player just left. */}
      {loading && (
        <LoadingScreen
          areaName={area.name}
          tip={tip}
          leaving={leaving}
          {...(area.art ? { wallpaper: area.art } : {})}
        />
      )}
      {/* Stays mounted with the plates off: the drop CUE is played from inside
          LootLabels, and a HUD toggle that also silenced every drop would be a
          bug wearing a setting's clothes. */}
      <LootLabels
        snapshot={snapshot}
        project={project}
        afterFrame={afterFrame}
        onPick={pick ?? undefined}
        plates={settings.ui.lootLabels}
      />
      <NpcLabels snapshot={snapshot} project={project} afterFrame={afterFrame} />
      <BuffBar snapshot={snapshot} />
      <Hud
        snapshot={snapshot}
        hoveredEntityId={hoveredEntityId}
        skillBar={settings.ui.skillBar}
        orbNumbers={settings.ui.orbNumbers}
        onSkillBarChange={(skillBar) => onSettingsChange?.({
          ...settings, ui: { ...settings.ui, skillBar },
        })}
      />
      {settings.ui.minimap && (
        <Minimap
          layout={areaLayout}
          player={snapshot?.player ?? null}
          overlay={overlayMapOpen}
          overlayOpacity={settings.ui.overlayMapOpacity}
        />
      )}
      {statsOpen && <DebugStats engineRef={engineRef} sceneRef={sceneRef} />}
      {panelOpen && snapshot && (
        <PreparationPanel
          atlasSeed={snapshot.atlasSeed}
          completedNodes={snapshot.completedNodes}
          socketedStone={socketedStone}
          mapOpen={snapshot.mapOpen}
          onEject={() => setSocketedCell(null)}
          onNodeSelect={() => setInventoryOpen(true)}
          onClose={() => { setPanelOpen(false); setSocketedCell(null); }}
          onActivate={(atlasNodeId, x, y) => {
            workerRef.current?.postMessage({
              type: "intent",
              intent: { kind: "activateMap", atlasNodeId, x, y },
            });
            setPanelOpen(false);
            setSocketedCell(null);
          }}
        />
      )}
      {inventoryOpen && snapshot && (
        <InventoryPanel
          inventory={snapshot.inventory}
          {...(stashOpen ? { stash: snapshot.stash } : {})}
          onCloseStash={() => setStashOpen(false)}
          shards={snapshot.shards}
          vendorOpen={vendorOpen}
          vendor={snapshot.vendor}
          gold={snapshot.player.gold}
          onCloseVendor={() => setVendorOpen(false)}
          equipment={snapshot.equipment}
          // socketWanted: panel is open and the socket is empty, so ctrl+click / drag sockets a stone.
          socketWanted={panelOpen && socketedStone === null}
          onSocketWaystone={(x, y) => setSocketedCell({ x, y })}
          onIntent={(intent) => workerRef.current?.postMessage({ type: "intent", intent } satisfies ToWorker)}
          onClose={() => { setInventoryOpen(false); setStashOpen(false); setVendorOpen(false); }}
        />
      )}
      {/* After the inventory so it paints above that panel's backdrop when both are open. */}
      {characterOpen && snapshot && (
        <CharacterPanel player={snapshot.player} onClose={() => setCharacterOpen(false)} />
      )}
      {gameMenuOpen && (
        <GameMenu
          onResume={() => setGameMenuOpen(false)}
          // Closing the menu first is this file's existing rule: overlays do not
          // stack, they take turns.
          onOptions={() => { setGameMenuOpen(false); setOptionsOpen(true); }}
          onReport={(kind) => { setGameMenuOpen(false); setFeedback(kind); }}
          onExit={onExit}
        />
      )}
      {feedback && <FeedbackDialog kind={feedback} onClose={() => setFeedback(null)} />}
      {optionsOpen && (
        <OptionsPanel
          settings={settings}
          onChange={onSettingsChange ?? (() => {})}
          onClose={() => setOptionsOpen(false)}
          dock={{ bottom: BAR_H, clear: ORB_RISE }}
        />
      )}
      {/* Last in the tree, so it paints over every other overlay: nothing behind
          it is a decision the player can still act on. */}
      {snapshot && !snapshot.player.alive && (
        <DeathScreen
          portalsLeft={snapshot.portalsLeft}
          inMap={snapshot.area === "map" && snapshot.mapOpen}
          onRevive={(where) => {
            workerRef.current?.postMessage({
              type: "intent", intent: { kind: "revive", where },
            } satisfies ToWorker);
            // Every overlay goes with the body: coming back is a fresh screen.
            setPanelOpen(false);
            setInventoryOpen(false);
            setStashOpen(false);
            setVendorOpen(false);
            setCharacterOpen(false);
            setGameMenuOpen(false);
            setOptionsOpen(false);
          }}
        />
      )}
    </div>
  );
}

/**
 * The death screen.
 *
 * PoE2's choice, PoE1's price. You pick where to come back — the checkpoint you
 * came in at, or the hideout — and either answer spends one of the map's six
 * portals, because the map's retry budget is the only thing dying has ever cost
 * in this game. Nothing is spent until a button is pressed, so the screen can sit
 * there as long as he likes.
 *
 * The last portal cannot buy a checkpoint: spending it closes the map, and there
 * is no walking back into a closed map to stand at its door. That is a sim rule
 * (systems/revive.ts) and this only greys the button to say so in advance.
 *
 * No timer, no auto-revive: docs/09 rule 8. The screen after a death is where the
 * player decides whether the run is worth another portal, and taking the decision
 * off him is what turns a loss into an interruption.
 */
function DeathScreen({
  portalsLeft,
  inMap,
  onRevive,
}: {
  portalsLeft: number;
  inMap: boolean;
  onRevive: (where: "checkpoint" | "hideout") => void;
}) {
  const canCheckpoint = inMap && portalsLeft > 1;
  return (
    <div
      data-testid="death-screen"
      role="dialog"
      aria-modal="true"
      aria-label="You have died"
      style={{
        position: "absolute", inset: 0, display: "grid", placeItems: "center",
        // Heavier than the pause menu's veil: the world behind this one is a
        // corpse on the floor, and the screen is not asking to be dismissed.
        background: "rgba(2,2,3,0.82)",
      }}
    >
      {/* Wide enough for its own longest label. The buttons are the widest thing
          in here and they carry the two longest strings in the game. */}
      <FramedPanel style={{ padding: "20px 30px 24px", minWidth: 420 }}>
        <div style={{
          fontFamily: DISPLAY, fontSize: 22, letterSpacing: 5,
          textTransform: "uppercase", color: "#c1443a", textAlign: "center",
        }}>
          You have died
        </div>
        <Divider style={{ margin: "12px 0 14px" }} />
        <div style={{
          fontFamily: SERIF, fontSize: 13, color: "#9a9187",
          textAlign: "center", marginBottom: 16,
        }}>
          {inMap
            ? `${portalsLeft} ${portalsLeft === 1 ? "portal" : "portals"} left in this map`
            : "No map open"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <MenuButton
            tone="primary"
            style={{ width: "100%" }}
            onClick={() => onRevive("checkpoint")}
            disabled={!canCheckpoint}
            autoFocus={canCheckpoint}
          >
            Resurrect at Checkpoint
          </MenuButton>
          <MenuButton
            style={{ width: "100%" }}
            onClick={() => onRevive("hideout")}
            autoFocus={!canCheckpoint}
          >
            Resurrect in Hideout
          </MenuButton>
        </div>
        {inMap && !canCheckpoint && (
          <div style={{
            fontFamily: SERIF, fontSize: 12, color: "#7d7469",
            textAlign: "center", marginTop: 12,
          }}>
            Your last portal closes the map behind you.
          </div>
        )}
      </FramedPanel>
    </div>
  );
}

/**
 * The Escape menu.
 *
 * Small on purpose: the one thing it has to offer is the way out, because
 * without it the game is a door that only opens inwards. Progress is already
 * saved on every durable change (`WorkerCore.maybePersist`), so leaving here
 * costs nothing and needs no confirmation.
 */
function GameMenu({
  onResume,
  onOptions,
  onReport,
  onExit,
}: {
  onResume: () => void;
  onOptions: () => void;
  onReport: (kind: FeedbackKind) => void;
  onExit?: () => void;
}) {
  return (
    <div
      data-testid="game-menu"
      role="dialog"
      aria-modal="true"
      aria-label="Game menu"
      style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(3,4,6,0.7)" }}
    >
      <FramedPanel style={{ padding: "18px 26px 20px", minWidth: 320 }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 18, letterSpacing: 4, textTransform: "uppercase", color: GOLD, textAlign: "center" }}>
          Paused
        </div>
        <Divider style={{ margin: "10px 0 16px" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* No autoFocus: the pause menu opens on Escape, and a white focus ring
              around the first button is the browser answering a question nobody
              asked. Tab still reaches it. */}
          <MenuButton tone="primary" onClick={onResume}>Resume</MenuButton>
          <MenuButton onClick={onOptions}>Options</MenuButton>
          <MenuButton onClick={onExit} disabled={onExit === undefined}>Characters</MenuButton>
        </div>
        <Divider style={{ margin: "16px 0 12px" }} />
        {/* Under the rule and shorter than the three above: these are the way to
            talk back, not two more ways to leave. Full width and stacked, because
            the plate does not shrink its label — side by side, "REPORT A BUG" ran
            straight through the button next to it. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <MenuButton height={34} style={{ width: "100%" }} onClick={() => onReport("bug")}>
            Report a Bug
          </MenuButton>
          <MenuButton height={34} style={{ width: "100%" }} onClick={() => onReport("idea")}>
            Feedback
          </MenuButton>
        </div>
      </FramedPanel>
    </div>
  );
}
