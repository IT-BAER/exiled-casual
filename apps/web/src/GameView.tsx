import React, { useEffect, useRef, useState } from "react";
import { Engine, Matrix, Vector3 } from "@babylonjs/core";
import type { Scene } from "@babylonjs/core";
import { applyGraphics, createScene } from "./render/engine";
import { buildLevel, applyBiomeTint, applyTilesetFloor } from "./render/level";
import { SnapshotRenderer } from "./render/renderer";
import { loadProps, resetProps } from "./render/props";
import { loadMonsters, resetMonsters } from "./render/monsters";
import { loadRocks, resetRocks } from "./render/rocks";
import { loadPlayerRig, resetPlayerRig } from "./render/rig";
import { attachBindings } from "./input/bindings";
import { CORE_SFX, playSfx, preloadSfx } from "./audio/sfx";
import { createSoundscape } from "./audio/soundscape";
import { Hud, BAR_H, ORB_RISE } from "./hud/Hud";
import { PreparationPanel } from "./hud/PreparationPanel";
import { InventoryPanel } from "./hud/InventoryPanel";
import { CharacterPanel } from "./hud/CharacterPanel";
import { LootLabels } from "./hud/LootLabels";
import { Minimap } from "./hud/Minimap";
import { Divider, FramedPanel, GOLD, MenuButton, SERIF } from "./menu/frames";
import { LoadingScreen, LOADING_ART, FADE_MS } from "./LoadingScreen";
import { pickTip } from "./tips";
import { OptionsPanel } from "./menu/OptionsPanel";
import { DEFAULT_SETTINGS, type Settings } from "./settings";
import type { Projector } from "./hud/LootLabels";
import type { AreaLayout } from "@exiled/mapgen";
import { BIOMES, mapBase } from "@exiled/content-runtime";
import type { Snapshot, FromWorker, ToWorker } from "@exiled/protocol";

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
  const [optionsOpen, setOptionsOpen] = useState(false);
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
  // The map's layout, kept for the minimap. Null in the hideout, which has none.
  const [areaLayout, setAreaLayout] = useState<AreaLayout | null>(null);
  const [project, setProject] = useState<Projector | null>(null);
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
    const engine = new Engine(canvas, true);
    const { scene, camera, detachZoom } = createScene(engine);
    sceneRef.current = scene;
    engineRef.current = engine;
    const renderer = new SnapshotRenderer(scene);

    // Ground-item name plates live in the DOM, so they need the camera's
    // world -> canvas projection. Sim (x, y) maps to world (x, z).
    setProject(() => (x: number, y: number) => {
      const p = Vector3.Project(
        new Vector3(x, 0, y),
        Matrix.Identity(),
        scene.getTransformMatrix(),
        camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
      );
      return { x: p.x, y: p.y, visible: p.z > 0 && p.z < 1 };
    });

    // Bindings need the scene for ground picking, and must be attached before the
    // onmessage handler below so onSnapshot exists when the worker starts sending.
    const { detach, onSnapshot, approach } = attachBindings(
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
    );

    // Loot plates are DOM, so their click has to reach the same approach-then-act
    // path the canvas picker uses for portals and devices.
    setPick(() => approach);

    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      if (msg.type === "snapshot") {
        prevSnap = curSnap;
        curSnap = msg.snapshot;
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
      } else if (msg.type === "area") {
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
        soundscape.reset();
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
        applyTilesetFloor(scene, base?.tilesetId ?? null);
        applyBiomeTint(scene, base ? BIOMES[base.biomeId].tint : null);
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
      if (needsPaint) {
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
    });

    window.addEventListener("resize", () => engine.resize());

    // i = inventory, c = character sheet. Both render-only; the sim never hears
    // about either, and both can be open at once the way PoE2 has them.
    // Escape clears the screen: every overlay at once, not just the topmost. A player
    // who wants the world back should not have to count the panels they opened.
    const onInvKey = (ev: KeyboardEvent) => {
      if (deadRef.current) return;
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
      resetMonsters();
      resetRocks();
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
        onPick={pick ?? undefined}
        plates={settings.ui.lootLabels}
      />
      <Hud snapshot={snapshot} hoveredEntityId={hoveredEntityId} />
      {settings.ui.minimap && (
        <Minimap layout={areaLayout} player={snapshot?.player ?? null} />
      )}
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
          onExit={onExit}
        />
      )}
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
      <FramedPanel style={{ padding: "20px 30px 24px", minWidth: 360 }}>
        <div style={{
          fontFamily: SERIF, fontSize: 22, letterSpacing: 5,
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
            onClick={() => onRevive("checkpoint")}
            disabled={!canCheckpoint}
            autoFocus={canCheckpoint}
          >
            Resurrect at Checkpoint
          </MenuButton>
          <MenuButton onClick={() => onRevive("hideout")} autoFocus={!canCheckpoint}>
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
  onExit,
}: {
  onResume: () => void;
  onOptions: () => void;
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
        <div style={{ fontFamily: SERIF, fontSize: 18, letterSpacing: 4, textTransform: "uppercase", color: GOLD, textAlign: "center" }}>
          Paused
        </div>
        <Divider style={{ margin: "10px 0 16px" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <MenuButton tone="primary" onClick={onResume} autoFocus>Resume</MenuButton>
          <MenuButton onClick={onOptions}>Options</MenuButton>
          <MenuButton onClick={onExit} disabled={onExit === undefined}>Characters</MenuButton>
        </div>
      </FramedPanel>
    </div>
  );
}
