import { describe, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parityReport } from "./playtest-parity";

/** `PLAYTEST=parity` writes review/playtest-parity.md: every class, stock and kit, on the seeds of record. */
describe.skipIf(process.env["PLAYTEST"] !== "parity")("class parity report", () => {
  it("writes review/playtest-parity.md", async () => {
    const out = resolve(__dirname, "../../../review/playtest-parity.md");
    mkdirSync(resolve(out, ".."), { recursive: true });
    writeFileSync(out, (await parityReport()).join("\n") + "\n");
  }, 120 * 60 * 1000);
});
