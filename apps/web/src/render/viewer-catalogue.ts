/**
 * What the asset viewer offers, as data: subjects in groups, the clips a body
 * can be asked for, class presets and the view a URL carries.
 *
 * Kept free of Babylon so it is testable headless. Every list here is derived
 * from what the game already ships (the gallery, the rig's clip table, a class's
 * starting gear), so an asset added to the game appears here unprompted.
 */
import { characterClass, SKILLS } from "@exiled/content-runtime";
import { PROP_KINDS } from "./props";
import { fxProfile } from "./skill-fx";
import { SPAWNABLE, type Spawnable } from "./gallery";
import { looksForEquipment } from "./gear-looks";
import { SLOTS, type Looks, type RigClip, type Slot } from "./rig";

/** What can stand on the turntable. */
export interface ViewerSubject {
  id: string;
  label: string;
  group: Spawnable["group"] | "Character";
}

/** The character is subject zero: it is the reason the screen exists. */
export const CHARACTER_SUBJECT: ViewerSubject = { id: "character", label: "Character", group: "Character" };

/** Everything that can stand on the turntable, flat. */
export const VIEWER_SUBJECTS: readonly ViewerSubject[] = [CHARACTER_SUBJECT, ...SPAWNABLE];

export interface SubjectGroup {
  id: string;
  label: string;
  subjects: ViewerSubject[];
}

/**
 * Where each prop is used, after the comments `PROP_KINDS` is grouped by. A prop
 * missing here still shows, under "Other props", so a new one never hides.
 */
const PROP_GROUP: Partial<Record<(typeof PROP_KINDS)[number], string>> = {
  mapDevice: "Hideout", stash: "Hideout", rug: "Hideout", table: "Hideout", bench: "Hideout",
  pillar: "Hideout", brazier: "Hideout",
  lootChest: "Containers", crate: "Containers", barrel: "Containers",
  driftwood: "Beach", shell: "Beach", coastRock: "Beach", wreckTimber: "Beach", bones: "Beach",
  deadTree: "Desert", skull: "Desert", ribcage: "Desert", ruinWall: "Desert", pot: "Desert",
  beltIronsworn: "Ground drops", beltStalker: "Ground drops", beltEmber: "Ground drops",
  focusEmber: "Ground drops", scrollWisdom: "Ground drops", scrollPortal: "Ground drops",
  orbTransmutation: "Ground drops", orbAugmentation: "Ground drops", orbElevation: "Ground drops",
  orbAlchemy: "Ground drops", orbEmbers: "Ground drops", waystone: "Ground drops", goldPile: "Ground drops",
};

const GROUP_ORDER = ["Character", "Creatures", "Hideout", "Containers", "Beach", "Desert", "Ground drops", "Other props"];

function groupOf(s: ViewerSubject): string {
  if (s.group !== "Props") return s.group;
  return PROP_GROUP[s.id as (typeof PROP_KINDS)[number]] ?? "Other props";
}

/** The sidebar: groups in a fixed order, subjects by label inside each, empty groups left out. */
export const SUBJECT_GROUPS: readonly SubjectGroup[] = GROUP_ORDER
  .map((label) => ({
    id: label.toLowerCase().replace(/\s+/g, "-"),
    label,
    subjects: VIEWER_SUBJECTS.filter((s) => groupOf(s) === label)
      .sort((a, b) => (a === CHARACTER_SUBJECT ? -1 : b === CHARACTER_SUBJECT ? 1 : a.label.localeCompare(b.label))),
  }))
  .filter((g) => g.subjects.length > 0);

/** A clip a body plays once over its gait. Strike cycles its three takes, as play does. */
export interface OneShot {
  id: string;
  label: string;
  clips: RigClip[];
}

export const ONE_SHOTS: readonly OneShot[] = [
  { id: "cast", label: "Cast", clips: ["cast"] },
  { id: "bow", label: "Bow", clips: ["bow"] },
  { id: "strike", label: "Strike", clips: ["strikeA", "strikeB", "strikeC"] },
  { id: "heavy", label: "Heavy Strike", clips: ["heavy"] },
  { id: "slam", label: "Ground Slam", clips: ["slam"] },
  { id: "roll", label: "Roll", clips: ["roll"] },
  { id: "hit", label: "Hit", clips: ["hit"] },
  { id: "drink", label: "Drink", clips: ["drink"] },
  { id: "open", label: "Open", clips: ["open"] },
];

/**
 * Locomotion is a speed and a direction, never a clip name: `setLocomotion` and
 * `setMoveAngle` pick and blend the clip exactly as in play, and the viewer shows
 * which one they picked.
 */
export const GAITS = [
  { id: "idle", label: "Idle", speed: 0 },
  { id: "walk", label: "Walk", speed: 2 },
  { id: "run", label: "Run", speed: 6 },
] as const;

