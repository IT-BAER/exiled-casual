/** Why `snap` (read after the settle time) is not a healthy map session, or null. */
export function areaReason(snap, mapReached) {
  if (snap.area === "map") return null;
  // A fresh level-1 bot on a high-tier node can die six times inside the settle time:
  // revive then sends him home with the map closed, the game working (revive.ts).
  if (mapReached && snap.area === "hideout" && snap.portalsLeft === 0 && snap.mapOpen === false) return null;
  return `area is ${JSON.stringify(snap.area)}, expected "map"`;
}
