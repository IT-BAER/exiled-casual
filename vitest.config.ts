import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.{ts,tsx}", "*.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // The mapgen and sim sweeps are CPU-bound and share six cores with every other file
    // and the playtest children: a tighter limit timed the machine's load, not a hang.
    testTimeout: 60_000,
  },
});
