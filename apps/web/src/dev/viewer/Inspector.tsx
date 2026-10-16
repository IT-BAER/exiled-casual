import React from "react";
import { CLASS_LIST } from "@exiled/content-runtime";
import { BASE_LOOKS, SLOTS, type Looks, type Slot } from "../../render/rig";
import {
  CAMERAS,
  CREATURE_ACTIONS,
  DIRECTIONS_8,
  FX_PREVIEWS,
  GAITS,
  LIGHTS,
  ONE_SHOTS,
  rawClipLabel,
  type CreatureAction,
  type FxPreview,
  type ViewerCamera,
  type ViewerLight,
} from "../../render/viewer-catalogue";
import type { SubjectStats, ViewToggles } from "../../render/viewer-scene";
import { Icon } from "./icons";

export type SubjectKind = "character" | "creature" | "prop";
export type GaitId = (typeof GAITS)[number]["id"];
export type DirId = (typeof DIRECTIONS_8)[number]["id"];

/** Hotkeys the shell binds; listed here so the buttons can show them. */
export const SHOT_KEYS: Record<string, string> = { cast: "4", bow: "5", strike: "6", roll: "7", hit: "8", drink: "9", open: "0" };
export const GAIT_KEYS: Record<GaitId, string> = { idle: "1", walk: "2", run: "3" };
export const TOGGLE_KEYS: Record<keyof ViewToggles, string> = { grid: "G", wireframe: "W", skeleton: "B", turntable: "T" };

const SLOT_LABEL: Record<Slot, string> = {
  base: "body", helmet: "helmet", chest: "chest", gloves: "gloves", boots: "boots", weapon1: "main hand", weapon2: "off hand",
};

/** The dial's 3x3 cells; null is the hub. */
const DIAL: (DirId | null)[] = ["fl", "f", "fr", "l", null, "r", "bl", "b", "br"];
const DIAL_GLYPH: Record<DirId, string> = { f: "F", fr: "FR", r: "R", br: "BR", b: "B", bl: "BL", l: "L", fl: "FL" };

const FX_KIND_LABEL: Record<FxPreview["kind"], string> = {
  bolt: "Spells", arrow: "Arrows", melee: "Melee", ground: "Ground", blink: "Movement",
};

export interface InspectorProps {
  hidden: boolean;
  kind: SubjectKind;
  vocab: Record<string, string[]>;
  looks: Looks;
  onLooks: (looks: Looks) => void;
  onPreset: (classId: string) => void;
  gait: GaitId;
  dir: DirId;
  onMotion: (gait: GaitId, dir: DirId) => void;
  onShot: (id: string) => void;
  onCreature: (action: CreatureAction) => void;
  creatureAction: CreatureAction;
  dead: boolean;
  onReset: () => void;
  rawClips: string[];
  raw: string | null;
  onRaw: (name: string | null) => void;
  onFx: (fx: FxPreview) => void;
  light: ViewerLight;
  camera: ViewerCamera;
  toggles: ViewToggles;
  onLight: (light: ViewerLight) => void;
  onCamera: (camera: ViewerCamera) => void;
  onToggles: (toggles: ViewToggles) => void;
  stats: SubjectStats | null;
  onCapture: () => void;
  onClose: () => void;
}

export function Inspector(p: InspectorProps): React.ReactElement {
  return (
    <aside className="av-panel av-right" data-hidden={p.hidden} aria-label="Inspector">
      <div className="av-head">
        <span className="av-title">Inspector</span>
        <button type="button" className="av-icon" onClick={p.onCapture} title="Save a PNG of this frame" aria-label="Save a PNG of this frame">
          <Icon name="camera" />
        </button>
        <button type="button" className="av-icon" onClick={p.onClose} title="Back to the menu (Esc)" aria-label="Back to the menu">
          <Icon name="close" />
        </button>
      </div>
      <div className="av-scroll" style={{ padding: 0 }}>
        {p.kind === "character" && <CharacterSections {...p} />}
        {p.kind === "creature" && <CreatureSection {...p} />}
        <ViewSection {...p} />
        <StatsSection stats={p.stats} />
      </div>
    </aside>
  );
}

