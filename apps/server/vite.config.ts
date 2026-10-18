import { defineConfig } from "vite";

export default defineConfig({
  ssr: { noExternal: ["@exiled/telemetry"], target: "node" },
  build: {
    target: "node22",
    ssr: "src/main.ts",
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      external: [/^node:/],
      output: { format: "es", entryFileNames: "main.js" },
    },
  },
});
