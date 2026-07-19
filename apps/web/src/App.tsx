import React, { useEffect, useRef, useState } from "react";
import { Engine, Vector3 } from "@babylonjs/core";
import { createScene } from "./render/engine";
import { SnapshotRenderer } from "./render/renderer";
import { attachBindings } from "./input/bindings";
import { Hud } from "./hud/Hud";
import type { Snapshot, FromWorker } from "@pact/protocol";

const LAB_SEED = 42;
// ponytail: fixed seed for the lab; M3 will thread seed from game state
const MS_PER_TICK = 1000 / 30;

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Spawn sim worker
    const worker = new Worker(
      new URL("./worker/sim-worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.postMessage({ type: "init", seed: LAB_SEED });

    let prevSnap: Snapshot | null = null;
    let curSnap: Snapshot | null = null;
    let prevTickTime = performance.now();

    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const msg = e.data;
      if (msg.type === "snapshot") {
        prevSnap = curSnap;
        curSnap = msg.snapshot;
        prevTickTime = performance.now();
        setSnapshot(msg.snapshot);
      }
    };

    // Babylon engine + render loop
    const engine = new Engine(canvas, true);
    const { scene, camera } = createScene(engine);
    const renderer = new SnapshotRenderer(scene);

    engine.runRenderLoop(() => {
      if (!curSnap) return;
      // ponytail: float alpha for lerp — never fed into sim
      const alpha = Math.min(1, (performance.now() - prevTickTime) / MS_PER_TICK);
      renderer.apply(prevSnap, curSnap, alpha);
      // Camera follows the player (interpolated) so they stay centred like an ARPG.
      const p = curSnap.player;
      const pp = prevSnap?.player ?? p;
      camera.setTarget(
        new Vector3(pp.x + (p.x - pp.x) * alpha, 0, pp.y + (p.y - pp.y) * alpha),
      );
      scene.render();
    });

    window.addEventListener("resize", () => engine.resize());

    // Input bindings (keydown, pointermove, click)
    const detach = attachBindings(canvas, worker, scene);

    return () => {
      detach();
      engine.dispose();
      worker.terminate();
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: "100%", display: "block" }}
      />
      <Hud snapshot={snapshot} />
    </div>
  );
}
