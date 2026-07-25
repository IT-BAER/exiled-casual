import React, { useState } from "react";
import {
  atlasGraph, isNodeReachable, areaLevel, atlasNodeTier,
  waystoneRarity, waystoneMods, type WaystoneRarity,
} from "@exiled/rules";
import type { AtlasGraphNode } from "@exiled/rules";
import { MAP_PORTALS } from "@exiled/protocol";
import type { Snapshot } from "@exiled/protocol";

interface Props {
  atlasSeed: number;
  completedNodes: string[];
  /** The stones the character actually owns, straight off the snapshot. */
  waystones: Snapshot["waystones"];
  onActivate: (atlasNodeId: string, waystoneId: string) => void;
  onClose: () => void;
}

// PoE2 map-device look: aged near-black panel behind an ornate gold frame, a
// carved red-brown title banner, engraved small-caps serif, item-tile choices.
// Matches poe2-screenshots/atlas-maps.webp (banner + gilt frame) and
// portals-map-device.webp (Map Device / waystone naming).
const SERIF = '"Cinzel", "Trajan Pro", Georgia, "Times New Roman", serif';
const GOLD = "#c8a44d";
const GOLD_DIM = "#7a5c22";
const PARCHMENT = "#e8dcc0";
const MAGIC = "#8aa6ff"; // waystone (magic item) tint, as in PoE rarity
const AFFIX_BLUE = "#8f97ff"; // the tooltip's affix colour, for a modifier that pays
const DANGER_RED = "#d2705f"; // ...and its opposite, for one that charges
/** PoE's own item-rarity palette, the same one ItemTooltip tints a drop with. */
const RARITY_TINT: Record<WaystoneRarity, string> = { normal: "#c8c8c8", magic: MAGIC, rare: "#e6d64a" };
const RARITY_NAME: Record<WaystoneRarity, string> = {
  normal: "Waystone",
  magic: "Magic Waystone",
  rare: "Rare Waystone",
};

function tile(selected: boolean, disabled: boolean, accent: string): React.CSSProperties {
  return {
    position: "relative",
    minWidth: 132,
    padding: "10px 12px",
    borderRadius: 3,
    cursor: disabled ? "default" : "pointer",
    textAlign: "center",
    fontFamily: SERIF,
    letterSpacing: 0.5,
    background: selected
      ? "linear-gradient(180deg, #241f14 0%, #14110a 100%)"
      : "linear-gradient(180deg, #17181d 0%, #0d0e12 100%)",
    border: `1px solid ${selected ? accent : "#33301f"}`,
    boxShadow: selected ? `inset 0 0 12px ${accent}55, 0 0 6px ${accent}44` : "inset 0 0 8px rgba(0,0,0,0.6)",
    color: disabled ? "#5a564a" : PARCHMENT,
    opacity: disabled ? 0.55 : 1,
    transition: "border-color 120ms, box-shadow 120ms",
  };
}

const NODE = 26; // medallion diameter
const CLEARED = "#7ea45c";
const FOG = "#4c463a";
/** Out of fog, but the stone in hand is too weak: a refusal, not a blank. */
const UNDER_TIER = "#8a5a4a";

/**
 * The world map, per atlas-maps.webp: places sit where the graph put them, routes
 * are drawn between them, and what you have cleared is lit while the rest sits in
 * fog. The reference paints a whole world under its nodes; this field is the same
 * carved stone the character sheet uses, tinted and vignetted, because a painted
 * region per node is art we do not have yet and a flat panel would read as a form.
 * Routes to a cleared place are solid, the rest dashed, which is how the reference
 * separates the road you have walked from the one you have not.
 */
