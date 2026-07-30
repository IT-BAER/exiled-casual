# Devlog

A visual record of Exiled Casual’s first ten days, from prototype combat to a complete game shell.
Design notes and implementation details live in [`../docs/`](../docs/).

## 2026-07-20 · First playable combat

The box prototype became a rigged character with a run loop and readable boss attacks.

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-20-rigged-player.jpeg" alt="Rigged player character in the first playable scene" width="100%"><br><sub>A rigged humanoid replaces the original box actor.</sub></td>
<td width="33%"><img src="screenshots/2026-07-20-run-loop-portals.jpeg" alt="Map device surrounded by six glowing portals" width="100%"><br><sub>The map device opens six portals for each run.</sub></td>
<td width="33%"><img src="screenshots/2026-07-20-boss-telegraph.jpeg" alt="Boss standing inside an orange attack telegraph" width="100%"><br><sub>The first boss attack warns players before it lands.</sub></td>
</tr>
</table>

## 2026-07-21 · Procedural maps and boss phases

Generated interiors gained real boundaries while the Warden encounter grew a second phase.

<table>
<tr>
<td width="50%"><img src="screenshots/2026-07-21-textured-dungeon-walls.jpeg" alt="Procedural dungeon with textured walls and floor" width="100%"><br><sub>Procedural interiors gain textured walls and walkable rooms.</sub></td>
<td width="50%"><img src="screenshots/2026-07-21-warden-phase2-burning-slam.jpeg" alt="Warden boss standing over a burning slam area" width="100%"><br><sub>The Warden’s second phase leaves burning ground behind.</sub></td>
</tr>
</table>

## 2026-07-22 · Loot and map preparation

The first item loop connected drops, inventory, Waystones, and map activation.

<table>
<tr>
<td width="50%"><img src="screenshots/2026-07-22-first-loot.jpeg" alt="Inventory panel containing the first item drops" width="100%"><br><sub>Server-authored drops can now be collected and stored.</sub></td>
<td width="50%"><img src="screenshots/2026-07-22-preparation-panel.jpeg" alt="Map device preparation panel with destinations and Waystones" width="100%"><br><sub>The map device now prepares destinations with Waystones.</sub></td>
</tr>
</table>

## 2026-07-23 · A readable HUD

Painted frames and structured tooltips replaced the prototype interface.

<table>
<tr>
<td width="50%"><img src="screenshots/2026-07-23-orb-frames.jpeg" alt="Life and mana globes with ornate gold frames" width="100%"><br><sub>Painted frames give the life and mana globes weight.</sub></td>
<td width="50%"><img src="screenshots/2026-07-23-item-tooltip.png" alt="Detailed item tooltip with stats and requirements" width="100%"><br><sub>Items expose their base stats, modifiers, and requirements.</sub></td>
</tr>
</table>

## 2026-07-24 · Equipment and item identity

Items gained painted art, unique identities, direct equipment controls, and a cohesive bottom HUD.

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-24-unique-item.jpeg" alt="Unique item tooltip for Ashmaw inside the inventory" width="100%"><br><sub>Unique items carry fixed art, modifiers, names, and flavour.</sub></td>
<td width="33%"><img src="screenshots/2026-07-24-drag-equip.jpeg" alt="Inventory item being dragged toward highlighted equipment slots" width="100%"><br><sub>Dragging equipment highlights every legal destination slot.</sub></td>
<td width="33%"><img src="screenshots/2026-07-24-corner-hud.jpeg" alt="Complete bottom HUD with framed globes and skill bar" width="100%"><br><sub>The globes and skill bar settle into one bottom frame.</sub></td>
</tr>
</table>

## 2026-07-25 · Progression, Atlas, and combat stats

The game gained visible progression, functional gear stats, a fullscreen Atlas, and richer loot presentation.

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-atlas-fullscreen.jpeg" alt="Fullscreen Atlas over a painted world map" width="100%"><br><sub>The Atlas expands into a navigable fullscreen world.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-character-sheet.jpeg" alt="Character sheet showing life, mana, armour, and resistances" width="100%"><br><sub>The character sheet exposes defensive and offensive totals.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-inventory-full-height-mouse-slots.jpeg" alt="Full-height inventory beside the complete bottom HUD" width="100%"><br><sub>The inventory docks full-height without covering the action bar.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-25-loot-beams.jpeg" alt="Ground loot with rarity labels and colored light beams" width="100%"><br><sub>Rarity-colored labels and beams make drops readable instantly.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-waystone-modifiers.jpeg" alt="Map device displaying Waystones with different modifiers" width="100%"><br><sub>Waystones now change both map danger and rewards.</sub></td>
<td width="33%"><img src="screenshots/2026-07-25-poe1-globes.jpeg" alt="Rebuilt life and mana globes with labels above them" width="100%"><br><sub>The globes are rebuilt around clearer labels and proportions.</sub></td>
</tr>
</table>

## 2026-07-26 · Rewards, crafting, and stash

Boss rewards became tangible while identification, crafting, and stash management joined the loop.

