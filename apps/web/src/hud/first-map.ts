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

/** Marks the character on its first map snapshot and answers whether to point. */
export function useFirstMap(
  settings: Settings,
  onSettingsChange: ((next: Settings) => void) | undefined,
  characterId: string,
  where: Where | null,
): boolean {
  const inMap = where?.area === "map";
  React.useEffect(() => {
    if (!inMap) return;
    const next = markMapEntered(settings, characterId);
    if (next !== settings) onSettingsChange?.(next);
  }, [inMap, settings, characterId, onSettingsChange]);
  return showsMapPointer(settings, characterId, where);
}