function CharacterSections(p: InspectorProps): React.ReactElement {
  const [rawQuery, setRawQuery] = React.useState("");
  const rq = rawQuery.trim().toLowerCase();
  const raws = p.rawClips.filter((n) => rq === "" || rawClipLabel(n).toLowerCase().includes(rq));
  const fxKinds = [...new Set(FX_PREVIEWS.map((f) => f.kind))];

  return (
    <>
      <section className="av-section">
        <h3 className="av-h">Class</h3>
        <div className="av-chips">
          {CLASS_LIST.map((c) => (
            <button key={c.id} type="button" className="av-chip" onClick={() => p.onPreset(c.id)}>{c.name}</button>
          ))}
        </div>
      </section>

      <section className="av-section">
        <h3 className="av-h">Looks</h3>
        {SLOTS.map((slot) => {
          const options = p.vocab[slot] ?? [];
          return (
            <div className="av-field" key={slot}>
              <label htmlFor={`av-look-${slot}`}>{SLOT_LABEL[slot]}</label>
              <select id={`av-look-${slot}`} className="av-select" value={p.looks[slot] ?? ""}
                onChange={(e) => p.onLooks({ ...p.looks, [slot]: e.target.value === "" ? null : e.target.value })}>
                <option value="">None</option>
                {options.map((look) => {
                  // Only the male skeleton is indexed by the rig (`indexRigSubtree`).
                  const unwired = slot === "base" && look !== BASE_LOOKS.base;
                  return <option key={look} value={look} disabled={unwired}>{unwired ? `${look} (unwired)` : look}</option>;
                })}
              </select>
            </div>
          );
        })}
      </section>

      <section className="av-section">
        <h3 className="av-h">Motion <small>keys 1 to 3</small></h3>
        <div className="av-motion">
          <div className="av-seg av-seg-v" role="group" aria-label="Gait">
            {GAITS.map((g) => (
              <button key={g.id} type="button" className="av-chip" aria-pressed={p.gait === g.id}
                onClick={() => p.onMotion(g.id, p.dir)}>
                {g.label} <kbd>{GAIT_KEYS[g.id]}</kbd>
              </button>
            ))}
          </div>
          <div className="av-dial" role="group" aria-label="Direction">
            {DIAL.map((id, i) => id === null
              ? <div key={i} className="av-dial-hub">facing</div>
              : (
                <button key={id} type="button" className="av-chip" aria-pressed={p.dir === id}
                  disabled={p.gait === "idle"} title={DIRECTIONS_8.find((d) => d.id === id)!.label}
                  onClick={() => p.onMotion(p.gait, id)}>
                  {DIAL_GLYPH[id]}
                </button>
              ))}
          </div>
        </div>
        <p className="av-note">Speed and direction go through the game's own blend, as in play.</p>
      </section>

      <section className="av-section">
        <h3 className="av-h">Actions <small>keys 4 to 0</small></h3>
        <div className="av-chips">
          {ONE_SHOTS.map((s) => (
            <button key={s.id} type="button" className="av-chip" onClick={() => p.onShot(s.id)}>
              {s.label} <kbd>{SHOT_KEYS[s.id]}</kbd>
            </button>
          ))}
        </div>
      </section>

      <section className="av-section">
        <h3 className="av-h">Skill effects</h3>
        {fxKinds.map((kind) => (
          <div key={kind} style={{ marginBottom: 8 }}>
            <div className="av-note" style={{ margin: "0 0 6px" }}>{FX_KIND_LABEL[kind]}</div>
            <div className="av-chips">
              {FX_PREVIEWS.filter((f) => f.kind === kind).map((f) => (
                <button key={f.skillId} type="button" className="av-chip" onClick={() => p.onFx(f)}>{f.label}</button>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="av-section">
        <h3 className="av-h">Library takes <small>{p.rawClips.length}</small></h3>
        <div className="av-search" style={{ margin: 0 }}>
          <Icon name="search" size={14} />
          <input className="av-input" type="search" placeholder="Find a take" value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)} aria-label="Find a library take" />
        </div>
        <div className="av-list">
          {raws.length === 0 && <div className="av-empty">No take matches.</div>}
          {raws.map((name) => (
            <button key={name} type="button" className="av-row" aria-current={p.raw === name}
              onClick={() => p.onRaw(p.raw === name ? null : name)}>
              {rawClipLabel(name)}
            </button>
          ))}
        </div>
        <p className="av-note">
          {p.raw !== null
            ? <><b>Raw:</b> the take as authored, without the game's layering or pacing. Click it again to stop.</>
            : "Every take in anim-library.glb, played as authored. The game may layer or pace it differently."}
        </p>
      </section>
    </>
  );
}

function CreatureSection(p: InspectorProps): React.ReactElement {
  const label: Record<CreatureAction, string> = { idle: "Idle", walk: "Walk", attack: "Attack", death: "Die" };
  return (
    <section className="av-section">
      <h3 className="av-h">Actions</h3>
      <div className="av-chips">
        {CREATURE_ACTIONS.map((a) => (
          <button key={a} type="button" className={`av-chip${a === "death" ? " av-danger" : ""}`}
            aria-pressed={!p.dead && (a === "idle" || a === "walk") && p.creatureAction === a}
            disabled={p.dead} onClick={() => p.onCreature(a)}>
            {label[a]}
          </button>
        ))}
        {p.dead && <button type="button" className="av-chip" onClick={p.onReset}>Stand up again</button>}
      </div>
      <p className="av-note">
        {p.dead ? "The body is the ragdoll's now, as in play." : "Attack plays the swing the sim's attack tick starts. Die drops it through the ragdoll."}
      </p>
    </section>
  );
}

function ViewSection(p: InspectorProps): React.ReactElement {
  const camLabel: Record<ViewerCamera, string> = { free: "Free", front: "Front", side: "Side", back: "Back", top: "Top", game: "Game" };
  return (
    <section className="av-section">
      <h3 className="av-h">View</h3>
      <div className="av-field">
        <label>Light</label>
        <div className="av-seg" role="group" aria-label="Light">
          {LIGHTS.map((l) => (
            <button key={l} type="button" className="av-chip" aria-pressed={p.light === l} onClick={() => p.onLight(l)}>
              {l === "game" ? "In game" : "Workshop"}
            </button>
          ))}
        </div>
      </div>
      <div className="av-chips" role="group" aria-label="Camera" style={{ marginTop: 8 }}>
        {CAMERAS.map((c) => (
          <button key={c} type="button" className="av-chip" aria-pressed={p.camera === c} onClick={() => p.onCamera(c)}>
            {camLabel[c]}
          </button>
        ))}
      </div>
      <div className="av-toggles">
        {(Object.keys(TOGGLE_KEYS) as (keyof ViewToggles)[]).map((k) => (
          <label key={k} className="av-check">
            <input type="checkbox" checked={p.toggles[k]} onChange={(e) => p.onToggles({ ...p.toggles, [k]: e.target.checked })} />
            {k === "grid" ? "Floor" : k === "turntable" ? "Turntable" : k === "skeleton" ? "Bones" : "Wireframe"}
            <kbd>{TOGGLE_KEYS[k]}</kbd>
          </label>
        ))}
      </div>
    </section>
  );
}

function StatsSection({ stats }: { stats: SubjectStats | null }): React.ReactElement {
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <section className="av-section">
      <h3 className="av-h">Mesh</h3>
      {stats === null ? <div className="av-note">Loading…</div> : (
        <div className="av-stats">
          <div className="av-stat"><span>Triangles</span><span>{fmt(stats.triangles)}</span></div>
          <div className="av-stat"><span>Meshes</span><span>{fmt(stats.meshes)}</span></div>
          <div className="av-stat"><span>Materials</span><span>{fmt(stats.materials)}</span></div>
          <div className="av-stat"><span>Bones</span><span>{fmt(stats.bones)}</span></div>
        </div>
      )}
    </section>
  );
}
