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
  dressedFromVocabulary,
  CHARACTER_SUBJECT,
  NAKED,
  VIEWER_CLIPS,
  VIEWER_SUBJECTS,
  type ViewerScene,
} from "../render/viewer-scene";
import {
  COSMETIC_SLOTS,
  looksForEquipment,
  meshLook,
  type CosmeticSlot,
  type Looks,
} from "../render/rig";
import { basesForSlot, orphanLooks } from "./bases";

/**
 * What one slot is showing: a real item base, a bare wardrobe look, or nothing.
 *
 * The two are not the same question. A base is what a player can hold — it picks
 * the geometry AND the palette its inventory icon was painted with, and it goes
 * through `looksForEquipment` so what stands here is exactly what a drop would
 * put on him. A bare look is the geometry with the outfit's authored texture,
 * which is the only way to see a look no base points at yet.
 */
type Worn = { kind: "base"; baseId: string } | { kind: "look"; look: string } | null;

/** Compose the wardrobe's `Looks` from the panel's per-slot choices. */
export function looksFor(worn: Partial<Record<CosmeticSlot, Worn>>): Looks {
  const equipped: Partial<Record<CosmeticSlot, { baseId: string }>> = {};
  for (const slot of COSMETIC_SLOTS) {
    const w = worn[slot];
    if (w?.kind === "base") equipped[slot] = { baseId: w.baseId };
  }
  // The game's own resolution first, so a base looks here exactly as it looks in
  // play, then the bare looks laid over the slots that chose one.
  //
  // An empty slot is what the GAME shows for an empty slot, which is commoner
  // cloth on the body and boots. Forcing it to null instead emptied the body
  // slot of the torso, the arms and the legs as well - they are looks of that
  // slot, not a base mesh - so clearing every slot left a head hanging in the
  // dark. There is no naked body in this wardrobe to fall back to.
  const out = looksForEquipment(equipped);
  for (const slot of COSMETIC_SLOTS) {
    const w = worn[slot];
    if (w?.kind === "look") out[slot] = w.look;
  }
  return out;
}

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
  const [worn, setWorn] = React.useState<Partial<Record<CosmeticSlot, Worn>>>({});
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
        await scene.show(CHARACTER_SUBJECT.id);
        if (dead) return;
        // The vocabulary is only readable once the wardrobe is instantiated, so
        // the opening outfit is chosen here rather than at construction.
        const found = scene.vocabulary();
        const dressed = dressedFromVocabulary(found);
        scene.setLooks(dressed);
        setVocab(found);
        setLooks(dressed);
        setWorn(
          Object.fromEntries(
            COSMETIC_SLOTS.map((s) => {
              const look = dressed[s];
              return [s, look === null ? null : { kind: "look" as const, look }];
            }),
          ),
        );
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

  const wear = React.useCallback((slot: CosmeticSlot, choice: Worn) => {
    setWorn((prev) => {
      const next = { ...prev, [slot]: choice };
      const composed = looksFor(next);
      sceneRef.current?.setLooks(composed);
      setLooks(composed);
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
            const bases = basesForSlot(slot);
            const options = orphanLooks(slot, vocab[slot] ?? []);
            if (bases.length === 0 && options.length === 0) return null;
            const chosen = worn[slot] ?? null;
            const current = looks[slot];
            return (
              <div key={slot} style={{ marginBottom: 12 }}>
                <div style={{ color: "#6f6f7a", letterSpacing: 1 }}>{slot.toUpperCase()}</div>
                <Row label="— none —" on={chosen === null} onClick={() => wear(slot, null)} />
                {bases.map((b) => (
                  <Row
                    key={b.id}
                    label={b.name}
                    on={chosen?.kind === "base" && chosen.baseId === b.id}
                    onClick={() => wear(slot, { kind: "base", baseId: b.id })}
                  />
                ))}
                {/* Only what no base can reach — see `orphanLooks`. */}
                {options.length > 0 && (
                  <div style={{ color: "#4e4e57", marginTop: 3 }}>unworn looks</div>
                )}
                {options.map((look) => (
                  <Row
                    key={look}
                    label={look}
                    on={chosen?.kind === "look" && meshLook(chosen.look) === look}
                    onClick={() => wear(slot, { kind: "look", look })}
                    dim
                  />
                ))}
                {current !== null && current.includes("#") && (
                  <div style={{ color: "#4e4e57" }}>{`↳ ${current}`}</div>
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
  { label, on, onClick, dim }: { label: string; on: boolean; onClick: () => void; dim?: boolean },
): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "block", width: "100%", textAlign: "left",
        padding: "2px 6px", marginBottom: 1, cursor: "pointer",
        background: on ? "#3a2c18" : "transparent",
        color: on ? "#f0cf94" : dim === true ? "#7e7e88" : "#c8c8d0",
        border: "1px solid transparent",
        font: "inherit",
      }}
    >
      {label}
    </button>
  );
}
