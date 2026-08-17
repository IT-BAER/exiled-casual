/**
 * The asset viewer: every prop, creature and the base body, on a turntable.
 *
 * A dev screen, and only a dev screen. It exists because the game's camera is
 * fixed at a quarter angle above head height, which is the one view that
 * cannot answer whether a mesh clips on the diagonal. Judging art through play
 * meant walking the character around, and the things worth judging are on the
 * side of the model play never shows.
 *
 * The subject list is derived from the gallery's spawnable list, so nothing
 * here has to be updated alongside a prop or creature.
 */
import React from "react";
import {
  createViewerScene,
  CHARACTER_SUBJECT,
  NAKED,
  VIEWER_CLIPS,
  VIEWER_SUBJECTS,
  dressedFromVocabulary,
  type ViewerScene,
} from "../render/viewer-scene";
import type { Looks } from "../render/rig";

const PANEL: React.CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  width: 210,
  overflowY: "auto",
  background: "rgba(10,10,12,0.86)",
  borderColor: "#2b2b31",
  borderStyle: "solid",
  color: "#c8c8d0",
  font: '12px ui-monospace, "Cascadia Mono", monospace',
  padding: "8px 10px",
  zIndex: 2,
};

export function AssetViewer({ onExit }: { onExit: () => void }): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const sceneRef = React.useRef<ViewerScene | null>(null);
  const [subject, setSubject] = React.useState<string>(CHARACTER_SUBJECT.id);
  const [looks, setLooks] = React.useState<Looks>(NAKED);
  const [clip, setClip] = React.useState<string>(VIEWER_CLIPS[0]!.label);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let dead = false;
    void createViewerScene(canvas)
      .then(async (scene) => {
        if (dead || scene === null) { scene?.dispose(); return; }
        sceneRef.current = scene;
        await scene.show(CHARACTER_SUBJECT.id);
        if (dead) return;
        // The vocabulary is only readable once the wardrobe is instantiated, so
        // the opening look is chosen here rather than at construction.
        const dressed = dressedFromVocabulary(scene.vocabulary());
        scene.setLooks(dressed);
        setLooks(dressed);
        setReady(true);
      })
      .catch(() => undefined);
    return () => {
      dead = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  // Subject changes restand the exhibit rather than rebuilding the scene: the
  // wardrobe and the prop packs are one fetch each and re-fetching them per
  // click would make browsing the list unusable.
  const pick = React.useCallback((id: string) => {
    setSubject(id);
    void sceneRef.current?.show(id);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onExit(); return; }
      const entry = VIEWER_CLIPS.find((c) => c.key === e.key);
      if (entry === undefined) return;
      sceneRef.current?.play(entry);
      setClip(entry.label);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const isCharacter = subject === CHARACTER_SUBJECT.id;

  return (
    <div style={{ position: "absolute", inset: 0, background: "#0d0d10" }}>
      <canvas
        ref={canvasRef}
        data-testid="asset-viewer-canvas"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block", outline: "none" }}
      />

      <aside style={{ ...PANEL, left: 0, borderWidth: "0 1px 0 0" }} data-testid="viewer-subjects">
        <Header text="Subject" />
        {VIEWER_SUBJECTS.map((s) => (
          <Row key={s.id} label={s.label} on={s.id === subject} onClick={() => pick(s.id)} />
        ))}
      </aside>

      <div
        style={{
          position: "absolute", left: 220, bottom: 10, zIndex: 2,
          color: "#8a8a95", font: '12px ui-monospace, "Cascadia Mono", monospace',
        }}
      >
        {VIEWER_CLIPS.map((c) => `${c.key} ${c.label}`).join("   ")}
        {isCharacter && <span style={{ color: "#d8b47a" }}>{`   ▸ ${clip}`}</span>}
        {isCharacter && looks.base !== null && (
          <span style={{ color: "#5a5a63" }}>{`   ${looks.base}`}</span>
        )}
        <span style={{ color: "#5a5a63" }}>   drag orbit · wheel zoom · right-drag pan · esc back</span>
        {!ready && <span style={{ color: "#5a5a63" }}>   loading…</span>}
      </div>
    </div>
  );
}

function Header({ text }: { text: string }): React.ReactElement {
  return (
    <div style={{ color: "#d8b47a", letterSpacing: 2, marginBottom: 6 }}>{text.toUpperCase()}</div>
  );
}

function Row(
  { label, on, onClick }: { label: string; on: boolean; onClick: () => void },
): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left",
        padding: "2px 6px", marginBottom: 1, cursor: "pointer",
        background: on ? "#3a2c18" : "transparent",
        color: on ? "#f0cf94" : "#c8c8d0",
        border: "1px solid transparent",
        font: "inherit",
      }}
    >
      {label}
    </button>
  );
}
