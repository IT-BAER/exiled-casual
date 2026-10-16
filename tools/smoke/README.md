# Headless smoke

Starts the Vite dev server for `apps/web` on port 5199, opens `?play&bot&map=<node>&control=mouse` in headless Chromium on SwiftShader (software WebGL) and lets the bot play. The DEV-only parameters (App.tsx, GameView.tsx) create a character on an empty roster, answer the controls dialog, and walk into the node, so no menu clicks are needed. The dev server starts with `--host 127.0.0.1 --port 5199 --strictPort`, so the run fails fast when port 5199 is already in use instead of picking another port.

After the settle time it asserts: `window.__snap.area === "map"`, the simulation tick advanced between two samples 10 s apart, 0 console errors, 0 page errors, 0 failed requests other than `net::ERR_ABORTED`. A screenshot and a JSON summary land in `smoke-out/<node>.{png,json}`. The script exits with code 1 when any node fails its assertions and 0 otherwise. The folder `smoke-out/` is listed in `.gitignore`, so screenshots and JSON summaries are never committed.

Run locally (needs `npx playwright install chromium` once):

    npm run smoke                          # default node the_wrackline
    npm run smoke -- --node blackmire      # one node by id
    npm run smoke -- --nodes all           # every atlas node, sequentially

`SMOKE_SETTLE_MS` overrides the settle time (default 30000; CI uses 60000). Node ids are the atlas names lowercased with non-alphanumerics replaced by `_`.
