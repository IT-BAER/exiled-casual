import React, { useEffect, useState } from "react";
import type { Engine, Scene } from "@babylonjs/core";

/** How often the readout refreshes. Twice a second is readable; per-frame is noise. */
const SAMPLE_MS = 500;

/**
 * F3 performance readout. Reads the live engine/scene through refs because both
 * are built inside GameView's mount effect, and samples on an interval rather
 * than per frame: the overlay must never be its own perf drop.
 */
export function DebugStats({
  engineRef,
  sceneRef,
}: {
  engineRef: React.RefObject<Engine | null>;
  sceneRef: React.RefObject<Scene | null>;
}) {
  const [lines, setLines] = useState<string[]>([]);

  useEffect(() => {
    const sample = () => {
      const engine = engineRef.current;
      const scene = sceneRef.current;
      if (!engine || !scene) return;
      // Optional calls: the jsdom test mocks stub only what GameView itself uses.
      const heap = (performance as { memory?: { usedJSHeapSize: number } }).memory;
      setLines([
        `fps        ${(engine.getFps?.() ?? 0).toFixed(0)}`,
        `frame      ${(engine.getDeltaTime?.() ?? 0).toFixed(1)} ms`,
        `meshes     ${scene.getActiveMeshes?.().length ?? 0} active / ${scene.meshes?.length ?? 0} total`,
        `indices    ${(scene.getActiveIndices?.() ?? 0).toLocaleString()} active`,
        `vertices   ${(scene.getTotalVertices?.() ?? 0).toLocaleString()}`,
        `materials  ${scene.materials?.length ?? 0}   textures ${scene.textures?.length ?? 0}`,
        `resolution ${engine.getRenderWidth?.() ?? 0}x${engine.getRenderHeight?.() ?? 0}`,
        ...(heap ? [`js heap    ${(heap.usedJSHeapSize / 1048576).toFixed(0)} MB`] : []),
      ]);
    };
    sample();
    const id = setInterval(sample, SAMPLE_MS);
    return () => clearInterval(id);
  }, [engineRef, sceneRef]);

  return (
    <div
      data-testid="debug-stats"
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        zIndex: 50,
        padding: "6px 10px",
        background: "rgba(0, 0, 0, 0.65)",
        color: "#9f9",
        font: "12px/1.5 Consolas, monospace",
        whiteSpace: "pre",
        pointerEvents: "none",
      }}
    >
      {lines.join("\n")}
    </div>
  );
}
