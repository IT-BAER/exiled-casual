import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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

export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_AUDIO_VERSION": JSON.stringify(audioVersion()),
  },
  worker: {
    format: "es",
  },
});
