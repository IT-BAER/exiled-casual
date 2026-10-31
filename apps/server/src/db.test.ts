import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { migrate, SCHEMA_VERSION } from "./db";

const T = Date.UTC(2026, 9, 28, 9, 0, 0);
const LIGHTHOUSE = "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse";
const PERSON = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** The production database as version 1 left it: hits classified by the old filter, days rolled up. */
function version1(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  migrate(db, 1);
  const hit = db.prepare("INSERT INTO hits (t, ip_prefix, method, path, status, bytes, referrer, ua, bot) VALUES (?, NULL, 'GET', ?, 200, 1, '', ?, 0)");
  hit.run(T, "/", LIGHTHOUSE);
  hit.run(T + 1, "/", PERSON);
  hit.run(T + 2, "/api/config", PERSON);
  const day = db.prepare("INSERT INTO daily (day, sessions, visitors, play_seconds, page_loads, humans, bots) VALUES (?, 1, 1, 60, ?, ?, 0)");
  day.run("2026-10-28", 2, 3);
  // A day whose raw hits are past retention: its rollup is all that is left of it.
  day.run("2026-07-01", 7, 9);
  return db;
}

describe("schema migrations", () => {
  it("brings a version 1 database forward without losing a row", () => {
    const db = version1();
    migrate(db);
    expect((db.prepare("SELECT MAX(v) AS v FROM schema_version").get() as { v: number }).v).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS n FROM hits").get()).toEqual({ n: 3 });
    // Stored hits are read again through today's bot filter.
    expect(db.prepare("SELECT ua, bot FROM hits ORDER BY t").all().map((h) => (h as { bot: number }).bot)).toEqual([1, 0, 0]);
    // A day that still has its hits is rolled up again from them; one that does not keeps its numbers.
    expect(db.prepare("SELECT day, page_loads, humans, boots, play_seconds FROM daily ORDER BY day").all()).toEqual([
      { day: "2026-07-01", page_loads: 7, humans: 9, boots: 0, play_seconds: 60 },
      { day: "2026-10-28", page_loads: 0, humans: 0, boots: 0, play_seconds: 60 },
    ]);
  });

  it("does nothing on a database that is already current", () => {
    const db = version1();
    migrate(db);
    db.prepare("UPDATE daily SET humans = 4 WHERE day = '2026-10-28'").run();
    migrate(db);
    expect(db.prepare("SELECT COUNT(*) AS n FROM schema_version").get()).toEqual({ n: 2 });
    expect(db.prepare("SELECT humans FROM daily WHERE day = '2026-10-28'").get()).toEqual({ humans: 4 });
  });
});
