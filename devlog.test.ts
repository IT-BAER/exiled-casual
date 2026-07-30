import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const devlogPath = resolve("devlog/README.md");
const devlog = readFileSync(devlogPath, "utf8");

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[^;]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("devlog", () => {
  it("keeps one short caption for every screenshot", () => {
    const screenshots = [...devlog.matchAll(/<img src="screenshots\/([^"]+)"/g)];
    const captions = [...devlog.matchAll(/<sub>(.*?)<\/sub>/gs)];

    expect(captions).toHaveLength(screenshots.length);

    for (const match of captions) {
      const caption = match[1];
      expect(caption).toBeDefined();
      if (caption === undefined) continue;

      const words = plainText(caption).split(" ");
      expect(words.length, plainText(caption)).toBeLessThanOrEqual(18);
    }
  });

  it("only references screenshots that exist", () => {
    const screenshots = [...devlog.matchAll(/<img src="screenshots\/([^"]+)"/g)];

    for (const match of screenshots) {
      const screenshot = match[1];
      expect(screenshot).toBeDefined();
      if (screenshot === undefined) continue;

      expect(existsSync(resolve("devlog/screenshots", screenshot)), screenshot).toBe(true);
    }
  });

  it("keeps every row in a screenshot table on the same column grid", () => {
    const tables = [...devlog.matchAll(/<table>(.*?)<\/table>/gs)];

    for (const tableMatch of tables) {
      const table = tableMatch[1];
      expect(table).toBeDefined();
      if (table === undefined) continue;

      const columnCounts = [...table.matchAll(/<tr>(.*?)<\/tr>/gs)].map((rowMatch) => {
        const row = rowMatch[1];
        expect(row).toBeDefined();
        if (row === undefined) return 0;
        return [...row.matchAll(/<td\b/g)].length;
      });

      expect(new Set(columnCounts).size, columnCounts.join(",")).toBe(1);
    }
  });
});
