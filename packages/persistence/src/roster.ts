/**
 * The character roster: which characters exist, and the opaque save each owns.
 *
 * Until now the whole game was one blob and one implicit character. A character
 * select screen needs a list, so the blob grows a level: the roster holds a
 * record per character, plus the shared stash, and each record carries that
 * character's save as an OPAQUE `state`.
 *
 * Opaque is the point. `@exiled/persistence` is a leaf that knows about strings
 * and atomicity and nothing else; it must not learn what a session or an
 * inventory is, or the storage seam starts having opinions about the game.
 * `@exiled/simulation` owns `state` and is the only place that parses it. What
 * the roster keeps in the open is exactly what a list of characters has to show
 * without loading any of them: name, class, level, league.
 *
 * `level` is therefore DENORMALISED — a copy of the number inside `state`,
 * rewritten on every save. That is the trade for not deserialising eleven
 * characters to draw eleven rows.
 *
 * Multi-character is an ONLINE-mode capability. Local mode holds one character
 * (`LOCAL_CHARACTER_CAP`), because a local save is a file on one machine with no
 * server to arbitrate it. The cap is the caller's policy, passed in, so the shape
 * never has to change when online arrives.
 */
import type { KvStore } from "./index.js";

/** What a roster row can show without loading the character. */
export interface CharacterHeader {
  id: string;
  name: string;
  classId: string;
  /** Denormalised from `state`; rewritten on every save. */
  level: number;
  /** "Local" today. The online league name once leagues exist. */
  league: string;
  /** Epoch ms. Ties are broken by it so the list has a stable order. */
  createdAt: number;
}

/** A header plus the character's own save. `state` is null until first played. */
export interface CharacterRecord extends CharacterHeader {
  state: unknown;
}

export interface RosterBlob {
  version: number;
  characters: CharacterRecord[];
  /** Shared across every character, as PoE shares a stash account-wide. Opaque. */
  stash?: unknown;
  lastPlayedId?: string;
}

/** Blob version this module writes. Bumped from the pre-roster single save (2). */
export const ROSTER_VERSION = 3;

/**
 * How many characters local mode holds.
 *
 * One. Not a technical limit — the shape holds any number — but the honest one:
 * without a server there is no account for several characters to belong to, and
 * a local save that pretends otherwise is a promise the storage cannot keep.
 */
export const LOCAL_CHARACTER_CAP = 1;

export const NAME_MIN = 3;
export const NAME_MAX = 20;

export function emptyRoster(): RosterBlob {
  return { version: ROSTER_VERSION, characters: [] };
}

/** The rows, without any character's save riding along. */
export function headers(roster: RosterBlob): CharacterHeader[] {
  return roster.characters.map(({ state: _state, ...header }) => header);
}

export function findCharacter(roster: RosterBlob, id: string): CharacterRecord | null {
  return roster.characters.find((c) => c.id === id) ?? null;
}

/** Case-insensitive: two characters called "Vess" and "vess" are one name twice. */
export function isNameTaken(roster: RosterBlob, name: string, exceptId?: string): boolean {
  const want = name.trim().toLowerCase();
  return roster.characters.some((c) => c.id !== exceptId && c.name.toLowerCase() === want);
}

/**
 * Why a name is not allowed, or null if it is. Returns the message the UI shows,
 * so there is one place that decides and one wording to keep right.
 */
export function nameError(roster: RosterBlob, name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < NAME_MIN) return `At least ${NAME_MIN} characters.`;
  if (trimmed.length > NAME_MAX) return `At most ${NAME_MAX} characters.`;
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(trimmed)) {
    return "Letters, digits and underscores, starting with a letter.";
  }
  if (isNameTaken(roster, trimmed)) return "That name is taken.";
  return null;
}

/**
 * Add a character. Returns the new roster, or throws — a create that silently
 * did nothing would leave the player staring at an unchanged list.
 */
export function addCharacter(
  roster: RosterBlob,
  record: CharacterRecord,
  cap: number,
): RosterBlob {
  if (roster.characters.length >= cap) throw new Error("roster is full");
  if (isNameTaken(roster, record.name)) throw new Error("name is taken");
  return {
    ...roster,
    characters: [...roster.characters, record],
    lastPlayedId: record.id,
  };
}

/** Remove a character. Unknown ids are a no-op, not a throw: the row is gone either way. */
export function removeCharacter(roster: RosterBlob, id: string): RosterBlob {
  const characters = roster.characters.filter((c) => c.id !== id);
  const next: RosterBlob = { ...roster, characters };
  // A dangling lastPlayedId would point the select screen at nothing.
  if (roster.lastPlayedId === id) {
    const fallback = characters[0]?.id;
    if (fallback === undefined) delete next.lastPlayedId;
    else next.lastPlayedId = fallback;
  }
  return next;
}

/** Write a character's save and refresh the level its row shows. */
export function putCharacterState(
  roster: RosterBlob,
  id: string,
  state: unknown,
  level: number,
): RosterBlob {
  return {
    ...roster,
    characters: roster.characters.map((c) => (c.id === id ? { ...c, state, level } : c)),
  };
}

/** Remember which character was played last, so select opens on them. */
export function touchLastPlayed(roster: RosterBlob, id: string): RosterBlob {
  return { ...roster, lastPlayedId: id };
}

/** Replace the shared stash. */
export function putStash(roster: RosterBlob, stash: unknown): RosterBlob {
  return { ...roster, stash };
}

/**
 * The blob as parsed JSON, or null if there is nothing saved or it is not JSON.
 *
 * A corrupt blob reads as "no save" rather than as a throw on boot: the player
 * loses a save either way, and a game that will not start cannot even say so.
 */
export async function readBlob(kv: KvStore): Promise<unknown | null> {
  const raw = await kv.load();
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** The saved roster, or null when there is none or it is not a v3 roster. */
export async function loadRoster(kv: KvStore): Promise<RosterBlob | null> {
  return asRoster(await readBlob(kv));
}

/** Narrow parsed JSON to a roster, or null. Exported so migration can reuse the check. */
export function asRoster(blob: unknown): RosterBlob | null {
  if (typeof blob !== "object" || blob === null) return null;
  const b = blob as Partial<RosterBlob>;
  if (b.version !== ROSTER_VERSION || !Array.isArray(b.characters)) return null;
  return b as RosterBlob;
}

export async function saveRoster(kv: KvStore, roster: RosterBlob): Promise<void> {
  await kv.save(JSON.stringify(roster));
}
