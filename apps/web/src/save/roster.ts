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
  removeCharacter,
  saveRoster,
} from "@exiled/persistence";
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

/** crypto.randomUUID is not in every context (http origins, old Safari); fall back. */
function newId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