/** Move yaw off the facing: positive is to his right, PI straight back. */
export const DIRECTIONS_8 = [
  { id: "f", label: "Forward", rel: 0 },
  { id: "fr", label: "Forward right", rel: Math.PI / 4 },
  { id: "r", label: "Right", rel: Math.PI / 2 },
  { id: "br", label: "Back right", rel: (Math.PI * 3) / 4 },
  { id: "b", label: "Back", rel: Math.PI },
  { id: "bl", label: "Back left", rel: (-Math.PI * 3) / 4 },
  { id: "l", label: "Left", rel: -Math.PI / 2 },
  { id: "fl", label: "Forward left", rel: -Math.PI / 4 },
] as const;

/** What a creature can be asked to do. Death hands the body to the ragdoll. */
export const CREATURE_ACTIONS = ["idle", "walk", "attack", "death"] as const;
export type CreatureAction = (typeof CREATURE_ACTIONS)[number];

/** How a skill reads on screen, which decides what the viewer spawns for it. */
export type FxKind = "bolt" | "arrow" | "melee" | "ground" | "blink";

export interface FxPreview {
  skillId: string;
  label: string;
  kind: FxKind;
}

const FX_BY_EFFECT: Record<string, FxKind> = {
  spawnProjectile: "bolt",
  meleeStrike: "melee",
  spawnGroundArea: "ground",
  teleport: "blink",
};

/** Every skill that draws an effect, by its first effect; an arrow profile turns a bolt into an arrow. */
export const FX_PREVIEWS: readonly FxPreview[] = [...SKILLS.values()].flatMap((skill) => {
  const kind = FX_BY_EFFECT[skill.effects[0]?.type ?? ""];
  if (kind === undefined) return [];
  return [{ skillId: skill.id, label: skill.name, kind: kind === "bolt" && fxProfile(skill.id).arrow ? "arrow" : kind }];
});

/** A class head to foot, through the same base -> look table play dresses from. */
export function classPreset(classId: string): Looks {
  const { startingGear: gear, body } = characterClass(classId);
  return looksForEquipment(Object.fromEntries(Object.entries(gear).map(([slot, baseId]) => [slot, { baseId }])), body);
}

/** "Rig|Dance_Loop" -> "Dance Loop". */
export function rawClipLabel(name: string): string {
  return name.replace(/^[^|]*\|/, "").replace(/_/g, " ");
}

/**
 * The group a timeline should show: a one-shot over the locomotion under it.
 * Layered clips and the roll sit at `playOrder` 1 (see `retarget` in rig.ts).
 */
export function mainGroup<G extends { isPlaying: boolean; playOrder: number }>(groups: readonly G[]): G | null {
  const playing = groups.filter((g) => g.isPlaying);
  return playing.find((g) => g.playOrder > 0) ?? playing[0] ?? null;
}

export const LIGHTS = ["workshop", "game"] as const;
export type ViewerLight = (typeof LIGHTS)[number];
export const CAMERAS = ["free", "front", "side", "back", "top", "game"] as const;
export type ViewerCamera = (typeof CAMERAS)[number];

/** Everything a link has to carry to reopen a view. */
export interface ViewerState {
  subject: string;
  /** Overrides on the opening look; null empties a slot. */
  looks: Partial<Looks>;
  clip: string | null;
  light: ViewerLight;
  camera: ViewerCamera;
}

export const DEFAULT_VIEWER_STATE: ViewerState = {
  subject: CHARACTER_SUBJECT.id,
  looks: {},
  clip: null,
  light: "workshop",
  camera: "free",
};

const NONE = "none";

export function parseViewerState(search: string): ViewerState {
  const q = new URLSearchParams(search);
  const looks: Partial<Looks> = {};
  for (const pair of (q.get("looks") ?? "").split(",")) {
    const [slot, look] = pair.split(":");
    if (!slot || look === undefined || !(SLOTS as readonly string[]).includes(slot)) continue;
    looks[slot as Slot] = look === NONE ? null : look;
  }
  const subject = q.get("subject");
  const light = q.get("light");
  const camera = q.get("camera");
  return {
    subject: subject && VIEWER_SUBJECTS.some((s) => s.id === subject) ? subject : DEFAULT_VIEWER_STATE.subject,
    looks,
    clip: q.get("clip") || null,
    light: (LIGHTS as readonly string[]).includes(light ?? "") ? (light as ViewerLight) : DEFAULT_VIEWER_STATE.light,
    camera: (CAMERAS as readonly string[]).includes(camera ?? "") ? (camera as ViewerCamera) : DEFAULT_VIEWER_STATE.camera,
  };
}

/** The query after `?viewer&`, defaults left out so a plain view stays a plain link. */
export function viewerStateQuery(state: ViewerState): string {
  const q = new URLSearchParams();
  if (state.subject !== DEFAULT_VIEWER_STATE.subject) q.set("subject", state.subject);
  const looks = Object.entries(state.looks).map(([slot, look]) => `${slot}:${look ?? NONE}`);
  if (looks.length > 0) q.set("looks", looks.join(","));
  if (state.clip !== null) q.set("clip", state.clip);
  if (state.light !== DEFAULT_VIEWER_STATE.light) q.set("light", state.light);
  if (state.camera !== DEFAULT_VIEWER_STATE.camera) q.set("camera", state.camera);
  return q.toString().replace(/%3A/g, ":").replace(/%2C/g, ",");
}
