/**
 * The first-time pointer to the Map Device.
 *
 * Telemetry: 9 of 33 new players left the hideout before any map, a median 36 s
 * after the first frame, while those who found a map needed 79.5 s. Nothing in
 * the hideout said where to go. Until a character first stands in a map, the HUD
 * carries an objective line, the device pulses, and the first load reads the
 * device tip.
 *
 * "Has entered a map" lives in the client settings (`ui.mapEntered`), keyed by
 * character id like `ui.controls`, not in the sim save: `SessionC` is hashed
 * into replay checksums, and a UI hint must not move them.
 */
import React from "react";
import { START_LEVEL } from "@exiled/rules";
import type { AreaKind } from "@exiled/protocol";
import { MAX_CONTROL_ENTRIES, type Settings } from "../settings";
import { nextNode } from "../menu/next-goal";

export const MAP_ENTERED_CAP = MAX_CONTROL_ENTRIES;

interface Where {
  area: AreaKind;
  player: { level: number };
}

/** The lab has no character (id ""), so it counts as having been everywhere. */
export function hasEnteredMap(settings: Settings, characterId: string): boolean {
  return characterId === "" || settings.ui.mapEntered.includes(characterId);
}

/** The same object back when already marked, so a caller cannot loop on its own write. */
export function markMapEntered(settings: Settings, characterId: string): Settings {
  if (hasEnteredMap(settings, characterId)) return settings;
  const mapEntered = [...settings.ui.mapEntered, characterId].slice(-MAP_ENTERED_CAP);
  return { ...settings, ui: { ...settings.ui, mapEntered } };
}

/**
 * Standing in the hideout and never in a map. Past level 1 a character has
 * killed in a map (the hideout has no monsters), which covers every character
 * made before the list existed.
 */
export function showsMapPointer(settings: Settings, characterId: string, where: Where | null): boolean {
  return where !== null && where.area === "hideout" && where.player.level <= START_LEVEL
    && !hasEnteredMap(settings, characterId);
}

/** The HUD's quest tracker: one quest over its steps, and whether the device breathes. */
export interface Objective {
  quest: string;
  steps: string[];
  beckon: boolean;
}

export interface ObjectiveWhere extends Where {
  atlasSeed: number;
  completedNodes: string[];
  mapOpen: boolean;
  activeNodeId?: string;
}

/**
 * Telemetry 7 Nov: 4 of 6 boss killers portalled home and closed the game
 * within 16-66 s without opening the device again; the hideout had nothing left
 * to say once the first map was done. So after a clear the tracker names the
 * next place on the fixed-ratio track (docs/09 rule 7) and the device breathes
 * until a map that is not yet cleared is open. `clearedHere`: a boss fell
 * during this visit to the map, which the snapshot alone cannot tell from a
 * re-run of a node cleared before.
 */
export function objectiveFor(
  settings: Settings,
  characterId: string,
  where: ObjectiveWhere | null,
  clearedHere: boolean,
): Objective | null {
  if (where === null || characterId === "") return null;
  if (showsMapPointer(settings, characterId, where)) {
    return { quest: "First Map", steps: ["Open the Map Device"], beckon: true };
  }
  if (where.completedNodes.length === 0) return null;
  const next = nextNode(where.atlasSeed, where.completedNodes, where.activeNodeId);
  if (!next) return null;
  const place = `${next.name}, Tier ${next.tier}`;
  if (where.area === "map") {
    return clearedHere
      ? { quest: "Map Complete", steps: [`The Waystone opens ${place}`], beckon: false }
      : null;
  }
  const running = where.mapOpen && !!where.activeNodeId && !where.completedNodes.includes(where.activeNodeId);
  return running ? null : { quest: "Next Map", steps: [place], beckon: true };
}

/** Marks the character on its first map snapshot and answers what the tracker says. */
export function useObjective(
  settings: Settings,
  onSettingsChange: ((next: Settings) => void) | undefined,
  characterId: string,
  where: ObjectiveWhere | null,
): Objective | null {
  const inMap = where?.area === "map";
  React.useEffect(() => {
    if (!inMap) return;
    const next = markMapEntered(settings, characterId);
    if (next !== settings) onSettingsChange?.(next);
  }, [inMap, settings, characterId, onSettingsChange]);
  // Clears counted on entering the map; more of them since means its boss fell.
  const entry = React.useRef<number | null>(null);
  if (!inMap) entry.current = null;
  else if (entry.current === null) entry.current = where!.completedNodes.length;
  const clearedHere = inMap && where!.completedNodes.length > entry.current!;
  return objectiveFor(settings, characterId, where, clearedHere);
}
