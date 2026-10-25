/**
 * The asset viewer: every prop, creature and the character, with every clip
 * they play, on a turntable.
 *
 * A dev screen, and only a dev screen. It exists because the game's camera is
 * fixed at a quarter angle above head height, which is the one view that
 * cannot answer whether a mesh clips on the diagonal. Judging art through play
 * meant walking the character around, and the things worth judging are on the
 * side of the model play never shows.
 *
 * Everything listed is derived (`viewer-catalogue.ts`), so nothing here has to
 * be updated alongside a prop, creature, look, clip or skill. The view lives in
 * the URL, so a link reopens it.
 */
import React from "react";
import {
  createViewerScene,
  dressedFromVocabulary,
  NAKED,
  type SubjectStats,
  type TimelineState,
  type ViewerScene,
  type ViewToggles,
} from "../render/viewer-scene";
import { PET_ACTIONS, type PetAction } from "../render/pet";
import {
  CHARACTER_SUBJECT,
  PET_SUBJECT,
  classPreset,
  DIRECTIONS_8,
  FX_PREVIEWS,
  GAITS,
  ONE_SHOTS,
  parseViewerState,
  VIEWER_SUBJECTS,
  viewerStateQuery,
  type CreatureAction,
  type FxPreview,
  type ViewerCamera,
  type ViewerLight,
} from "../render/viewer-catalogue";
import { SLOTS, type Looks } from "../render/rig";
import { VIEWER_CSS } from "./viewer/theme";
import { SubjectTree } from "./viewer/SubjectTree";
import {
  GAIT_KEYS,
  Inspector,
  SHOT_KEYS,
  TOGGLE_KEYS,
  type DirId,
  type GaitId,
  type SubjectKind,
} from "./viewer/Inspector";
import { Timeline } from "./viewer/Timeline";

function kindOf(id: string): SubjectKind {
  if (id === CHARACTER_SUBJECT.id) return "character";
  if (id === PET_SUBJECT.id) return "pet";
  return VIEWER_SUBJECTS.find((s) => s.id === id)?.group === "Creatures" ? "creature" : "prop";
}

/** The slots that differ from the opening look: all a link has to carry. */
function looksDelta(looks: Looks, base: Looks): Partial<Looks> {
  return Object.fromEntries(SLOTS.filter((s) => looks[s] !== base[s]).map((s) => [s, looks[s]]));
}