function AtlasMap(props: {
  nodes: AtlasGraphNode[];
  completedNodes: string[];
  selectedId: string | null;
  /** Tier of the stone currently in hand, or null while none is chosen. */
  stoneTier: number | null;
  onSelect: (id: string) => void;
}) {
  const { nodes, completedNodes, selectedId, stoneTier, onSelect } = props;
  // Four states, not three: a place can be out of fog and still refuse the stone
  // in your hand, which is a different problem to solve and has to look like one.
  const state = (n: AtlasGraphNode) =>
    completedNodes.includes(n.id)
      ? "cleared"
      : !isNodeReachable(nodes, completedNodes, n.id)
      ? "fog"
      : stoneTier !== null && stoneTier < atlasNodeTier(nodes, n.id)
      ? "underTier"
      : "open";

  // Each undirected link once, keyed by its sorted pair.
  const routes: { key: string; a: AtlasGraphNode; b: AtlasGraphNode }[] = [];
  for (const a of nodes) {
    for (const id of a.links) {
      const b = nodes.find((n) => n.id === id);
      if (!b || a.id > b.id) continue;
      routes.push({ key: `${a.id}-${b.id}`, a, b });
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        // Full-bleed painted world, per atlas-maps.webp: the map IS the screen,
        // darkened at the edges so the docked bar and banner still read.
        backgroundImage:
          "radial-gradient(ellipse at 50% 45%, rgba(0,0,0,0) 35%, rgba(6,8,8,0.88) 100%), url(/textures/ui/atlas_world_v1.png), url(/textures/ui/char_stone_v1.png)",
        // Carved stone tiles under the painting, so a missing world art file
        // degrades to the character sheet's surface rather than to black.
        backgroundSize: "cover, cover, 420px",
        backgroundPosition: "center, center, center",
      }}
    >
      {/* Node field, inset so a medallion on the edge is not clipped and the
          bottom dock does not sit on top of one. */}
      <div style={{ position: "absolute", top: 96, left: 90, right: 90, bottom: 470 }}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
        >
          {routes.map(({ key, a, b }) => {
            const walked = completedNodes.includes(a.id) || completedNodes.includes(b.id);
            return (
              <line
                key={key}
                data-testid={`prep-route-${key}`}
                x1={a.x * 100}
                y1={a.y * 100}
                x2={b.x * 100}
                y2={b.y * 100}
                stroke={walked ? CLEARED : "#6b6250"}
                strokeOpacity={walked ? 0.85 : 0.4}
                strokeWidth={walked ? 2 : 1.5}
                strokeDasharray={walked ? undefined : "4 5"}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        {nodes.map((n) => {
          const st = state(n);
          const selected = n.id === selectedId;
          const tier = atlasNodeTier(nodes, n.id);
          const accent =
            st === "cleared" ? CLEARED : st === "open" ? GOLD : st === "underTier" ? UNDER_TIER : FOG;
          // What the place is, in one line, because the medallion can only carry
          // a colour and a number: PoE2's Atlas says the rest on hover.
          const tip =
            st === "cleared" ? `${n.name} — cleared`
            : st === "fog" ? `${n.name} — no route yet`
            : st === "underTier" ? `${n.name} — needs a Tier ${tier} Waystone`
            : `${n.name} — Tier ${tier} or better, Area Level ${areaLevel(tier)}`;
          return (
            <button
              key={n.id}
              data-testid={`prep-node-${n.id}`}
              disabled={st !== "open"}
              onClick={() => onSelect(n.id)}
              title={tip}
              style={{
                position: "absolute",
                left: `${(n.x * 100).toFixed(2)}%`,
                top: `${(n.y * 100).toFixed(2)}%`,
                transform: "translate(-50%, -50%)",
                width: NODE,
                height: NODE,
                padding: 0,
                borderRadius: "50%",
                cursor: st === "open" ? "pointer" : "default",
                background:
                  st === "fog"
                    ? "radial-gradient(circle at 50% 35%, #23211b, #0c0b09)"
                    : `radial-gradient(circle at 50% 35%, ${accent}, #17140c 78%)`,
                border: `2px solid ${accent}`,
                boxShadow:
                  st === "fog"
                    ? "inset 0 0 6px rgba(0,0,0,0.9)"
                    : `0 0 ${selected ? 16 : 8}px ${accent}${selected ? "cc" : "66"}, inset 0 0 6px rgba(0,0,0,0.7)`,
                opacity: st === "fog" ? 0.62 : 1,
              }}
            >
              {/* The tier the place demands, stamped in the medallion. A node's
                  own difficulty is the one thing about it that is not a colour,
                  and it is what decides which stone can open it. */}
              <span
                data-testid={`prep-node-${n.id}-tier`}
                style={{
                  fontFamily: SERIF,
                  fontSize: 11,
                  fontWeight: 700,
                  color: st === "fog" ? "#5f5a4e" : "#120f08",
                  textShadow: st === "fog" ? "none" : "0 1px 0 rgba(255,255,255,0.25)",
                  pointerEvents: "none",
                }}
              >
                {tier}
              </span>
              <span
                style={{
                  position: "absolute",
                  top: NODE + 4,
                  left: "50%",
                  transform: "translateX(-50%)",
                  whiteSpace: "nowrap",
                  fontFamily: SERIF,
                  fontSize: 11,
                  letterSpacing: 0.5,
                  // A plate behind the label: with twelve places on a jittered
                  // grid some seeds run a route straight through a name, and a
                  // bare glyph on a dashed line is unreadable either way round.
                  padding: "1px 5px",
                  borderRadius: 3,
                  background: "rgba(8,9,7,0.78)",
                  color: st === "fog" ? "#6a6459" : st === "cleared" ? CLEARED : PARCHMENT,
                  opacity: st === "fog" ? 0.7 : 1,
                  textShadow: "0 1px 3px #000",
                  pointerEvents: "none",
                }}
              >
                {n.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function PreparationPanel({ atlasSeed, completedNodes, waystones, onActivate, onClose }: Props) {
  const nodes = atlasGraph(atlasSeed);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [wsId, setWsId] = useState<string | null>(null);
  const ws = waystones.find((w) => w.id === wsId);
  // The place has to accept the stone. Selecting a node and then a weaker stone
  // is an easy way to end up here, so the button says no rather than firing an
  // intent the sim would drop on the floor.
  const requiredTier = nodeId === null ? null : atlasNodeTier(nodes, nodeId);
  const underTier = ws !== undefined && requiredTier !== null && ws.tier < requiredTier;
  const canActivate = nodeId !== null && ws !== undefined && !underTier;

  return (
    <div
      data-testid="prep-panel"
      style={{
        position: "absolute",
        inset: 0,
        background: "#050606",
        overflow: "hidden",
        pointerEvents: "auto",
        fontFamily: SERIF,
        color: PARCHMENT,
      }}
    >
      <AtlasMap
        nodes={nodes}
        completedNodes={completedNodes}
        selectedId={nodeId}
        stoneTier={ws?.tier ?? null}
        onSelect={setNodeId}
      />

      {/* Carved title banner, floating over the world as in atlas-maps.webp
          rather than capping a card: the map has no frame to cap. */}
      <div
        style={{
          position: "absolute",
          top: 18,
          left: "50%",
          transform: "translateX(-50%)",
          padding: "8px 46px",
          textAlign: "center",
          borderRadius: 4,
          background: "linear-gradient(180deg, #4a1a13 0%, #6b2018 45%, #3a1310 100%)",
          border: `1px solid ${GOLD_DIM}`,
          boxShadow: `inset 0 1px 0 ${GOLD}55, inset 0 -1px 0 #000, 0 6px 20px rgba(0,0,0,0.8)`,
        }}
      >
        <span
          style={{
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: 3,
            textTransform: "uppercase",
            color: PARCHMENT,
            textShadow: "0 1px 2px #000",
          }}
        >
          Map Device
        </span>
      </div>
      <button
        data-testid="prep-close"
        onClick={onClose}
        style={{
          position: "absolute",
          top: 18,
          right: 24,
          width: 34,
          height: 34,
          borderRadius: "50%",
          background: "radial-gradient(circle at 50% 35%, #3a1310, #140806)",
          border: `1px solid ${GOLD_DIM}`,
          color: "#c9b48a",
          cursor: "pointer",
          fontSize: 20,
          lineHeight: 1,
        }}
      >
        ×
      </button>

      {/* Everything you choose FROM docks at the bottom, so the world keeps the
          screen. Sized to sit above where the HUD orbs live. */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 92, // clear of the HUD's flask row, skill bar and XP trough
          transform: "translateX(-50%)",
          width: 760,
          maxWidth: "94%",
          padding: "14px 18px 16px",
          borderRadius: 4,
          background: "linear-gradient(180deg, rgba(14,15,19,0.94) 0%, rgba(16,13,9,0.96) 100%)",
          border: `1px solid ${GOLD_DIM}`,
          boxShadow: `0 0 0 1px #000, 0 0 0 4px #1b1710, 0 -8px 34px rgba(0,0,0,0.85)`,
        }}
      >
          <SectionLabel>Waystone{waystones.length > 0 ? ` (${waystones.length})` : ""}</SectionLabel>
          {waystones.length === 0 && (
            <div
              data-testid="prep-no-waystones"
              style={{ padding: "14px 0 20px", color: "#8a7f66", fontSize: 13, fontStyle: "italic" }}
            >
              No Waystones. Clear a map to be given more.
            </div>
          )}
          {/* The stock grows now, so the row scrolls rather than pushing ACTIVATE
              off the panel once a character is a dozen stones deep. */}
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", maxHeight: 168, overflowY: "auto" }}>
            {waystones.map((w) => {
              const selected = w.id === wsId;
              const rarity = waystoneRarity(w.seed);
              const mods = waystoneMods(w.seed);
              const tint = RARITY_TINT[rarity];
              return (
                <button
                  key={w.id}
                  data-testid={`prep-ws-${w.id}`}
                  onClick={() => setWsId(w.id)}
                  style={{ ...tile(selected, false, tint), flex: "1 1 0", textAlign: "left", minWidth: 190 }}
                >
                  {/* Rarity in the name, tier under it, then what the stone will do
                      to the run — the point of the panel is that risk is legible
                      BEFORE the portal opens, not after the first pack. */}
                  <div data-testid={`prep-ws-${w.id}-rarity`} style={{ fontSize: 13, color: tint, letterSpacing: 0.4 }}>
                    {RARITY_NAME[rarity]}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, margin: "2px 0 6px" }}>Tier {w.tier}</div>
                  {mods.length === 0 ? (
                    <div style={{ fontSize: 11, color: "#6b6656", fontStyle: "italic" }}>No modifiers</div>
                  ) : (
                    mods.map((m) => (
                      <div
                        key={m.id}
                        data-testid={`prep-ws-${w.id}-mod-${m.id}`}
                        style={{
                          fontSize: 11,
                          lineHeight: 1.45,
                          // A prefix pays and a suffix charges, so they are not the
                          // same colour: PoE's affix blue for the reward, a warmer
                          // red for the thing that will kill you.
                          color: m.kind === "prefix" ? AFFIX_BLUE : DANGER_RED,
                        }}
                      >
                        {m.label}
                      </div>
                    ))
                  )}
                </button>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 14px",
              marginBottom: 12,
              background: "rgba(0,0,0,0.35)",
              border: "1px solid #2a2517",
              borderRadius: 3,
              fontSize: 14,
            }}
          >
            <span data-testid="prep-arealevel" style={{ letterSpacing: 0.5 }}>
              Area Level{" "}
              <b style={{ color: ws ? GOLD : "#5a564a", fontSize: 16 }}>
                {ws ? areaLevel(ws.tier) : "—"}
              </b>
            </span>
            {underTier ? (
              <span data-testid="prep-undertier" style={{ letterSpacing: 0.5, color: UNDER_TIER }}>
                Needs a Tier <b>{requiredTier}</b> Waystone
              </span>
            ) : (
              <span data-testid="prep-revives" style={{ letterSpacing: 0.5, color: "#b7ac8e" }}>
                Portals <b style={{ color: MAGIC }}>{MAP_PORTALS}</b>
              </span>
            )}
          </div>

          <button
            data-testid="prep-activate"
            disabled={!canActivate}
            onClick={() => {
              if (canActivate && nodeId && ws) onActivate(nodeId, ws.id);
            }}
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: 3,
              fontFamily: SERIF,
              fontWeight: 700,
              fontSize: 15,
              letterSpacing: 2,
              textTransform: "uppercase",
              cursor: canActivate ? "pointer" : "default",
              color: canActivate ? "#1a1408" : "#5a564a",
              background: canActivate
                ? "linear-gradient(180deg, #e6c366 0%, #b8923c 50%, #8a6a24 100%)"
                : "linear-gradient(180deg, #1a1b20 0%, #101116 100%)",
              border: `1px solid ${canActivate ? GOLD : "#2a2517"}`,
              boxShadow: canActivate
                ? `inset 0 1px 0 #ffe9a8, 0 0 10px ${GOLD}55`
                : "inset 0 0 8px rgba(0,0,0,0.6)",
              textShadow: canActivate ? "0 1px 0 #f6e2a0" : "none",
            }}
          >
            Activate
          </button>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        letterSpacing: 2,
        textTransform: "uppercase",
        color: GOLD,
        marginBottom: 8,
        borderBottom: "1px solid #2a2517",
        paddingBottom: 4,
      }}
    >
      {children}
    </div>
  );
}
