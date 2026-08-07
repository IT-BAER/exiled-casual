import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "apps/**/*.test.{ts,tsx}", "*.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
