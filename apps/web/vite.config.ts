import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { captureHandler } from "./src/dev/capture-endpoint";

/** Hash of every sound and music file's name and bytes: changes exactly when one does. */
function audioVersion(): string {
  const h = createHash("sha1");
  for (const sub of ["audio", "music"]) {
    const dir = fileURLToPath(new URL(`./public/${sub}/`, import.meta.url));
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) h.update(sub + f).update(readFileSync(dir + f));
  }
  return h.digest("hex").slice(0, 10);
}

/** `<package version>+<short commit>`, `+dev` when there is no git. */
function buildId(): string {
  const { version } = JSON.parse(readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf8")) as { version: string };
  try {
    return `${version}+${execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim()}`;
  } catch {
    return `${version}+dev`;
  }
}

/** DEV: `__dev.capture()` writes the canvas under docs/todo/playtest/. `vite serve` only. */
function playtestCapture(): Plugin {
  const root = fileURLToPath(new URL("../../docs/todo/playtest/", import.meta.url));
  return {
    name: "playtest-capture",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__capture", captureHandler(root));
    },
  };
}

export default defineConfig({
  plugins: [react(), playtestCapture()],
  define: {
    "import.meta.env.VITE_AUDIO_VERSION": JSON.stringify(audioVersion()),
    "import.meta.env.VITE_EC_BUILD": JSON.stringify(buildId()),
    "import.meta.env.VITE_EC_BUILT_AT": JSON.stringify(String(Date.now())),
  },
  server: {
    // Telemetry and live ops, when the game server runs beside the dev server.
    proxy: { "/api": "http://127.0.0.1:8081" },
  },
  worker: {
    format: "es",
  },
});
