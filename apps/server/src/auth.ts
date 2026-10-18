import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { base32Decode, base32Encode, verifyTotp } from "./totp";

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 128 * (1 << 15) * 8 * 2 };
const KEY_LEN = 64;
export const MIN_PASSWORD = 12;
export const IDLE_MS = 12 * 3_600_000;
export const ABSOLUTE_MS = 7 * 86_400_000;
const ISSUER = "Exiled Casual Admin";

function scryptAsync(password: string, salt: Uint8Array): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

interface AdminRow { user: string; scrypt_hash: Uint8Array; salt: Uint8Array; totp_secret: string; totp_last_step: number; created: number }

export type LoginResult = { ok: true; token: string; since: number } | { ok: false };

export class Admins {
  /** Burned on unknown users so the response time does not reveal which names exist. */
  private readonly dummySalt = randomBytes(16);
  constructor(private readonly db: DatabaseSync, private readonly now: () => number) {}

  private row(user: string): AdminRow | undefined {
    return this.db.prepare("SELECT * FROM admins WHERE user = ?").get(user) as AdminRow | undefined;
  }

  private static otpauth(user: string, secret: string): string {
    return `otpauth://totp/${encodeURIComponent(`${ISSUER}:${user}`)}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30`;
  }

  async add(user: string, password: string): Promise<{ uri: string; secret: string }> {
    if (!/^[A-Za-z0-9_.-]{1,40}$/.test(user)) throw new Error("user must be 1-40 of [A-Za-z0-9_.-]");
    if (password.length < MIN_PASSWORD) throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
    if (this.row(user)) throw new Error(`admin ${user} already exists`);
    const salt = randomBytes(16);
    const hash = await scryptAsync(password, salt);
    const secret = base32Encode(randomBytes(20));
    this.db.prepare("INSERT INTO admins (user, scrypt_hash, salt, totp_secret, created) VALUES (?, ?, ?, ?, ?)").run(user, hash, salt, secret, this.now());
    return { uri: Admins.otpauth(user, secret), secret };
  }

  async passwd(user: string, password: string): Promise<void> {
    if (!this.row(user)) throw new Error(`no admin ${user}`);
    if (password.length < MIN_PASSWORD) throw new Error(`password must be at least ${MIN_PASSWORD} characters`);
    const salt = randomBytes(16);
    const hash = await scryptAsync(password, salt);
    this.db.prepare("UPDATE admins SET scrypt_hash = ?, salt = ? WHERE user = ?").run(hash, salt, user);
    this.db.prepare("DELETE FROM admin_sessions WHERE user = ?").run(user);
  }

  totpReset(user: string): { uri: string; secret: string } {
    if (!this.row(user)) throw new Error(`no admin ${user}`);
    const secret = base32Encode(randomBytes(20));
    this.db.prepare("UPDATE admins SET totp_secret = ?, totp_last_step = 0 WHERE user = ?").run(secret, user);
    this.db.prepare("DELETE FROM admin_sessions WHERE user = ?").run(user);
    return { uri: Admins.otpauth(user, secret), secret };
  }

  list(): { user: string; created: number }[] {
    return this.db.prepare("SELECT user, created FROM admins ORDER BY user").all() as { user: string; created: number }[];
  }

  remove(user: string): boolean {
    this.db.prepare("DELETE FROM admin_sessions WHERE user = ?").run(user);
    return this.db.prepare("DELETE FROM admins WHERE user = ?").run(user).changes > 0;
  }

  /** Password, then TOTP; a step already used (or older) is refused. One outcome for every failure. */
  async login(user: string, password: string, code: string): Promise<LoginResult> {
    const row = this.row(user);
    const key = await scryptAsync(password, row?.salt ?? this.dummySalt);
    if (!row) return { ok: false };
    const stored = Buffer.from(row.scrypt_hash);
    if (stored.length !== key.length || !timingSafeEqual(stored, key)) return { ok: false };
    const step = verifyTotp(base32Decode(row.totp_secret), code, this.now());
    if (step === null || step <= row.totp_last_step) return { ok: false };
    const used = this.db.prepare("UPDATE admins SET totp_last_step = ? WHERE user = ? AND totp_last_step < ?").run(step, user, step);
    if (used.changes === 0) return { ok: false };
    const token = randomBytes(32).toString("base64url");
    const since = this.now();
    this.db.prepare("INSERT INTO admin_sessions (token_hash, user, created, last_seen) VALUES (?, ?, ?, ?)").run(sha256(token), user, since, since);
    return { ok: true, token, since };
  }

  /** The admin behind a cookie token, sliding the idle window; null when absent or expired. */
  session(token: string | undefined): { user: string; since: number } | null {
    if (!token) return null;
    const h = sha256(token);
    const row = this.db.prepare("SELECT user, created, last_seen FROM admin_sessions WHERE token_hash = ?").get(h) as
      { user: string; created: number; last_seen: number } | undefined;
    if (!row) return null;
    const now = this.now();
    if (now - row.last_seen > IDLE_MS || now - row.created > ABSOLUTE_MS) {
      this.db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(h);
      return null;
    }
    this.db.prepare("UPDATE admin_sessions SET last_seen = ? WHERE token_hash = ?").run(now, h);
    return { user: row.user, since: row.created };
  }

  logout(token: string | undefined): void {
    if (token) this.db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(sha256(token));
  }

  purgeExpired(): void {
    const now = this.now();
    this.db.prepare("DELETE FROM admin_sessions WHERE last_seen < ? OR created < ?").run(now - IDLE_MS, now - ABSOLUTE_MS);
  }
}
