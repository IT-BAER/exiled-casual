import React, { useState } from "react";
import {
  atlasGraph, isNodeReachable, areaLevel, atlasNodeTier, mapBaseIdForNode,
  waystoneRarity, type WaystoneRarity,
} from "@exiled/rules";
// protocol-augment.d.ts ensures DisplayItem.waystone is typed; no import needed.
import type { AtlasGraphNode } from "@exiled/rules";
import { biomeOf } from "@exiled/content-runtime";
import { MAP_PORTALS } from "@exiled/protocol";

/** Stone currently placed in the socket: the inventory cell it came from plus its rolled stats. */
export interface SocketedStone {
  seed: number;
  tier: number;
  /** Backpack grid cell the stone was dragged from — carried on activate. */
  x: number;
  y: number;
}

interface Props {
  atlasSeed: number;
  completedNodes: string[];
  /** Stone currently seated in the socket, null while empty. Managed by the parent. */
  socketedStone: SocketedStone | null;
  onEject: () => void;
  onActivate: (atlasNodeId: string, x: number, y: number) => void;
  /** Called when the player clicks a reachable atlas node (to let the parent open the inventory). */
  onNodeSelect?: () => void;
  /**
   * A run is already open. The device still works — activating a different place
   * abandons the open one — but that is not something to find out afterwards, so
   * the button says REPLACE MAP and the panel says what it costs.
   */
  mapOpen?: boolean;
  onClose: () => void;
}

// PoE2 map-device look: aged near-black panel behind an ornate gold frame, a
// carved red-brown title banner, engraved small-caps serif, item-tile choices.
// Matches reference-screenshots/atlas-maps.webp (banner + gilt frame) and
// portals-map-device.webp (Map Device / waystone naming).
const SERIF = '"Cinzel", "Trajan Pro", Georgia, "Times New Roman", serif';
const GOLD = "#c8a44d";
const GOLD_DIM = "#7a5c22";
const PARCHMENT = "#e8dcc0";
const MAGIC = "#8aa6ff"; // waystone (magic item) tint, as in PoE rarity
const FLAVOUR = "#c98a3e"; // the Atlas panel's amber lore line
/** PoE's own item-rarity palette, the same one ItemTooltip tints a drop with. */
const RARITY_TINT: Record<WaystoneRarity, string> = { normal: "#c8c8c8", magic: MAGIC, rare: "#e6d64a" };

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
  /** The open place's panel, drawn in the node field so it can anchor to a node. */
  popup: React.ReactNode;
}) {
  const { nodes, completedNodes, selectedId, stoneTier, onSelect, popup } = props;
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
          "radial-gradient(ellipse at 50% 45%, rgba(4,6,6,0.3) 35%, rgba(6,8,8,0.9) 100%),url(/textures/ui/atlas_world_v1.jpg), url(/textures/ui/char_stone_v1.png)",
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
                  // Painted terrain under the plate now, and pale sand is the
                  // worst case: a fogged name has to stay readable over it.
                  background: "rgba(8,9,7,0.86)",
                  color: st === "fog" ? "#8b8477" : st === "cleared" ? CLEARED : PARCHMENT,
                  textShadow: "0 1px 3px #000",
                  pointerEvents: "none",
                }}
              >
                {n.name}
              </span>
            </button>
          );
        })}
        {popup}
      </div>
    </div>
  );
}

/** atlas_node_header_v1.png is 512x72; the band keeps that ratio or the filigree shears. */
const POPUP_W = 340;
const HEADER_H = Math.round((POPUP_W * 72) / 512);
/**
 * atlas_node_socket_v2.png is 512x464 and its disc fills 76% of that width, so this
 * puts the disc at 40% of the panel, which is the ratio in poe2-atlas-node-popup.png.
 * v1 was scrapped for an oval ring: it measured 802 wide by 668 tall.
 */
const SOCKET_W = 180;
const SOCKET_H = Math.round((SOCKET_W * 464) / 512);
/** The empty slot in that art: x 189..322, y 125..264, so the stone fills the hole. */
const SLOT_W = Math.round((SOCKET_W * (322 - 189)) / 512);
const SLOT_H = Math.round((SOCKET_H * (264 - 125)) / 464);

/**
 * A place, opened. PoE2's Atlas answers a click on a node with a small panel
 * standing on the node itself — name, a line of lore, one socket for the stone
 * and the button — rather than with a form somewhere else on the screen. That
 * anchoring is the whole point: what you are about to commit to is drawn on the
 * spot on the map you are committing to, so the choice stays a choice about a
 * place. Reference: the PoE2 Atlas node panel (dark plate, gilt filigree band,
 * amber lore, carved socket over the medallion).
 */
