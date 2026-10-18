import { createServer } from "node:http";
import { createApp } from "./app";
import { Admins } from "./auth";
import { openDb } from "./db";
import { seed } from "./seed";

const USAGE = `usage:
  node dist/main.js [serve]
  node dist/main.js admin add <user>        (password from EC_ADMIN_PASSWORD, >= 12 chars)
  node dist/main.js admin passwd <user>     (password from EC_ADMIN_PASSWORD)
  node dist/main.js admin totp-reset <user>
  node dist/main.js admin list
  node dist/main.js admin remove <user>
  node dist/main.js seed --db <path>        (fake data, refuses a non-empty database)

env: EC_DB (./data/ec.db), EC_INGEST_PORT (8081), EC_ADMIN_PORT (8082), EC_ADMIN_STATIC,
     EC_NGINX_LOG_DIR (/var/log/nginx), EC_NGINX_STATUS (http://127.0.0.1:8088/nginx_status),
     EC_SECURE_COOKIE (1 = Secure cookie)`;

const env = process.env;
const dbPath = () => env.EC_DB || "./data/ec.db";

function port(name: string, def: number): number {
  const raw = env[name];
  const n = raw ? Number(raw) : def;
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`${name} must be a port number`);
  return n;
}

function serve(): void {
  const app = createApp({
    db: dbPath(),
    staticDir: env.EC_ADMIN_STATIC || undefined,
    nginxLogDir: env.EC_NGINX_LOG_DIR || "/var/log/nginx",
    nginxStatusUrl: env.EC_NGINX_STATUS || "http://127.0.0.1:8088/nginx_status",
    secureCookie: env.EC_SECURE_COOKIE === "1",
  });
  const ingestPort = port("EC_INGEST_PORT", 8081);
  const adminPort = port("EC_ADMIN_PORT", 8082);
  const ingest = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, app.ingest);
  const admin = createServer({ requestTimeout: 60_000, headersTimeout: 10_000 }, app.admin);
  ingest.listen(ingestPort, "127.0.0.1", () => app.log.info("ingest listening", { port: ingestPort }));
  admin.listen(adminPort, "127.0.0.1", () => app.log.info("admin listening", { port: adminPort }));
  app.start();
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    app.log.info("stopping", { signal });
    let open = 2;
    const done = () => {
      if (--open === 0) {
        app.close();
        process.exit(0);
      }
    };
    ingest.close(done);
    admin.close(done);
    ingest.closeIdleConnections();
    admin.closeIdleConnections();
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}

function audit(db: ReturnType<typeof openDb>, action: string, detail: string): void {
  db.prepare("INSERT INTO audit (t, user, action, detail) VALUES (?, 'cli', ?, ?)").run(Date.now(), action, detail);
}

async function admin(args: string[]): Promise<void> {
  const [sub, user] = args;
  const db = openDb(dbPath());
  const admins = new Admins(db, Date.now);
  const password = () => {
    const p = env.EC_ADMIN_PASSWORD;
    if (!p) throw new Error("set EC_ADMIN_PASSWORD");
    return p;
  };
  const need = () => {
    if (!user) throw new Error(USAGE);
    return user;
  };
  try {
    switch (sub) {
      case "add": {
        const u = need();
        const { uri } = await admins.add(u, password());
        audit(db, "admin.add", u);
        console.log(`added ${u}. Scan this once into an authenticator app (it is not shown again):\n${uri}`);
        break;
      }
      case "passwd": {
        const u = need();
        await admins.passwd(u, password());
        audit(db, "admin.passwd", u);
        console.log(`password changed for ${u}; their sessions were ended`);
        break;
      }
      case "totp-reset": {
        const u = need();
        const { uri } = admins.totpReset(u);
        audit(db, "admin.totp-reset", u);
        console.log(`new TOTP secret for ${u} (shown once):\n${uri}`);
        break;
      }
      case "list":
        for (const a of admins.list()) console.log(`${a.user}\tcreated ${new Date(a.created).toISOString()}`);
        break;
      case "remove": {
        const u = need();
        if (!admins.remove(u)) throw new Error(`no admin ${u}`);
        audit(db, "admin.remove", u);
        console.log(`removed ${u}`);
        break;
      }
      default:
        throw new Error(USAGE);
    }
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const [cmd = "serve", ...rest] = process.argv.slice(2);
  switch (cmd) {
    case "serve":
      return serve();
    case "admin":
      return admin(rest);
    case "seed": {
      const i = rest.indexOf("--db");
      const path = i >= 0 ? rest[i + 1] : undefined;
      if (!path) throw new Error("seed needs --db <path>; it never writes to EC_DB implicitly");
      const r = seed(path);
      console.log(`seeded ${path}: ${r.sessions} sessions, ${r.hits} access hits, ${r.errors} error events`);
      return;
    }
    case "help":
    case "--help":
      console.log(USAGE);
      return;
    default:
      throw new Error(USAGE);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
