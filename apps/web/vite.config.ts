import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Hash of every audio file's name and bytes: changes exactly when a sound does. */
function audioVersion(): string {
  const dir = fileURLToPath(new URL("./public/audio/", import.meta.url));
  const h = createHash("sha1");
  for (const f of readdirSync(dir).sort()) h.update(f).update(readFileSync(dir + f));
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