<table>
<tr>
<td width="50%"><img src="screenshots/2026-07-26-boss-pays-a-burst.jpeg" alt="Boss arena filled with a burst of dropped loot" width="100%"><br><sub>The Warden now pays out with a visible loot burst.</sub></td>
<td width="50%"><img src="screenshots/2026-07-26-currency-orbs.jpeg" alt="Inventory containing several crafting currency orbs" width="100%"><br><sub>Currency orbs turn ordinary items into crafting opportunities.</sub></td>
</tr>
<tr>
<td width="50%"><img src="screenshots/2026-07-26-panes-aligned.jpeg" alt="Aligned inventory and stash panes on opposite sides" width="100%"><br><sub>Inventory and stash become one mirrored interface.</sub></td>
<td width="50%"><img src="screenshots/2026-07-26-skill-tooltip.jpeg" alt="Skill tooltip displayed above the action bar" width="100%"><br><sub>Skills now explain their damage, cost, and timing.</sub></td>
</tr>
</table>

## 2026-07-27 · Wardrobe and hideout services

Equipment became visible on the character, while the Atlas and disenchanter gained focused interaction panels.

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-27-atlas-node-panel.jpeg" alt="Atlas node panel anchored over a selected map location" width="100%"><br><sub>Each Atlas location opens its own anchored preparation panel.</sub></td>
<td width="33%"><img src="screenshots/2026-07-27-wardrobe-slots.jpeg" alt="Character lineup demonstrating modular wardrobe slots" width="100%"><br><sub>A modular wardrobe swaps visible gear by equipment slot.</sub></td>
<td width="33%"><img src="screenshots/2026-07-27-disenchanter-npc.jpeg" alt="Disenchanter NPC standing beside a glowing brazier" width="100%"><br><sub>The disenchanting bench becomes a character in the hideout.</sub></td>
</tr>
<tr>
<td width="33%"><img src="screenshots/2026-07-27-gear-matches-the-art.jpeg" alt="Character armour compared with its painted item art" width="100%"><br><sub>Equipped armour now matches its painted inventory identity.</sub></td>
<td width="33%"><img src="screenshots/2026-07-27-the-coat-folds-around-the-leg.jpeg" alt="Animated coat folding around the character’s moving leg" width="100%"><br><sub>The long coat bends around the character’s stride.</sub></td>
<td width="33%"><img src="screenshots/2026-07-27-vendor-purchase-window.jpeg" alt="Disenchanter purchase window beside the inventory" width="100%"><br><sub>The disenchanter now buys scraps and sells equipment.</sub></td>
</tr>
</table>

## 2026-07-28 · World art and distinct skills

The hideout, map boundaries, and starter skills received their first production-style visual pass.

<table>
<tr>
<td width="50%"><img src="screenshots/2026-07-28-hideout-props.jpeg" alt="Hideout with modeled stash, map device, and disenchanter props" width="100%"><br><sub>Modeled props replace the hideout’s placeholder primitives.</sub></td>
<td width="50%"><img src="screenshots/2026-07-28-rock-walls.jpeg" alt="Outdoor map enclosed by irregular rock walls" width="100%"><br><sub>Natural rock walls give generated maps a believable edge.</sub></td>
</tr>
</table>

<table>
<tr>
<td width="33%"><img src="screenshots/2026-07-28-ember-bolt.jpeg" alt="Bright Ember Bolt projectile streaking across the hideout" width="100%"><br><sub>Ember Bolt becomes a fast, white-hot projectile streak.</sub></td>
<td width="33%"><img src="screenshots/2026-07-28-cinder-ground.jpeg" alt="Circular patch of glowing cracked burning ground" width="100%"><br><sub>Cinder Ground burns through animated cracks and embers.</sub></td>
<td width="33%"><img src="screenshots/2026-07-28-blink.jpeg" alt="Violet teleport trail left behind by Blink" width="100%"><br><sub>Blink leaves a cool violet displacement trail.</sub></td>
</tr>
</table>

## 2026-07-29 · A complete game shell

Menus, character selection, loading screens, options, and the experience rail completed the route into play.

<table>
<tr>
<td width="50%"><img src="screenshots/2026-07-29-menu-main.jpeg" alt="Exiled Casual main menu in a dark vaulted hall" width="100%"><br><sub>The game opens on its own painted main menu.</sub></td>
<td width="50%"><img src="screenshots/2026-07-29-menu-character-select.jpeg" alt="Character selection hall with roster panel" width="100%"><br><sub>A persistent roster now handles character selection and creation.</sub></td>
</tr>
<tr>
<td width="50%"><img src="screenshots/2026-07-29-loading-hideout.jpeg" alt="Hideout loading screen with tip and animated emblem" width="100%"><br><sub>Area transitions wait behind a painted loading plate.</sub></td>
<td width="50%"><img src="screenshots/2026-07-29-options-docked.jpeg" alt="Options panel docked beside the live game scene" width="100%"><br><sub>Graphics, sound, and UI settings apply live in-game.</sub></td>
</tr>
</table>

<table>
<tr>
<td width="100%"><img src="screenshots/2026-07-29-experience-rail.jpeg" alt="Thin experience rail along the bottom of the HUD" width="100%"><br><sub>Experience moves into a quiet rail beneath the HUD.</sub></td>
</tr>
</table>
