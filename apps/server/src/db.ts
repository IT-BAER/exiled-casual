import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Numbered, append-only. A migration runs once, inside a transaction, and bumps schema_version. */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE sessions (
    sid TEXT PRIMARY KEY,
    visitor TEXT NOT NULL,
    day TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    ended_at INTEGER,
    ip_prefix TEXT,
    country TEXT, city TEXT, region TEXT, lat REAL, lon REAL,
    browser TEXT NOT NULL, browser_family TEXT NOT NULL, os TEXT NOT NULL, mobile INTEGER NOT NULL,
    build TEXT NOT NULL, built_at INTEGER NOT NULL,
    gpu TEXT NOT NULL DEFAULT '', screen TEXT NOT NULL DEFAULT '', referrer TEXT NOT NULL DEFAULT '',
    lang TEXT NOT NULL DEFAULT '', dpr REAL NOT NULL DEFAULT 0, cores INTEGER NOT NULL DEFAULT 0,
    mem_gb REAL NOT NULL DEFAULT 0, touch INTEGER NOT NULL DEFAULT 0, pwa INTEGER NOT NULL DEFAULT 0,
    view TEXT NOT NULL DEFAULT 'boot', furthest INTEGER NOT NULL DEFAULT 0,
    area TEXT, biome TEXT, tier INTEGER, level INTEGER, class_id TEXT, fps REAL,
    play_seconds INTEGER NOT NULL DEFAULT 0, max_level INTEGER, age_days TEXT,
    game_entries INTEGER NOT NULL DEFAULT 0, new_character INTEGER NOT NULL DEFAULT 0,
    maps INTEGER NOT NULL DEFAULT 0, deaths INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX sessions_started ON sessions(started_at);
  CREATE INDEX sessions_last_seen ON sessions(last_seen);
  CREATE INDEX sessions_visitor_day ON sessions(visitor, day);
  CREATE INDEX sessions_country ON sessions(country, city);
  CREATE INDEX sessions_build ON sessions(build);

  CREATE TABLE batches (sid TEXT NOT NULL, seq INTEGER NOT NULL, t INTEGER NOT NULL, PRIMARY KEY (sid, seq)) WITHOUT ROWID;
  CREATE INDEX batches_t ON batches(t);

  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    sid TEXT NOT NULL,
    t INTEGER NOT NULL,
    k TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX events_sid ON events(sid, t);
  CREATE INDEX events_k_t ON events(k, t);
  CREATE INDEX events_t ON events(t);

  CREATE TABLE error_groups (
    fingerprint TEXT PRIMARY KEY,
    src TEXT NOT NULL,
    message TEXT NOT NULL,
    top_frame TEXT,
    last_stack TEXT,
    count INTEGER NOT NULL DEFAULT 0,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    resolved_built_at INTEGER
  );
  CREATE INDEX error_groups_first ON error_groups(first_seen);
  CREATE INDEX error_groups_last ON error_groups(last_seen);

  CREATE TABLE error_hits (
    id INTEGER PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    t INTEGER NOT NULL,
    sid TEXT NOT NULL,
    build TEXT NOT NULL,
    built_at INTEGER NOT NULL,
    browser TEXT NOT NULL,
    os TEXT NOT NULL,
    url TEXT
  );
  CREATE INDEX error_hits_fp ON error_hits(fingerprint, t);
  CREATE INDEX error_hits_t ON error_hits(t);
  CREATE INDEX error_hits_build ON error_hits(build);

  CREATE TABLE builds (
    build TEXT PRIMARY KEY,
    built_at INTEGER NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );

  CREATE TABLE liveops (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at INTEGER NOT NULL);

  CREATE TABLE admins (
    user TEXT PRIMARY KEY,
    scrypt_hash BLOB NOT NULL,
    salt BLOB NOT NULL,
    totp_secret TEXT NOT NULL,
    totp_last_step INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  );
  CREATE TABLE admin_sessions (
    token_hash TEXT PRIMARY KEY,
    user TEXT NOT NULL,
    created INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE INDEX admin_sessions_user ON admin_sessions(user);

  CREATE TABLE audit (id INTEGER PRIMARY KEY, t INTEGER NOT NULL, user TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
  CREATE INDEX audit_t ON audit(t);

  CREATE TABLE salts (day TEXT PRIMARY KEY, salt BLOB NOT NULL);

  CREATE TABLE hits (
    id INTEGER PRIMARY KEY,
    t INTEGER NOT NULL,
    ip_prefix TEXT,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    referrer TEXT NOT NULL,
    ua TEXT NOT NULL,
    bot INTEGER NOT NULL
  );
  CREATE INDEX hits_t ON hits(t);
  CREATE INDEX hits_status_t ON hits(status, t);

  CREATE TABLE log_state (name TEXT PRIMARY KEY, ino TEXT NOT NULL, offset INTEGER NOT NULL);

  CREATE TABLE metrics (kind TEXT NOT NULL, t INTEGER NOT NULL, v REAL NOT NULL, PRIMARY KEY (kind, t)) WITHOUT ROWID;

  CREATE TABLE daily (
    day TEXT PRIMARY KEY,
    sessions INTEGER NOT NULL,
    visitors INTEGER NOT NULL,
    play_seconds INTEGER NOT NULL,
    page_loads INTEGER NOT NULL,
    humans INTEGER NOT NULL,
    bots INTEGER NOT NULL
  );

  CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
];

export function openDb(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)");
  const row = db.prepare("SELECT MAX(v) AS v FROM schema_version").get() as { v: number | null } | undefined;
  let v = row?.v ?? 0;
  while (v < MIGRATIONS.length) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.prepare("INSERT INTO schema_version (v) VALUES (?)").run(v + 1);
    });
    v++;
  }
}

export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length;
