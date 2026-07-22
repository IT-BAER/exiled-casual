import React, { useEffect, useRef, useState } from "react";
import { Engine, Vector3 } from "@babylonjs/core";
import { createScene } from "./render/engine";
import { buildLevel } from "./render/level";
import { SnapshotRenderer } from "./render/renderer";
import { loadPlayerRig, resetPlayerRig } from "./render/rig";
import { attachBindings } from "./input/bindings";
import { Hud } from "./hud/Hud";
import { PreparationPanel } from "./hud/PreparationPanel";
import type { Snapshot, FromWorker } from "@pact/protocol";

const LAB_SEED = 42;
// ponytail: fixed seed for the lab; M3 will thread seed from game state
const MS_PER_TICK = 1000 / 30;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [hoveredEntityId, setHoveredEntityId] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
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
    const { scene, camera } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    // Bindings need the scene for ground picking, and must be attached before the
    // onmessage handler below so onSnapshot exists when the worker starts sending.
    const { detach, onSnapshot } = attachBindings(
      canvas,
      worker,
      scene,
      () => renderer.cyclePlayerOutfit(),
      (id) => {
        // Both the renderer (mesh highlight) and React (HUD label) must update.
        renderer.setHoveredEntity(id);
        setHoveredEntityId(id);
      },
      () => setPanelOpen(true),
    );

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
        buildLevel(scene, grid);
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

    // Wait for the humanoid before the first frame, so the player is never built
    // as a primitive actor and then swapped for a skinned one mid-run. A failed
    // load resolves too and leaves the primitive fallback in place.
    let unmounted = false;
    void loadPlayerRig(scene).then(() => {
      if (!unmounted) engine.runRenderLoop(renderFrame);
    });

    window.addEventListener("resize", () => engine.resize());

    return () => {
      unmounted = true;
      detach();
      resetPlayerRig(); // containers belong to the scene we are about to dispose
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
      <Hud snapshot={snapshot} hoveredEntityId={hoveredEntityId} />
      {panelOpen && snapshot && (
        <PreparationPanel
          atlasSeed={snapshot.atlasSeed}
          completedNodes={snapshot.completedNodes}
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
    </div>
  );
}
