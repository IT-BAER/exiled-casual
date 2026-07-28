import React, { useEffect, useRef, useState } from "react";
import { Engine, Matrix, Vector3 } from "@babylonjs/core";
import { createScene } from "./render/engine";
import { buildLevel, applyBiomeTint } from "./render/level";
import { SnapshotRenderer } from "./render/renderer";
import { loadProps, resetProps } from "./render/props";
import { loadPlayerRig, resetPlayerRig } from "./render/rig";
import { attachBindings } from "./input/bindings";
import { Hud } from "./hud/Hud";
import { PreparationPanel } from "./hud/PreparationPanel";
import { InventoryPanel } from "./hud/InventoryPanel";
import { CharacterPanel } from "./hud/CharacterPanel";
import { LootLabels } from "./hud/LootLabels";
import { Minimap } from "./hud/Minimap";
import type { Projector } from "./hud/LootLabels";
import type { AreaLayout } from "@exiled/mapgen";
import { BIOMES, mapBase } from "@exiled/content-runtime";
import type { Snapshot, FromWorker, ToWorker } from "@exiled/protocol";

const LAB_SEED = 42;
// ponytail: fixed seed for the lab; M3 will thread seed from game state
const MS_PER_TICK = 1000 / 30;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [hoveredEntityId, setHoveredEntityId] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  // PoE opens the stash beside the inventory, never on its own.
  const [stashOpen, setStashOpen] = useState(false);
  // The bench takes the same left-hand slot as the stash, so one closes the other.
  const [vendorOpen, setVendorOpen] = useState(false);
  const [characterOpen, setCharacterOpen] = useState(false);
  // The map's layout, kept for the minimap. Null in the hideout, which has none.
  const [areaLayout, setAreaLayout] = useState<AreaLayout | null>(null);
  const [project, setProject] = useState<Projector | null>(null);
  const [pick, setPick] = useState<((id: number, x: number, y: number) => void) | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Spawn sim worker
    const worker = new Worker(
      new URL("./worker/sim-worker.ts", import.meta.url),
      { type: "module" },
    );
    workerRef.current = worker;
    worker.postMessage({ type: "init", seed: LAB_SEED });

    let prevSnap: Snapshot | null = null;
    let curSnap: Snapshot | null = null;
    let prevTickTime = performance.now();

    // Babylon engine + render loop
    const engine = new Engine(canvas, true);
    const { scene, camera, detachZoom } = createScene(engine);
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
      // The sim already no-ops activateMap while a run is open; without this the
      // panel still opened, offered stones, and closed itself on the next snapshot.
      (open) => setPanelOpen(open && !curSnap?.mapOpen),
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
        setSnapshot(msg.snapshot);
        // Activation opened the map — the panel's job is done, close it.
        if (msg.snapshot.mapOpen) setPanelOpen(false);
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
        buildLevel(scene, grid, base?.tilesetId);
        applyBiomeTint(scene, base ? BIOMES[base.biomeId].tint : null);
        setAreaLayout(msg.area === "map" ? msg.layout : null);
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
    };

    // Wait for the humanoid and the hideout props before the first frame, so
    // nothing is ever built as a greybox and then swapped for its real asset
    // mid-run. A failed load resolves too and leaves the primitive fallback in
    // place.
    let unmounted = false;
    void Promise.all([loadPlayerRig(scene), loadProps(scene)]).then(() => {
      if (!unmounted) engine.runRenderLoop(renderFrame);
    });

    window.addEventListener("resize", () => engine.resize());

    // i = inventory, c = character sheet. Both render-only; the sim never hears
    // about either, and both can be open at once the way PoE2 has them.
    // Escape clears the screen: every overlay at once, not just the topmost. A player
    // who wants the world back should not have to count the panels they opened.
    const onInvKey = (ev: KeyboardEvent) => {
      const k = ev.key.toLowerCase();
      if (k === "i") { setInventoryOpen((v) => !v); setStashOpen(false); }
      // The sheet is cut from the stash's pane and docks where the stash docks, so
      // the three take turns in that slot. Unconditional: the only way the stash is
      // up when `c` is pressed is if the sheet was already down.
      if (k === "c") { setCharacterOpen((v) => !v); setStashOpen(false); setVendorOpen(false); }
      if (k === "escape") {
        setPanelOpen(false);
        setInventoryOpen(false);
        setStashOpen(false);
        setVendorOpen(false);
        setCharacterOpen(false);
      }
    };
    window.addEventListener("keydown", onInvKey);

    return () => {
      unmounted = true;
      detach();
      detachZoom(); // the canvas outlives the engine, so its listener must go
      window.removeEventListener("keydown", onInvKey);
      resetPlayerRig(); // containers belong to the scene we are about to dispose
      resetProps();
      engine.dispose();
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      <LootLabels snapshot={snapshot} project={project} onPick={pick ?? undefined} />
      <Hud snapshot={snapshot} hoveredEntityId={hoveredEntityId} />
      <Minimap layout={areaLayout} player={snapshot?.player ?? null} />
      {panelOpen && snapshot && (
        <PreparationPanel
          atlasSeed={snapshot.atlasSeed}
          completedNodes={snapshot.completedNodes}
          waystones={snapshot.waystones}
          onClose={() => setPanelOpen(false)}
          onActivate={(atlasNodeId, waystoneId) => {
            workerRef.current?.postMessage({
              type: "intent",
              intent: { kind: "activateMap", atlasNodeId, waystoneId },
            });
            setPanelOpen(false);
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
          onIntent={(intent) => workerRef.current?.postMessage({ type: "intent", intent } satisfies ToWorker)}
          onClose={() => { setInventoryOpen(false); setStashOpen(false); setVendorOpen(false); }}
        />
      )}
      {/* After the inventory so it paints above that panel's backdrop when both are open. */}
      {characterOpen && snapshot && (
        <CharacterPanel player={snapshot.player} onClose={() => setCharacterOpen(false)} />
      )}
    </div>
  );
}
