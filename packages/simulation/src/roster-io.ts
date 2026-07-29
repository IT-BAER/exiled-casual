/**
 * Reading and writing the roster, without ever building a world.
 *
 * Split from `characters.ts` on purpose. The menu has to list characters,
 * create one and migrate an old save before any simulation exists, and it runs
 * on the main thread where the sim does not belong. Everything here imports
 * types from `./persist` and values from nowhere heavier than `@exiled/rules`,
 * so a bundler can give the menu this file without dragging the ECS, the
 * systems and the combat sim in behind it.
 *
 * Two versions are in play and they are not the same number:
 *
 * - `persist.VERSION` (2) versions ONE character's save. Its shape has not
 *   changed, so it does not move.
 * - `ROSTER_VERSION` (3) versions the blob that now wraps those saves.
 *
 * The stash is the one field that moved: it used to sit inside the single save
 * and now sits on the roster, shared by every character the way PoE shares a
 * stash account-wide. `migrateSingleSave` hoists it.
 */
import {
  ROSTER_VERSION,
  asRoster,
  emptyRoster,
  readBlob,
  type CharacterRecord,
  type KvStore,
  type RosterBlob,
} from "@exiled/persistence";
import { DEFAULT_CLASS_ID, START_LEVEL, classIdOr } from "@exiled/rules";
import type { PersistedState } from "./persist";

/** League every locally-saved character belongs to. Online brings real ones. */
export const LOCAL_LEAGUE = "Local";

/**
 * The id the one pre-roster save becomes.
 *
 * Fixed rather than random so migrating twice cannot produce two characters,
 * and so a test can name the row it expects.
 */
export const MIGRATED_CHARACTER_ID = "migrated-1";

/** The name that save is given. It never had one; it was the only character there was. */
export const MIGRATED_CHARACTER_NAME = "Exile";

/** A character as the create screen describes it, before it has a save. */
export interface NewCharacter {
  name: string;
  classId: string;
  league?: string;
}

/**
 * A fresh record. `state` is null: nothing has been simulated yet, and writing a
 * starting world here would mean this file could build one, which is the sim's
 * job. `loadCharacterInto` dresses the world instead, on first play.
 */
export function makeCharacterRecord(
  input: NewCharacter,
  id: string,
  now: number,
): CharacterRecord {
  return {
    id,
    name: input.name.trim(),
    classId: classIdOr(input.classId),
    level: START_LEVEL,
    league: input.league ?? LOCAL_LEAGUE,
    createdAt: now,
    state: null,
  };
}

/**
 * Turn the one pre-roster save into a one-character roster.
 *
 * This is the first migration the project has ever had and it runs against a
 * real save on someone's machine, so it is deliberately narrow: only a
 * `version: 2` blob is understood. Anything older still falls back to a fresh
 * roster, which is the discard behaviour `loadInto` has always had and which the
 * accounts design doc keeps as the final fallback.
 *
 * Returns null when `blob` is not a v2 save.
 */
export function migrateSingleSave(blob: unknown, now: number): RosterBlob | null {
  if (typeof blob !== "object" || blob === null) return null;
  const b = blob as Partial<PersistedState>;
  if (b.version !== 2 || b.session === undefined || b.inventory === undefined) return null;
  // The stash leaves the character and becomes the roster's.
  const { stash, ...state } = b as PersistedState;
  return {
    version: ROSTER_VERSION,
    characters: [
      {
        id: MIGRATED_CHARACTER_ID,
        name: MIGRATED_CHARACTER_NAME,
        classId: DEFAULT_CLASS_ID,
        level: b.progress?.level ?? START_LEVEL,
        league: LOCAL_LEAGUE,
        createdAt: now,
        state,
      },
    ],
    ...(stash === undefined ? {} : { stash }),
    lastPlayedId: MIGRATED_CHARACTER_ID,
  };
}

/**
 * The roster to work with: the saved one, the migrated one, or an empty one.
 * Never throws and never returns null — boot has to produce a menu either way.
 */
export async function openRoster(kv: KvStore, now: number = Date.now()): Promise<RosterBlob> {
  const blob = await readBlob(kv);
  return asRoster(blob) ?? migrateSingleSave(blob, now) ?? emptyRoster();
}
