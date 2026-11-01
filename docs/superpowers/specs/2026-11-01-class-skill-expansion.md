# Class skill expansion: 18 skills, buffs, debuffs, movement

Owner request (1 Nov 2026): many more skills for all classes, each with its own animation, rich
VFX and SFX, not only damage: auras/buffs, debuffs, movement. Every skill is tested frame by frame
in a browser. PoE1 and PoE2 are the reference; each skill names which game it borrows from.

## 1. Roster

Unlock levels sit between the existing ones (Blink 4, area skills 8, Portal 10). Every class gets
one aura, one movement skill, one debuff carrier and three hitters.

| Class | Skill (id `skill.<x>.v1`) | Lvl | Kind | From | Mechanic | Anim (UAL2/UAL1 take) |
|---|---|---|---|---|---|---|
| Ironsworn | Infernal Cry `infernal_cry` | 3 | warcry | PoE2 | self nova: taunt + `scorched` (+fire dmg taken) on enemies, self buff +damage | MonsterTransformation / Idle_Rail_Call |
| Ironsworn | Leap Slam `leap_slam` | 6 | attack, travel | PoE1/PoE2 | leap to target, arrival AoE + knockback | Sword_Aerial_A(+Rec) |
| Ironsworn | Earthquake `earthquake` | 12 | attack | PoE2 | cone hit now, aftershock disc 1.0 s later, stuns | Sword_Heavy_C(+Rec) |
| Ironsworn | Determination `determination` | 14 | aura | PoE1 | toggle, reserves 25% mana, less damage taken | Sword_Block |
| Ironsworn | Sunder `sunder` | 18 | attack | PoE1 | rolling line of 5 bursts along the aim | Sword_Heavy_B(+Rec) |
| Ironsworn | Blood Rage `blood_rage` | 24 | buff | PoE1 | 8 s: +attack speed, +move speed, drains life (never kills) | MonsterTransformation |
| Stalker | Escape Shot `escape_shot` | 3 | attack, travel | PoE2 | hop backwards + chilling arrow at the aim | JogToFlip / Slide_Start |
| Stalker | Ice Shot `ice_shot` | 6 | attack | PoE1/PoE2 | cold arrow, bursts in a frost radius, chills | Bow_Notch + Bow_Shoot |
| Stalker | Sniper's Mark `snipers_mark` | 12 | mark | PoE2 | single enemy nearest the aim: +damage taken | Bow_Aim_Neutral / OverhandThrow |
| Stalker | Lightning Arrow `lightning_arrow` | 14 | attack | PoE1/PoE2 | lightning arrow that chains to 3 more enemies | Bow_RapidShoot_Loop / Bow_Shoot |
| Stalker | Rain of Arrows `rain_of_arrows` | 18 | attack | PoE1/PoE2 | 12 arrows fall scattered on a target circle over 0.8 s | Bow_Aim_Up |
| Stalker | Haste `haste` | 24 | aura | PoE1 | toggle, reserves 25% mana, +attack/cast speed, +move speed | Surprise / Sword_Block |
| Emberbound | Flame Dash `flame_dash` | 3 | spell, travel | PoE1 | fast dash to target, leaves a burning trail | Sword_Dash / Shield_Dash |
| Emberbound | Ember Nova `ember_nova` | 6 | spell | own name (PoE Fire Nova) | fire nova round the caster, knockback | Spell_Simple_Exit / LiftAir |
| Emberbound | Flammability `flammability` | 12 | curse | PoE1/PoE2 | area curse at target: +fire damage taken | Spell_Simple_Shoot_R |
| Emberbound | Solar Orb `solar_orb` | 14 | spell | PoE2 | thrown orb hovers 4 s, pulses fire damage | OverhandThrow |
| Emberbound | Firestorm `firestorm` | 18 | spell | PoE1/PoE2 | 10 meteors scattered on a target circle over 1.5 s | Spell_Simple_Idle_Loop / LiftAir |
| Emberbound | Herald of Ash `herald_of_ash` | 24 | aura | PoE1/PoE2 | toggle, reserves 25% mana, +damage; kills leave burning ground | MonsterTransformation / Consume |

Anim column is a starting suggestion: the per-class VFX worker previews the imported clips at
`?viewer&clip=` and picks. A clip may be reused by two skills only when nothing else fits.

