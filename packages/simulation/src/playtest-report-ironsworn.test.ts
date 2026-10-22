import { describe, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { playtestReport } from "./playtest-report";

/** `PLAYTEST=full` writes review/playtest-report-ironsworn.md, beside the other classes' in parallel. */
describe.skipIf(process.env["PLAYTEST"] !== "full")("full playtest report", () => {
  it("writes review/playtest-report-ironsworn.md", () => {
    const out = resolve(__dirname, "../../../review/playtest-report-ironsworn.md");
    mkdirSync(resolve(out, ".."), { recursive: true });
    writeFileSync(out, playtestReport("class.ironsworn").join("\n") + "\n");
  }, 30 * 60 * 1000);
});
