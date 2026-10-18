/** Structured logger: JSON lines to stdout (journald) plus an in-memory ring for the console. */
export interface ServerLogLine { t: number; level: string; text: string }

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  ring(): ServerLogLine[];
}

const RING = 2000;

export function createLogger(now: () => number, stdout: boolean): Logger {
  const ring: ServerLogLine[] = [];
  const write = (level: string, msg: string, fields?: Record<string, unknown>) => {
    const t = now();
    const text = fields && Object.keys(fields).length ? `${msg} ${JSON.stringify(fields)}` : msg;
    ring.push({ t, level, text });
    if (ring.length > RING) ring.splice(0, ring.length - RING);
    if (stdout) process.stdout.write(`${JSON.stringify({ t: new Date(t).toISOString(), level, msg, ...fields })}\n`);
  };
  return {
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    ring: () => ring.slice(),
  };
}
