import { createReadStream, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** Game art and fonts the console wears, read from the game's public dir so git holds them once. */
export const GAME_ART = [
  "fonts/marcellus-latin.woff2",
  "fonts/marcellus-sc-latin.woff2",
  "fonts/OFL.txt",
  "textures/ui/menu/logo.webp",
  "textures/ui/menu/logo-512.webp",
  "textures/ui/menu/panel_frame.webp",
  "textures/ui/menu/divider.webp",
  "textures/ui/menu/gilt_metal.webp",
  "textures/ui/menu/tooltip_header_normal.webp",
  "textures/ui/menu/tooltip_header_magic.webp",
  "textures/ui/menu/tooltip_header_rare.webp",
  "textures/ui/menu/tooltip_header_unique.webp",
  "textures/ui/menu/row_plate.webp",
  "textures/ui/menu/tab_plate.webp",
  "textures/ui/atlas_world_v1.jpg",
  "favicon.ico",
  "icon-192.png",
];

const GAME_PUBLIC = fileURLToPath(new URL("../web/public/", import.meta.url));

const TYPES: Record<string, string> = {
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  webp: "image/webp",
  jpg: "image/jpeg",
  ico: "image/x-icon",
};

/** Serves GAME_ART in dev and emits it at the same relative paths in the build. */
function gameArt(): Plugin {
  return {
    name: "exiled-game-art",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = decodeURIComponent((req.url ?? "").split("?")[0] ?? "").replace(/^\/+/, "");
        if (!GAME_ART.includes(path)) return next();
        res.setHeader("Content-Type", TYPES[path.split(".").pop() ?? ""] ?? "application/octet-stream");
        createReadStream(GAME_PUBLIC + path).on("error", next).pipe(res);
      });
    },
    generateBundle() {
      for (const fileName of GAME_ART) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(GAME_PUBLIC + fileName) });
      }
    },
  };
}

export default defineConfig({
  // Relative, so the console works under whatever prefix the server mounts it at (hash routing).
  base: "./",
  plugins: [react(), gameArt()],
  server: {
    proxy: { "/admin/api": "http://127.0.0.1:8082" },
  },
});
