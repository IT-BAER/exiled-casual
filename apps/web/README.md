# Combat Lab — local dev

## Run

```bash
npm install           # from repo root (workspace hoisting)
npm run dev -w apps/web
```

Open the URL printed by Vite (default: `http://localhost:5173`).

## Manual verification checklist

These are the Milestone 2 "playable greybox arena" acceptance checks. They
exercise the real Babylon renderer and the sim Web Worker, which cannot run in
the headless test suite — open the app in Chromium and confirm each item:

- [ ] The arena renders: a flat ground plane with greybox meshes visible.
- [ ] **Click-to-move**: left-click anywhere on the ground — the player capsule moves toward that point.
- [ ] **WASD**: holding W/A/S/D moves the player continuously in the expected direction.
- [ ] **Skill 1 (Ember Bolt)**: press `1` — a sphere projectile fires toward the cursor; on contact with a Cinder Imp the monster takes damage (life bar shrinks).
- [ ] **Skill 2 (Cinder Ground)**: press `2` — a flat disc appears at the cursor; Cinder Imps standing in it acquire burning stacks (inferred from faster death).
- [ ] **Skill 3 (Blink)**: press `3` — the player teleports toward the cursor by ~5 units.
- [ ] **Rare Cinder Imp**: the one taller box-shaped monster visibly survives significantly more hits than the normal imps (2.5× life, +30 fire res).
- [ ] **Cinder Ground lingering burn**: a monster that walks out of the disc keeps taking damage for ~2 seconds (burning ailment expiry).
- [ ] **HUD life bar** updates as the player takes damage from monster attacks.
- [ ] **HUD mana bar** decreases on skill use and regenerates over time.
- [ ] **HUD cooldown slots** show remaining cooldown in seconds after each skill use; the slot shows "Ready" when the cooldown expires.
- [ ] **Player death**: when the player's life reaches 0, the player respawns at the origin with full life and mana on the next tick.

## Architecture note

This is the Approach A "playable greybox arena" gate (Milestone 2). The full
Hideout → Atlas → Mapping loop is Milestone 5. The sim Web Worker is
authoritative; the client sends `Intent`s only and never mutates sim state.

Layers: `worker/` (headless fixed-step sim driver) → `protocol` `Snapshot`s →
`render/` (Babylon greybox, interpolated) and `hud/` (React overlay). Input in
`input/` maps keyboard + pointer to `Intent`s and posts them to the worker.