function NodePopup(props: {
  node: AtlasGraphNode;
  requiredTier: number;
  stone: { seed: number; tier: number } | undefined;
  underTier: boolean;
  replaces: boolean;
  onEject: () => void;
  onActivate: () => void;
}) {
  const { node, requiredTier, stone, underTier, replaces, onEject, onActivate } = props;
  const canActivate = stone !== undefined && !underTier;
  // Above the medallion where there is room, below it near the top edge: the
  // panel must never cover the node it belongs to, which is what tells you
  // which place is open.
  // Below has further to fall than above has to rise: the medallion wears its
  // name plate underneath, and covering the name of the place you just opened is
  // the one thing this panel must not do.
  const below = node.y < 0.42;
  const anchorY = below
    ? { top: `calc(${(node.y * 100).toFixed(2)}% + ${NODE + 26}px)` }
    : { bottom: `calc(${(100 - node.y * 100).toFixed(2)}% + ${NODE}px)` };
  // Nodes can sit within half a panel of the field's edge; the anchor is pulled
  // in so the panel stays on screen rather than half off it.
  const ax = Math.min(88, Math.max(12, node.x * 100));

  return (
    <div
      data-testid="prep-popup"
      style={{
        position: "absolute",
        left: `${ax.toFixed(2)}%`,
        ...anchorY,
        transform: "translateX(-50%)",
        width: POPUP_W,
        zIndex: 3,
        textAlign: "center",
        // Straight sides, no bottom edge, no border: the reference's panel hangs
        // off its header band and fades into the ground under the node, so the map
        // and the panel stay one picture instead of a dialog dropped on top.
        background:
          "linear-gradient(180deg, rgba(7,8,10,0.94) 0%, rgba(7,8,10,0.9) 62%, rgba(7,8,10,0) 100%)",
        paddingBottom: 14,
      }}
    >
      <div
        style={{
          height: HEADER_H,
          backgroundImage: "url(/textures/ui/atlas_node_header_v1.png)",
          backgroundSize: "100% 100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          data-testid="prep-popup-name"
          style={{
            fontSize: 17,
            letterSpacing: 1.2,
            color: GOLD,
            textShadow: "0 1px 3px #000",
            padding: "0 44px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {node.name}
        </span>
      </div>

      {/* What the place is made of, directly under its name. The reference has
          no such line — PoE2 lets the node's icon carry it — but our nodes have
          no icons yet, and a player choosing between two names deserves to know
          one is a swamp. Small, muted, and above the hairline so it reads as
          part of the name rather than as a stat. */}
      <div
        data-testid="prep-popup-biome"
        style={{
          textAlign: "center",
          fontSize: 10,
          letterSpacing: 2.4,
          textTransform: "uppercase",
          color: GOLD_DIM,
          padding: "5px 0 1px",
        }}
      >
        {biomeOf(mapBaseIdForNode(node.id)).name}
      </div>

      {/* The lore sits between two hairlines in the reference, not under one. */}
      <div style={{ height: 1, margin: "0 18px", background: `${GOLD}22` }} />

      {/* The rumour, in the reference's amber. It is the only line here that is
          not a number, and it is what makes a node a destination. */}
      <div
        style={{
          padding: "12px 26px 14px",
          fontSize: 13,
          lineHeight: 1.5,
          color: FLAVOUR,
          textShadow: "0 1px 3px #000",
        }}
      >
        {node.flavour}
      </div>

      <div style={{ height: 1, margin: "0 18px", background: `${GOLD}22` }} />

      {/* One socket, because a run takes one stone. Clicking it takes the stone
          back out, which is the only way to change your mind without closing
          the place and losing your place on the map. */}
      <button
        data-testid="prep-socket"
        data-drop-socket=""
        onClick={onEject}
        title={stone ? "Take the Waystone back out" : "Drag a Waystone here from your inventory"}
        style={{
          width: SOCKET_W,
          height: SOCKET_H,
          margin: "10px auto 6px",
          display: "block",
          position: "relative",
          padding: 0,
          border: "none",
          background: "url(/textures/ui/atlas_node_socket_v2.png) center/100% 100% no-repeat",
        }}
      >
        {stone && (
          // Seated a shade over the beaded moulding rather than inside it: at the
          // slot's own 47px the icon's sigil goes to a smudge, and a stone resting
          // on the frame is what "placed" looks like. The tier is a number and
          // lives with the other numbers below, as it does in the reference.
          <span
            data-testid="prep-socket-stone"
            style={{
              position: "absolute",
              left: "49.9%",
              top: "41.9%",
              transform: "translate(-50%, -50%)",
              width: Math.round(SLOT_W * 1.15),
              height: Math.round(SLOT_H * 1.15),
              backgroundImage: "url(/textures/ui/waystone_icon_v1.png)",
              backgroundSize: "contain",
              backgroundPosition: "center",
              backgroundRepeat: "no-repeat",
              filter: `drop-shadow(0 0 6px ${RARITY_TINT[waystoneRarity(stone.seed)]}55)`,
            }}
          />
        )}
      </button>

      <div style={{ fontSize: 12, letterSpacing: 0.6, marginBottom: 10 }}>
        {underTier ? (
          <span data-testid="prep-undertier" style={{ color: UNDER_TIER }}>
            Needs a Tier <b>{requiredTier}</b> Waystone
          </span>
        ) : (
          <span data-testid="prep-arealevel" style={{ color: "#b7ac8e" }}>
            {stone && (
              <span style={{ color: RARITY_TINT[waystoneRarity(stone.seed)] }}>
                Tier <b>{stone.tier}</b>
                <span style={{ color: "#7c7361" }}>{"  ·  "}</span>
              </span>
            )}
            Area Level{" "}
            <b style={{ color: stone ? GOLD : "#5a564a" }}>{stone ? areaLevel(stone.tier) : "—"}</b>
            {stone && <span style={{ color: "#7c7361" }}>{"  ·  "}Portals <b style={{ color: MAGIC }}>{MAP_PORTALS}</b></span>}
          </span>
        )}
      </div>

      <button
        data-testid="prep-activate"
        disabled={!canActivate}
        onClick={onActivate}
        style={{
          display: "block",
          width: 168,
          margin: "0 auto",
          padding: "8px 0",
          borderRadius: 2,
          fontFamily: SERIF,
          fontSize: 13,
          letterSpacing: 2.5,
          textTransform: "uppercase",
          // Dark slate plate with a gilt bevel, per the reference: the button is
          // trim on the panel, not a gold slab that outshouts the lore.
          background: canActivate
            ? "linear-gradient(180deg, #2b3038 0%, #171a20 55%, #0f1116 100%)"
            : "linear-gradient(180deg, #191b1f 0%, #0e0f13 100%)",
          border: `1px solid ${canActivate ? GOLD_DIM : "#241f14"}`,
          boxShadow: canActivate
            ? `inset 0 1px 0 ${GOLD}44, inset 0 0 12px rgba(0,0,0,0.7), 0 0 10px rgba(0,0,0,0.6)`
            : "inset 0 0 8px rgba(0,0,0,0.7)",
          color: canActivate ? "#e2cb92" : "#5a564a",
          textShadow: canActivate ? `0 0 8px ${GOLD}66, 0 1px 2px #000` : "none",
        }}
      >
        {replaces ? "Replace Map" : "Activate"}
      </button>
      {replaces && (
        <div style={{
          marginTop: 8, textAlign: "center", fontFamily: SERIF, fontSize: 11,
          letterSpacing: 0.4, color: "#a8794f",
        }}>
          Abandons the map you have open.
        </div>
      )}
    </div>
  );
}

export function PreparationPanel({ atlasSeed, completedNodes, socketedStone, onEject, onActivate, onNodeSelect, mapOpen = false, onClose }: Props) {
  const nodes = atlasGraph(atlasSeed);
  const [nodeId, setNodeId] = useState<string | null>(null);
  // The place has to accept the stone. Selecting a node and then a weaker stone
  // is an easy way to end up here, so the button says no rather than firing an
  // intent the sim would drop on the floor.
  const node = nodes.find((n) => n.id === nodeId);
  const requiredTier = node === undefined ? null : atlasNodeTier(nodes, node.id);
  const underTier = socketedStone !== null && requiredTier !== null && socketedStone.tier < requiredTier;
  const canActivate = node !== undefined && socketedStone !== null && !underTier;

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
        stoneTier={socketedStone?.tier ?? null}
        // Clicking the open place again shuts it, so the map can be read without
        // a panel standing on it.
        onSelect={(id) => {
          const opening = id !== nodeId;
          setNodeId((cur) => (cur === id ? null : id));
          if (opening) onNodeSelect?.();
        }}
        popup={
          node !== undefined && requiredTier !== null ? (
            <NodePopup
              node={node}
              requiredTier={requiredTier}
              stone={socketedStone ?? undefined}
              underTier={underTier}
              replaces={mapOpen}
              onEject={onEject}
              onActivate={() => {
                if (canActivate && socketedStone) onActivate(node.id, socketedStone.x, socketedStone.y);
              }}
            />
          ) : null
        }
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
          fontSize: 20,
          lineHeight: 1,
        }}
      >
        ×
      </button>

    </div>
  );
}
