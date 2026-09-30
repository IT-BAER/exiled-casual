import React from "react";
import type { MonsterElement } from "@exiled/protocol";

/** A damage type's painted glyph, sliced by tools/build_element_icons.py at 64px. */
export function ElementIcon({ of, size = 20 }: { of: MonsterElement; size?: number }) {
  return (
    <img
      src={`/hud/elements/${of}.webp`}
      alt=""
      aria-hidden="true"
      data-element={of}
      width={size}
      height={size}
      style={{ flex: "none", verticalAlign: "middle", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.9))" }}
    />
  );
}
