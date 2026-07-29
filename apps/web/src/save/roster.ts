/**
 * The menu's view of the save.
 *
 * The game itself reads and writes its character inside the sim worker; the
 * menu needs the list before any worker exists, so it talks to the same
 * IndexedDB store directly through the roster module. Both go through
 * `@exiled/persistence`'s single-blob seam, so there is still exactly one
 * writer at a time: the menu writes while no game is running, the worker writes
 * while one is.
 *
 * Only `roster-io` is imported, never `characters` — that half needs a World,
 * and pulling it in here would drag the whole simulation into the main bundle.
 */
import { IndexedDbKv } from "@exiled/persistence";
import type { CharacterRecord, KvStore, RosterBlob } from "@exiled/persistence";
import {
  LOCAL_CHARACTER_CAP,
  addCharacter,
  emptyRoster,
  headers,
  putSettings,
  removeCharacter,
  saveRoster,
} from "@exiled/persistence";
import { sanitize, type Settings } from "../settings";
import { makeCharacterRecord, openRoster, type NewCharacter } from "@exiled/simulation/roster-io";

export type Mode = "local" | "online";

/** How many characters a mode holds. Online is uncapped; local holds one. */
export function capFor(mode: Mode): number {
  return mode === "local" ? LOCAL_CHARACTER_CAP : Number.POSITIVE_INFINITY;
}

let store: KvStore | null = null;

/** The browser store, made once. Tests inject a MemoryKv instead. */
export function kv(): KvStore {
  store ??= new IndexedDbKv();
  return store;
}

/** Point the menu at a different store. Test seam; also how online mode will land. */
export function setKv(next: KvStore | null): void {
  store = next;
}

export async function readRoster(): Promise<RosterBlob> {
  try {
    return await openRoster(kv());
  } catch {
    // A browser that refuses IndexedDB (private mode, blocked storage) must still
    // reach a menu. It gets an empty roster and a create that will fail loudly.
    return emptyRoster();
  }
}

export async function createCharacter(
  roster: RosterBlob,
  input: NewCharacter,
  mode: Mode,
): Promise<{ roster: RosterBlob; record: CharacterRecord }> {
  const record = makeCharacterRecord(input, newId(), Date.now());
  const next = addCharacter(roster, record, capFor(mode));
  await saveRoster(kv(), next);
  return { roster: next, record };
}

export async function deleteCharacter(roster: RosterBlob, id: string): Promise<RosterBlob> {
  const next = removeCharacter(roster, id);
  await saveRoster(kv(), next);
  return next;
}

export { headers };

/** What the player has set, proven safe. A roster with no settings reads as defaults. */
export function settingsOf(roster: RosterBlob): Settings {
  return sanitize(roster.settings);
}

/**
 * How long a burst of changes is allowed to run before it costs a write.
 *
 * Dragging a slider fires per pointer event, and each write is a JSON.stringify
 * of the WHOLE blob (every character's save rides in it) plus an IndexedDB
 * round trip. 400ms is a guess, and the only one in this file.
 */
export const SETTINGS_DEBOUNCE_MS = 400;

let settingsTimer: ReturnType<typeof setTimeout> | null = null;
let settingsWrite: Promise<void> = Promise.resolve();

/**
 * Write settings at most once per burst; the last call wins.
 *
 * ponytail: the roster is captured per call, so a write scheduled here and a
 * character created before it fires would save the older roster. Settings only
 * change from the Options panel, where no character can be created, so the
 * window does not exist today. Re-read the roster here if that ever stops being
 * true.
 */
export function saveSettingsSoon(roster: RosterBlob, settings: Settings): void {
  if (settingsTimer !== null) clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    settingsTimer = null;
    settingsWrite = saveRoster(kv(), putSettings(roster, settings));
  }, SETTINGS_DEBOUNCE_MS);
}

/** Wait for the pending settings write. Test seam, and how a caller forces the flush. */
export function flushSettingsSave(): Promise<void> {
  return settingsWrite;
}

/** crypto.randomUUID is not in every context (http origins, old Safari); fall back. */
function newId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
