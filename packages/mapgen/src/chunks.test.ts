import { describe, it, expect } from "vitest";
import {
  TILE_CELLS,
  rotateRows,
  mirrorRows,
  rotateMask,
  mirrorMask,
  deriveMask,
  derivePorts,
  validateChunk,
  orientations,
  type Chunk,
} from "./chunks";
import { LOOP_GRAMMAR, maskClass } from "./loop-grammar";

/** A minimal north-open tile: the 6..9 stub down to a small room. */
const CAP_N: Chunk = {
  id: "test.cap",
  rows: [
    "######....######",
    "######....######",
    "######....######",
    "######....######",
    "######....######",
    "######....######",
    "##............##",
    "##............##",
    "##............##",
    "##............##",
    "################",
    "################",
    "################",
    "################",
    "################",
    "################",
  ],
};

describe("chunk transforms", () => {
  it("rotates rows 90 degrees clockwise", () => {
    const src = ["ab", "cd"];
    // top-left goes to top-right: [[a,b],[c,d]] -> [[c,a],[d,b]]
    expect(rotateRows(src)).toEqual(["ca", "db"]);
  });

  it("mirrors rows horizontally", () => {
    expect(mirrorRows(["ab", "cd"])).toEqual(["ba", "dc"]);
  });

  it("derives a north-only mask from the border", () => {
    expect(deriveMask(CAP_N.rows)).toBe(1);
    expect(derivePorts(CAP_N.rows)).toEqual([{ side: 0, index: 0 }]);
  });

  it("rotation of the rows equals rotation of the mask", () => {
    let rows = CAP_N.rows;
    for (let turns = 1; turns <= 4; turns++) {
      rows = rotateRows(rows);
      expect(deriveMask(rows), `after ${turns} turns`).toBe(
        rotateMask(deriveMask(CAP_N.rows), turns % 4),
      );
    }
  });

  it("mirroring the rows equals mirroring the mask", () => {
    expect(deriveMask(mirrorRows(CAP_N.rows))).toBe(mirrorMask(deriveMask(CAP_N.rows)));
  });

  it("four rotations return the original rows", () => {
    expect(rotateRows(rotateRows(rotateRows(rotateRows(CAP_N.rows))))).toEqual(CAP_N.rows);
  });

  it("accepts a well-formed chunk", () => {
    expect(validateChunk(CAP_N)).toEqual([]);
    expect(TILE_CELLS).toBe(16);
  });

  it("rejects an opening that is not the centred 6..9 window", () => {
    const offset = { ...CAP_N, rows: ["#####....#######", ...CAP_N.rows.slice(1)] };
    expect(validateChunk(offset).length).toBeGreaterThan(0);
  });

  it("rejects a chunk with a sealed floor pocket", () => {
    const sealed = CAP_N.rows.slice();
    // Carve an isolated 1-cell room in the solid southern half.
    sealed[13] = "#######..#######";
    expect(validateChunk({ id: "test.sealed", rows: sealed }).length).toBeGreaterThan(0);
  });

  it("enumerates deduped orientations, each matching its own derived mask", () => {
    const os = orientations(CAP_N);
    expect(os.length).toBe(4); // a cap is mirror-symmetric, so 8 transforms collapse to 4
    const masks = os.map((o) => o.mask).sort((a, b) => a - b);
    expect(masks).toEqual([1, 2, 4, 8]);
    for (const o of os) expect(deriveMask(o.rows)).toBe(o.mask);
  });
});

describe("loop grammar library", () => {
  it("classifies masks by their open-edge shape", () => {
    expect(maskClass(0b0000)).toBe("solid");
    expect(maskClass(0b0001)).toBe("cap");     // N
    expect(maskClass(0b0101)).toBe("straight");// N|S
    expect(maskClass(0b1010)).toBe("straight");// E|W
    expect(maskClass(0b0011)).toBe("corner");  // N|E
    expect(maskClass(0b0111)).toBe("tee");     // N|E|S
    expect(maskClass(0b1111)).toBe("cross");
  });

  it("every authored chunk is structurally valid", () => {
    for (const c of [...LOOP_GRAMMAR.chunks, LOOP_GRAMMAR.bossChunk]) {
      expect(validateChunk(c), c.id).toEqual([]);
    }
  });

  it("covers every non-solid mask class", () => {
    const covered = new Set(LOOP_GRAMMAR.chunks.map((c) => maskClass(deriveMask(c.rows))));
    expect([...covered].sort()).toEqual(["cap", "corner", "cross", "straight", "tee"]);
  });

  it("can orient a chunk onto every one of the 15 non-solid masks", () => {
    for (let mask = 1; mask <= 15; mask++) {
      const fits = LOOP_GRAMMAR.chunks.flatMap(orientations).filter((o) => o.mask === mask);
      expect(fits.length, `mask ${mask} has no chunk`).toBeGreaterThan(0);
    }
  });

  it("the boss arena is 2x2 tiles with exactly one port", () => {
    const { rows } = LOOP_GRAMMAR.bossChunk;
    expect(rows.length).toBe(TILE_CELLS * 2);
    expect(derivePorts(rows)).toEqual([{ side: 0, index: 0 }]);
  });

  it("the boss arena's 8 orientations cover all 8 possible ports", () => {
    const ports = orientations(LOOP_GRAMMAR.bossChunk).map((o) => `${o.ports[0]!.side}.${o.ports[0]!.index}`);
    expect(new Set(ports).size).toBe(8);
    expect(ports.length).toBe(8);
  });

  it("the boss arena carries exactly one boss and one exit marker", () => {
    const flat = LOOP_GRAMMAR.bossChunk.rows.join("");
    expect(flat.split("b").length - 1).toBe(1);
    expect(flat.split("e").length - 1).toBe(1);
  });

  it("every chunk that is not a cap carries at least one spawn point", () => {
    for (const c of LOOP_GRAMMAR.chunks) {
      if (maskClass(deriveMask(c.rows)) === "cap") continue;
      expect(c.rows.join("").includes("s"), `${c.id} has no spawn point`).toBe(true);
    }
  });

  it("carries three variants of every mask class", () => {
    const counts = new Map<string, number>();
    for (const c of LOOP_GRAMMAR.chunks) {
      const cls = maskClass(deriveMask(c.rows));
      counts.set(cls, (counts.get(cls) ?? 0) + 1);
    }
    for (const cls of ["cap", "straight", "corner", "tee", "cross"]) {
      expect(counts.get(cls), `${cls} variants`).toBe(3);
    }
    expect(LOOP_GRAMMAR.chunks.length).toBe(15);
  });

  it("gives every chunk a distinct id and distinct geometry", () => {
    const ids = LOOP_GRAMMAR.chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const shapes = LOOP_GRAMMAR.chunks.map((c) => c.rows.join("\n"));
    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it("every cap carries a reward point, because caps are the dead ends", () => {
    for (const c of LOOP_GRAMMAR.chunks) {
      if (maskClass(deriveMask(c.rows)) !== "cap") continue;
      expect(c.rows.join("").includes("r"), `${c.id} has no reward point`).toBe(true);
    }
  });
});
