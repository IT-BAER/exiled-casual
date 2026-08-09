/**
 * Build of the standalone teaser page (`soon.html`), which is what the public
 * site serves until there is a game to put there.
 *
 * Separate from the app build on purpose: `publicDir` is off and the four
 * assets the page actually asks for are copied by hand, because the game's
 * `public/` is 53 MB of models, audio and tilesets and none of it is on this
 * page. Output lands in `dist-soon/` with the entry renamed to `index.html`,
 * so any static server serves it with no config.
 */
import { copyFileSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const OUT = "dist-soon";
/** Everything `soon.html` and `soon.tsx` reference by URL. */
const ASSETS = [
  "textures/ui/menu/menu_backdrop.jpg",
  "textures/ui/menu/logo.png",
  "textures/ui/menu/gilt_metal.png",
  "fonts/cinzel-latin.woff2",
  "fonts/OFL.txt",
  "favicon.ico",
  "apple-touch-icon.png",
  // SEO/AEO surface: crawler policy, the one-URL sitemap, and the AI-agent
  // summary. Plain static files, so they ride the same copy list.
  "robots.txt",
  "sitemap.xml",
  "llms.txt",
];

export default defineConfig({
  plugins: [
    react(),
    {
      name: "soon-assets",
      closeBundle() {
        const out = resolve(__dirname, OUT);
        for (const rel of ASSETS) {
          const dest = resolve(out, rel);
          mkdirSync(dirname(dest), { recursive: true });
          copyFileSync(resolve(__dirname, "public", rel), dest);
        }
        renameSync(resolve(out, "soon.html"), resolve(out, "index.html"));
      },
    },
  ],
  publicDir: false,
  build: {
    outDir: OUT,
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, "soon.html") },
  },
});