Statuses (monster-side debuffs, drawn IN THE WORLD on the monster, not only on the target frame):
`scorched` (Infernal Cry), `chilled` (Escape Shot, Ice Shot), `stunned` (Earthquake aftershock),
`marked` (Sniper's Mark), `flammable` (Flammability), `taunted` (Infernal Cry).

Player buff ids: `infernal_cry`, `blood_rage`, `determination`, `haste`, `herald_of_ash`.

Out of scope, with reason: minions/totems (need new creature meshes and AI; a separate project),
channelled skills (need a hold-to-sustain cast model the sim does not have), support gems.

## 2. Sim contract (packages/, deterministic, integers only)

### Effect nodes (content-schema `EffectNode`, validator, `effectiveSkill` growth)

All new scalars are top-level so a breakpoint can patch them.

- `spawnProjectile` gains optional `explodeRadiusFixed` (on a hit, the same hit lands on every other
  enemy within the radius of the struck body), `chainCount` + `chainRangeFixed` (on a hit, a new
  projectile leaves the struck body toward the nearest enemy not yet hit, carrying `hitIds`), and an
  optional `onHit` status (see below).
- `areaHit` (new): `at: "self" | "target"`, `radiusFixed`, `damage?: DamageSpec`, `maxRangeFixed?`
  (target clamp, swept against walls like a ground area), `delayTicks?` (first impact), `count?`
  (impacts, default 1), `intervalTicks?`, `stepFixed?` (impact i sits i*step further along the aim:
  Sunder), `scatterFixed?` (impact offset drawn uniformly in a disc of this radius from a sim RNG
  sub-stream `skillScatter`: Rain of Arrows, Firestorm), `shape?: "disc" | "cone"` + `arcDegrees?`
  (cone opens along the aim from the centre), `knockbackFixed?` (pushes enemies away from the
  centre, swept against walls), `stunTicks?`, and optional `onHit` status.
- `applyBuff` (new): `buffId`, `durationTicks` (0 = toggled aura), `reserveManaPct?` (aura only),
  stat scalars `damagePct?`, `speedPct?` (attack and cast), `moveSpeedPct?`, `damageTakenPct?`
  (negative reduces), `lifeRegenPerSecFixed?`, `lifeDrainPerSecFixed?`, `critChancePct?`, and
  `onKillGround?: { radiusFixed; durationTicks; ailment: AilmentSpec }` (Herald of Ash). Casting a
  toggled aura that is already on turns it off and frees its reservation; turning it on is refused
  (no cost, no cooldown) when unreserved mana would go below zero.
- `applyStatus` (new, curses, marks, warcries): `at: "self" | "target"`, `radiusFixed`,
  `maxRangeFixed?`, `single?: 1` (only the enemy nearest the centre), `statusId`, `durationTicks`,
  `damageTakenPct?`, `damageTakenType?: DamageType` (absent = every type), `slowPct?`, `stunTicks?`,
  `taunt?: 1` (wakes and alerts the monster's pack).
- `travel` (new): `distanceFixed`, `ticks`, `direction?: "toward" | "away"`, `arrival?:` an areaHit
  body (radius, damage, knockback, stun) resolved at the landing point, `trail?: { spacingFixed;
  radiusFixed; durationTicks; ailment: AilmentSpec }` (Flame Dash). The body moves along a fixed
  heading each tick, swept against walls with its body radius; movement and new casts are held as a
  roll holds them; a `moveTo` arriving mid-travel is kept and applied at the end.
- `spawnGroundArea`: `ailment` becomes optional; gains `pulse?: { damage: DamageSpec; everyTicks }`
  (Solar Orb) and `slowPct?`. At least one of `ailment`/`pulse` must be present.
- Status spec `onHit` (on projectile/areaHit): `{ statusId, durationTicks, damageTakenPct?,
  damageTakenType?, slowPct?, stunTicks? }`.
- `GROWTH_FIELDS` gains `count`, `chainCount` only if a skill grows them; growth stays on
  `effects[0]`. `scaleDamage` covers every new damage field (areaHit, travel arrival, pulse).

### Components (all integer, all checksummed; absent = old worlds serialize unchanged)

- `BuffsC` on the player: `{ list: { id; skillId; untilTick /*0 = aura*/; reservePct?; damagePct?;
  speedPct?; moveSpeedPct?; damageTakenPct?; regen?; drain?; critPct?; onKill?: {...} }[] }`.
  Re-casting a timed buff refreshes its duration, never stacks.
- `StatusesC` on monsters: `{ list: { id; untilTick; damageTakenPct?; damageTakenType?; slowPct? }[] }`
  plus `stunnedUntilTick?` on `MonsterC`. Same id refreshes, never stacks. Bosses take stun as 0
  ticks and slow at half (PoE: higher rarity reduces slows; bosses resist stun).
- `TravelC` on the player: `{ skillId; startTick; untilTick; dirX; dirY; stepFixed; pending?; arrival
  data; trail data; lastTrailX/Y }`.
- `SkillAreaC` entity: `{ skillId; ownerId; team; radius; impactTick; shape; dirX; dirY; arc;
  damage parts; knockback; stun; onHit; spentTick? }`. Every areaHit impact is one entity, even with
  0 delay, so the client always sees it; it lives one tick past impact with `spentTick` set, exactly
  like a spent projectile. A dead owner does NOT cancel a player's area (unlike a monster telegraph).
- `Mana` regen and caps read reserved mana derived from active auras each tick:
  `reserved = maxMana * sum(reservePct) / 100`; mana never exceeds `maxMana - reserved`.

### Read sites

- Outgoing: skill-cast adds buff `damagePct` to spellDamagePct, `speedPct` to castSpeedPct,
  `critPct` to crit chance at cast start (snapshotted in CastingC as today).
- Incoming: damage-resolve multiplies by `(100 + sum damageTakenPct)/100` from the target's buffs
  (player) or matching statuses (monster), before armour and resistance; floor at 10%.
- Movement: player speed x `(100 + sum moveSpeedPct)/100`; monster speed x `(100 - slowPct)/100` at
  every `mon.moveSpeed` / boss speed read (one helper). A stunned monster neither moves nor attacks
  nor starts a wind-up; a wind-up already running is not cancelled.
- Life regen/drain per tick; drain never takes life below 1.
- Herald on-kill: when a monster dies to the player's team while a buff with `onKill` is active, a
  burning ground area with that buff's `skillId` spawns on the corpse.

### Wire (packages/protocol + protocol-bridge, all optional fields)

- `SnapshotEntity.kind` gains `"skillArea"`: `x, y, radius, skillId, team, impactIn` (seconds),
  `spent?`, `shape?`, `dirX?`, `dirY?`, `arc?`, `index?` (impact number within its cast).
- Monster entities gain `statuses?: string[]` (status ids, sorted) and `stunned?: true`.
- `player.buffs[]` entries gain `aura?: true` (remainingSec 0); new buffs appear with their buffId.
- `player.manaReserved?: number`, `player.castSkill?: string` (CastingC.skillId while casting),
  `player.travel?: { skillId; ticks; elapsed; dirX; dirY }`.
- `describeSkills` gains a line per new effect (area, delay, count, chain, buff stats, status stats,
  reservation, travel distance).

## 3. Client contract (apps/web)

- Per-class presentation modules `apps/web/src/render/skills/{ironsworn,stalker,emberbound}.ts`,
  each exporting a `ClassSkillLooks` record keyed by skill id: projectile look, `skillArea` impact
  builder, ground look, cast clip (+ playback), cast-start FX, travel pose/arc, buff FX, status FX.
  An index merges the three; renderer, rig and meshes dispatch through it. Status and buff FX are
  real geometry and particle systems, never sprites or camera-facing cards.
- Per-class cue tables `apps/web/src/audio/skill-cues/{ironsworn,stalker,emberbound}.ts`: cast,
  launch, flight, impact, area impact, buff on/off, status apply. Soundscape diffs the snapshot for
  each (skillArea first seen / spent, aura appears / leaves, status appears on a monster).
- HUD: BuffBar shows auras (no timer, a lit frame), the mana globe shows reserved mana as a dark cap,
  TargetFrame shows statuses, SkillTooltip shows the new lines. Icons for 18 skills and 11
  buff/status ids via `/codex-imagegen` in the existing icons' style.
- Dev harness (DEV only): worker spawn `dummy` (inert, 10x life, never moves or attacks, stands in a
  2-row arc 5-7 units in front of the player), `__dev.dummies(n)`, `__dev.cast(skillId, x, y)`,
  `__dev.refill()`, `__dev.cooldowns()`, `__dev.record(n, label)` (captures n consecutive rAF frames
  inside the callback and POSTs them to `/__capture` under `review/skills/<label>/`), and
  `?play&lab` (hideout, level 30, every skill of the class granted, dummies standing).

## 4. Verification

- Unit tests per mechanic (schema, cast, travel, area, buff, status, reservation, herald, bridge).
- content.test tables, characters.test signature slot, protocol-bridge 4-skill count updated.
- `PLAYTEST=full` parity stays inside its bands after the new unlocks dilute gem XP.
- `tools/skill-lab/capture.mjs`: headless Chromium on the GPU (`--use-angle=d3d11 --enable-gpu
  --ignore-gpu-blocklist`, below-normal priority), every player skill of every class, cast on
  dummies, every frame for 1.5 s saved under `review/skills/<skill>/`, a contact sheet per skill.
  The controller judges every sheet; defects go back to the owning per-class worker.
- `npm run typecheck`, `npx vitest run`, `npm run build -w apps/web`.

## 5. Ledger

- [x] A1 sim mechanics + wire + dev spawn (packages/; 1677 tests pass, typecheck clean)
- [x] A2 UAL2 clip import into anim-library.glb (69 -> 91 clips, 5.1 MB)
- [x] A3 icons: 18 skills + 11 buff/status (reviewed on review/icons-2026-11-01.png)
- [x] A4 SFX masters for every new cue (46 cues, 141 takes, VOICES + CORE_SFX; not heard by ear)
- [x] B0 18 content defs, numbers, content tests, playtest parity (1.165 < 1.20; L10 1.094 < 1.25)
- [x] B1 client infra: registries, skillArea/status/buff/travel rendering, HUD, dev harness (1866 web tests; kit 70)
- [x] B2 Ironsworn looks + cues (6 skills; browser review passed round 2)
- [x] B3 Stalker looks + cues (6 skills; browser review passed round 3)
- [x] B4 Emberbound looks + cues (6 skills; browser review passed round 2)
- [x] C1 frame capture tool (tools/skill-lab) + every skill captured and judged (18/18)
- [x] C2 fixes from capture review (risk review: 2 Important fixed)
- [ ] C3 full suite (3710 pass), typecheck, build, dev-surface: done; commit: awaiting owner
