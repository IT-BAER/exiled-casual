import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The router's shape, read off its own source.
 *
 * Everything else about `App.tsx` is behaviour a render test can see. This one
 * is not: a static `import { GameView }` behaves identically at runtime and in
 * jsdom, and only shows up as a build artefact — the entry chunk going from
 * 212 kB back to 5.5 MB, because `GameView` and `MenuStage` are the only two
 * things in the client that reach `@babylonjs/core`.
 *
 * That is a regression nobody notices from the inside, which is why it is
 * pinned here rather than left to a chunk-size eyeball after the fact. The
 * check is deliberately about the IMPORT and not about `React.lazy`: a type-only
 * import is fine and erases, a value import is not.
 */
const SRC = readFileSync(resolve(__dirname, "App.tsx"), "utf8");

describe("App's bundle shape", () => {
  it.each(["./GameView", "./menu/MenuStage"])(
    "reaches %s only through a dynamic import",
    (mod) => {
      // A static value import: `import ... from "<mod>"`, with `import type` allowed.
      const statik = new RegExp(`^\\s*import\\s+(?!type\\b)[^;]*?from\\s+["']${mod}["']`, "m");
      expect(SRC).not.toMatch(statik);
      expect(SRC).toContain(`import("${mod}")`);
    },
  );

  it("keeps Babylon out of the router itself", () => {
    // The other door to the same regression: importing Babylon here directly
    // rather than through one of those two. Matched as an import and not as a
    // bare string, or the comment above the lazy pair fails its own test.
    expect(SRC).not.toMatch(/from\s+["']@babylonjs/);
  });
});
