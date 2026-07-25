import React, { useState } from "react";
import { offerWaystones, atlasGraph, isNodeReachable, areaLevel, WAYSTONE_OFFER_COUNT } from "@exiled/rules";
import type { AtlasGraphNode } from "@exiled/rules";
import { MAP_PORTALS } from "@exiled/protocol";

interface Props {
  atlasSeed: number;
  completedNodes: string[];
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

const MAP_H = 300; // field height; width follows the panel
const NODE = 26; // medallion diameter
const CLEARED = "#7ea45c";
const FOG = "#4c463a";

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
  onSelect: (id: string) => void;
}) {
  const { nodes, completedNodes, selectedId, onSelect } = props;
  const state = (n: AtlasGraphNode) =>
    completedNodes.includes(n.id)
      ? "cleared"
      : isNodeReachable(nodes, completedNodes, n.id)
      ? "open"
      : "fog";

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
        position: "relative",
        height: MAP_H,
        marginBottom: 20,
        backgroundImage:
          "radial-gradient(ellipse at 50% 45%, rgba(52,64,46,0.55), rgba(10,12,10,0.92) 78%), url(/textures/ui/char_stone_v1.png)",
        backgroundSize: "cover, 420px",
        border: `1px solid ${GOLD_DIM}`,
        boxShadow: "inset 0 0 26px rgba(0,0,0,0.85)",
      }}
    >
      {/* Node field, inset so a medallion on the edge is not clipped. */}
      <div style={{ position: "absolute", inset: 34 }}>
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
          const accent = st === "cleared" ? CLEARED : st === "open" ? GOLD : FOG;
          return (
            <button
              key={n.id}
              data-testid={`prep-node-${n.id}`}
              disabled={st !== "open"}
              onClick={() => onSelect(n.id)}
              title={n.name}
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

export function PreparationPanel({ atlasSeed, completedNodes, onActivate, onClose }: Props) {
  const nodes = atlasGraph(atlasSeed);
  const waystones = offerWaystones(atlasSeed, WAYSTONE_OFFER_COUNT);
  const [nodeId, setNodeId] = useState<string | null>(null);
  const [wsId, setWsId] = useState<string | null>(null);
  const ws = waystones.find((w) => w.id === wsId);
  const canActivate = nodeId !== null && ws !== undefined;

  return (
    <div
      data-testid="prep-panel"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(ellipse at center, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.78) 100%)",
        pointerEvents: "auto",
        fontFamily: SERIF,
        color: PARCHMENT,
      }}
    >
      <div
        style={{
          width: 720, // the world map needs the room a tile list did not
          background: "linear-gradient(180deg, #0e0f13 0%, #100d09 100%)",
          border: `1px solid ${GOLD_DIM}`,
          boxShadow: `0 0 0 1px #000, 0 0 0 4px #1b1710, 0 0 0 5px ${GOLD_DIM}, 0 14px 48px rgba(0,0,0,0.8)`,
          padding: 0,
        }}
      >
        {/* Carved title banner (mirrors the atlas "WORLD" banner) */}
        <div
          style={{
            position: "relative",
            padding: "12px 0",
            textAlign: "center",
            background: "linear-gradient(180deg, #4a1a13 0%, #6b2018 45%, #3a1310 100%)",
            borderBottom: `1px solid ${GOLD_DIM}`,
            boxShadow: `inset 0 1px 0 ${GOLD}55, inset 0 -1px 0 #000`,
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
          <button
            data-testid="prep-close"
            onClick={onClose}
            style={{
              position: "absolute",
              top: 8,
              right: 12,
              background: "none",
              border: "none",
              color: "#c9b48a",
              cursor: "pointer",
              fontSize: 20,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: 22 }}>
          <SectionLabel>Destination</SectionLabel>
          <AtlasMap
            nodes={nodes}
            completedNodes={completedNodes}
            selectedId={nodeId}
            onSelect={setNodeId}
          />

          <SectionLabel>Waystone</SectionLabel>
          <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
            {waystones.map((w) => {
              const selected = w.id === wsId;
              return (
                <button
                  key={w.id}
                  data-testid={`prep-ws-${w.id}`}
                  onClick={() => setWsId(w.id)}
                  style={tile(selected, false, MAGIC)}
                >
                  <div style={{ fontSize: 13, color: MAGIC }}>Waystone</div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>Tier {w.tier}</div>
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
              marginBottom: 18,
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
            <span data-testid="prep-revives" style={{ letterSpacing: 0.5, color: "#b7ac8e" }}>
              Portals <b style={{ color: MAGIC }}>{MAP_PORTALS}</b>
            </span>
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