export function AssetViewer({ onExit }: { onExit: () => void }): React.ReactElement {
  const initial = React.useRef(parseViewerState(window.location.search)).current;
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const sceneRef = React.useRef<ViewerScene | null>(null);
  const dressedRef = React.useRef<Looks>(NAKED);

  const [ready, setReady] = React.useState(false);
  const [subject, setSubject] = React.useState(initial.subject);
  const [vocab, setVocab] = React.useState<Record<string, string[]>>({});
  const [looks, setLooksState] = React.useState<Looks>(NAKED);
  const [gait, setGait] = React.useState<GaitId>("idle");
  const [dir, setDir] = React.useState<DirId>("f");
  const [creatureAct, setCreatureAct] = React.useState<CreatureAction>("idle");
  const [petAct, setPetAct] = React.useState<PetAction>("hover");
  const [dead, setDead] = React.useState(false);
  const [raw, setRaw] = React.useState<string | null>(null);
  const [rawClips, setRawClips] = React.useState<string[]>([]);
  const [clip, setClip] = React.useState<string | null>(initial.clip);
  const [repeat, setRepeat] = React.useState(false);
  const [light, setLight] = React.useState<ViewerLight>(initial.light);
  const [camera, setCamera] = React.useState<ViewerCamera>(initial.camera);
  const [toggles, setToggles] = React.useState<ViewToggles>({ grid: true, wireframe: false, skeleton: false, turntable: false });
  const [stats, setStats] = React.useState<SubjectStats | null>(null);
  const [timeline, setTimeline] = React.useState<TimelineState | null>(null);
  const [leftOpen, setLeftOpen] = React.useState(true);
  const [rightOpen, setRightOpen] = React.useState(true);

  const kind = kindOf(subject);

  /** Re-run a remembered action: what a link's `clip` says the view was doing. */
  const apply = React.useCallback((code: string | null) => {
    const v = sceneRef.current;
    if (!v || code === null) return;
    const at = code.indexOf(":");
    const verb = at < 0 ? code : code.slice(0, at);
    const arg = at < 0 ? "" : code.slice(at + 1);
    const gaitEntry = GAITS.find((g) => g.id === verb);
    if (gaitEntry) {
      const d = DIRECTIONS_8.find((x) => x.id === arg) ?? DIRECTIONS_8[0];
      v.locomote(gaitEntry.speed, d.rel);
      setGait(gaitEntry.id);
      setDir(d.id);
      setCreatureAct(gaitEntry.id === "walk" ? "walk" : "idle");
      if (kindOf(subjectRef.current) === "creature") void v.creatureAction(gaitEntry.id === "walk" ? "walk" : "idle");
    } else if (verb === "raw") {
      if (v.playRaw(arg)) setRaw(arg);
    } else if (verb === "fx") {
      const fx = FX_PREVIEWS.find((f) => f.skillId === arg);
      if (fx) v.fireFx(fx);
    } else if (verb === "attack") {
      void v.creatureAction("attack");
    } else if (verb === "pet" && (PET_ACTIONS as readonly string[]).includes(arg)) {
      v.petAction(arg as PetAction);
      setPetAct(arg as PetAction);
    } else if (ONE_SHOTS.some((s) => s.id === verb)) {
      v.oneShot(verb);
    }
  }, []);

  const subjectRef = React.useRef(subject);
  subjectRef.current = subject;

  const refreshStats = React.useCallback(() => {
    // One frame later, once the newly enabled parts are drawn.
    requestAnimationFrame(() => setStats(sceneRef.current?.stats() ?? null));
  }, []);

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
        const v = scene.vocabulary();
        const dressed = dressedFromVocabulary(v);
        dressedRef.current = dressed;
        const opening = { ...dressed, ...initial.looks };
        scene.setLooks(opening);
        setVocab(v);
        setLooksState(opening);
        setRawClips(scene.rawClips());
        scene.setLight(initial.light);
        scene.setToggles(toggles);
        if (initial.subject !== CHARACTER_SUBJECT.id) await scene.show(initial.subject);
        scene.setCamera(initial.camera);
        apply(initial.clip);
        setReady(true);
        refreshStats();
        // `__wear("ironsworn")` dresses one family head to foot; `__wear({})`
        // strips him, and any partial `Looks` overrides a slot. `__wear()`
        // answers what the wardrobe ships.
        (window as unknown as { __wear?: unknown }).__wear = (want?: string | Partial<Looks>) => {
          const vocabNow = scene.vocabulary();
          if (want === undefined) return vocabNow;
          const next: Looks = typeof want === "string"
            ? { ...NAKED, base: dressed.base,
                ...Object.fromEntries(Object.entries(vocabNow)
                  .filter(([, ls]) => ls.includes(want))
                  .map(([slot]) => [slot, want])) }
            : { ...dressed, ...want };
          scene.setLooks(next);
          setLooksState(next);
          return next;
        };
      })
      .catch(() => undefined);
    return () => {
      dead = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // Built once per mount: the opening view comes from the URL read above.
  }, []);

  // The timeline is read, not pushed: ten times a second is smooth for a counter
  // and costs nothing next to the render loop.
  React.useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(() => setTimeline(sceneRef.current?.timeline() ?? null), 100);
    return () => window.clearInterval(id);
  }, [ready]);

  // The URL follows the view, so the address bar is always a link back to it.
  React.useEffect(() => {
    if (!ready) return;
    const query = viewerStateQuery({
      subject,
      looks: kind === "character" ? looksDelta(looks, dressedRef.current) : {},
      clip,
      light,
      camera,
    });
    window.history.replaceState(null, "", `?viewer${query ? `&${query}` : ""}`);
  }, [ready, subject, looks, clip, light, camera, kind]);

  const pick = React.useCallback(async (id: string) => {
    const v = sceneRef.current;
    setSubject(id);
    setGait("idle");
    setDir("f");
    setCreatureAct("idle");
    setPetAct("hover");
    setDead(false);
    setRaw(null);
    setClip(null);
    setStats(null);
    if (!v) return;
    await v.show(id);
    v.setCamera(camera);
    refreshStats();
  }, [camera, refreshStats]);

  const dress = (next: Looks) => {
    sceneRef.current?.setLooks(next);
    setLooksState(next);
    refreshStats();
  };

  const motion = (g: GaitId, d: DirId) => {
    setGait(g);
    setDir(d);
    setRaw(null);
    sceneRef.current?.playRaw(null);
    const speed = GAITS.find((x) => x.id === g)!.speed;
    sceneRef.current?.locomote(speed, DIRECTIONS_8.find((x) => x.id === d)!.rel);
    setClip(g === "idle" ? null : `${g}:${d}`);
  };

  const shot = (id: string) => {
    sceneRef.current?.oneShot(id);
    setClip(id);
  };

  const creature = (a: CreatureAction) => {
    const v = sceneRef.current;
    if (!v) return;
    void v.creatureAction(a).then((ok) => { if (a === "death" && ok) setDead(true); });
    if (a === "idle" || a === "walk") { setCreatureAct(a); setClip(a === "walk" ? "walk:f" : null); }
    if (a === "attack") setClip("attack");
  };

  const petDo = (a: PetAction) => {
    sceneRef.current?.petAction(a);
    setPetAct(a);
    setClip(a === "hover" ? null : `pet:${a}`);
  };

  const playRaw = (name: string | null) => {
    if (sceneRef.current?.playRaw(name)) setRaw(name);
    setClip(name === null ? null : `raw:${name}`);
  };

  const fx = (f: FxPreview) => {
    sceneRef.current?.fireFx(f);
    setClip(`fx:${f.skillId}`);
  };

  const capture = async () => {
    const url = await sceneRef.current?.capture();
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `viewer-${subject.replace(/[^a-z0-9]+/gi, "_")}.png`;
    a.click();
  };

  const onToggles = (t: ViewToggles) => {
    sceneRef.current?.setToggles(t);
    setToggles(t);
  };

  // Keys reach the viewer only when no field has focus: typing a search must not cast.
  const keys = React.useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e: KeyboardEvent) => {
    if (e.key === "Escape") { onExit(); return; }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const v = sceneRef.current;
    const k = e.key.toLowerCase();
    const g = (Object.keys(GAIT_KEYS) as GaitId[]).find((id) => GAIT_KEYS[id] === e.key);
    const s = Object.keys(SHOT_KEYS).find((id) => SHOT_KEYS[id] === e.key);
    const toggle = (Object.keys(TOGGLE_KEYS) as (keyof ViewToggles)[]).find((id) => TOGGLE_KEYS[id].toLowerCase() === k);
    if (g && kind === "character") motion(g, dir);
    else if (g && kind === "creature") creature(g === "idle" ? "idle" : "walk");
    else if (s && kind === "character") shot(s);
    else if (e.key === " ") { e.preventDefault(); v?.setPaused(!(timeline?.paused ?? false)); }
    else if (e.key === ",") v?.step(-1);
    else if (e.key === ".") v?.step(1);
    else if (k === "r") { v?.setRepeat(!repeat); setRepeat(!repeat); }
    else if (e.key === "[") setLeftOpen((o) => !o);
    else if (e.key === "]") setRightOpen((o) => !o);
    else if (toggle) onToggles({ ...toggles, [toggle]: !toggles[toggle] });
  };
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="av" data-left={leftOpen} data-right={rightOpen}>
      <style>{VIEWER_CSS}</style>
      <canvas ref={canvasRef} data-testid="asset-viewer-canvas" />
      {!ready && <div className="av-loading">Loading the wardrobe…</div>}

      <SubjectTree subject={subject} onPick={(id) => void pick(id)} hidden={!leftOpen} />

      <Inspector
        hidden={!rightOpen}
        kind={kind}
        vocab={vocab}
        looks={looks}
        onLooks={dress}
        onPreset={(id) => dress({ ...classPreset(id) })}
        gait={gait}
        dir={dir}
        onMotion={motion}
        onShot={shot}
        onCreature={creature}
        creatureAction={creatureAct}
        onPet={petDo}
        petAction={petAct}
        dead={dead}
        onReset={() => void pick(subject)}
        rawClips={rawClips}
        raw={raw}
        onRaw={playRaw}
        repeat={repeat}
        onRepeat={(on) => { sceneRef.current?.setRepeat(on); setRepeat(on); }}
        onFx={fx}
        light={light}
        camera={camera}
        toggles={toggles}
        onLight={(l) => { sceneRef.current?.setLight(l); setLight(l); }}
        onCamera={(c) => { sceneRef.current?.setCamera(c); setCamera(c); }}
        onToggles={onToggles}
        stats={stats}
        onCapture={() => void capture()}
        onClose={onExit}
      />

      <Timeline
        state={timeline}
        repeat={repeat}
        onPause={(p) => sceneRef.current?.setPaused(p)}
        onSeek={(f) => { sceneRef.current?.setPaused(true); sceneRef.current?.seek(f); }}
        onStep={(n) => sceneRef.current?.step(n)}
        onSpeed={(s) => sceneRef.current?.setSpeed(s)}
        onRepeat={(on) => { sceneRef.current?.setRepeat(on); setRepeat(on); }}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onLeft={() => setLeftOpen((o) => !o)}
        onRight={() => setRightOpen((o) => !o)}
      />
    </div>
  );
}
