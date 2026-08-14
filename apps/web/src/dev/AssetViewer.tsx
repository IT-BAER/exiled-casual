/**
 * The asset viewer: every prop, creature and worn look, on a turntable.
 *
 * A dev screen, and only a dev screen. It exists because the game's camera is
 * fixed at a quarter angle above head height, which is the one view that cannot
 * answer whether a pauldron is on both shoulders or a coat clips on the
 * diagonal. Judging art through play meant equipping a drop and walking, and the
 * things worth judging are on the side of the model play never shows.
 *
 * Everything on the panels is derived — subjects from the gallery's spawnable
 * list, looks from the wardrobe's own part names, textures from the gear bake
 * table — so nothing here has to be updated alongside an asset.
 */
import React from "react";
import {
  createViewerScene,
  CHARACTER_SUBJECT,
  VIEWER_CLIPS,
  VIEWER_SUBJECTS,
  type ViewerScene,
} from "../render/viewer-scene";
import {
  COSMETIC_SLOTS,
  GEAR_TEXTURE_BASES,
  type CosmeticSlot,
  type Looks,
} from "../render/rig";

/** Bare, so the first thing seen is the geometry and not a starter outfit. */
const NAKED: Looks = {
  weapon1: null, weapon2: null, helmet: null,
  body: null, gloves: null, boots: null, belt: null,
};

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
  const [vocab, setVocab] = React.useState<Record<string, string[]>>({});
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
        scene.setLooks(NAKED);
        await scene.show(CHARACTER_SUBJECT.id);
        if (dead) return;
        setVocab(scene.vocabulary());
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

  const wear = React.useCallback((slot: CosmeticSlot, look: string | null) => {
    setLooks((prev) => {
      const next = { ...prev, [slot]: look };
      sceneRef.current?.setLooks(next);
      return next;
    });
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

      {isCharacter && (
        <aside style={{ ...PANEL, right: 0, borderWidth: "0 0 0 1px" }} data-testid="viewer-gear">
          <Header text="Gear" />
          {COSMETIC_SLOTS.map((slot) => {
            const options = vocab[slot] ?? [];
            if (options.length === 0) return null;
            const current = looks[slot];
            return (
              <div key={slot} style={{ marginBottom: 10 }}>
                <div style={{ color: "#6f6f7a", letterSpacing: 1 }}>{slot.toUpperCase()}</div>
                <Row label="— none —" on={current === null} onClick={() => wear(slot, null)} />
                {options.map((look) => (
                  <Row
                    key={look}
                    label={look}
                    on={current !== null && current.split("#")[0] === look}
                    onClick={() => wear(slot, look)}
                  />
                ))}
                {current !== null && (
                  <select
                    value={current.split("#")[1] ?? ""}
                    onChange={(e) => {
                      const base = e.target.value;
                      const geo = current.split("#")[0]!;
                      wear(slot, base === "" ? geo : `${geo}#${base}`);
                    }}
                    style={{
                      width: "100%", marginTop: 3, background: "#17171c",
                      color: "#c8c8d0", border: "1px solid #2b2b31", font: "inherit",
                    }}
                  >
                    <option value="">authored texture</option>
                    {GEAR_TEXTURE_BASES.map((b) => (
                      <option key={b} value={b}>{b.replace("base.", "")}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </aside>
      )}

      <div
        style={{
          position: "absolute", left: 220, bottom: 10, zIndex: 2,
          color: "#8a8a95", font: '12px ui-monospace, "Cascadia Mono", monospace',
        }}
      >
        {VIEWER_CLIPS.map((c) => `${c.key} ${c.label}`).join("   ")}
        {isCharacter && <span style={{ color: "#d8b47a" }}>{`   ▸ ${clip}`}</span>}
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
