import { readFileSync, statfsSync } from "node:fs";
import os from "node:os";

export interface HostSample {
  cpuPct: number;
  load: [number, number, number];
  cores: number;
  memUsedMb: number;
  memTotalMb: number;
  diskUsedGb: number;
  diskTotalGb: number;
  uptimeSeconds: number;
}

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** Busy and total jiffies from /proc/stat, or os.cpus() times where /proc does not exist. */
function cpuTimes(): { busy: number; total: number } {
  const stat = read("/proc/stat");
  const line = stat?.split("\n").find((l) => l.startsWith("cpu "));
  if (line) {
    const v = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = (v[3] ?? 0) + (v[4] ?? 0);
    const total = v.slice(0, 8).reduce((a, b) => a + b, 0);
    return { busy: total - idle, total };
  }
  let busy = 0, total = 0;
  for (const c of os.cpus()) {
    const t = c.times.user + c.times.nice + c.times.sys + c.times.irq + c.times.idle;
    total += t;
    busy += t - c.times.idle;
  }
  return { busy, total };
}

const MB = 1024 * 1024;
const GB = MB * 1024;

export class HostMonitor {
  private prev = cpuTimes();

  sample(): HostSample {
    const cur = cpuTimes();
    const dt = cur.total - this.prev.total;
    const cpuPct = dt > 0 ? Math.round(((cur.busy - this.prev.busy) / dt) * 1000) / 10 : 0;
    this.prev = cur;

    const loadavg = read("/proc/loadavg");
    const load = (loadavg ? loadavg.split(" ").slice(0, 3).map(Number) : os.loadavg()) as [number, number, number];

    let memTotal = os.totalmem(), memAvail = os.freemem();
    const meminfo = read("/proc/meminfo");
    if (meminfo) {
      const kb = (k: string) => Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(meminfo)?.[1] ?? NaN) * 1024;
      const t = kb("MemTotal"), a = kb("MemAvailable");
      if (Number.isFinite(t) && Number.isFinite(a)) { memTotal = t; memAvail = a; }
    }

    let diskTotal = 0, diskUsed = 0;
    try {
      const s = statfsSync("/");
      diskTotal = s.blocks * s.bsize;
      diskUsed = (s.blocks - s.bfree) * s.bsize;
    } catch {
      /* no statfs on this platform: reported as 0 */
    }

    const uptime = read("/proc/uptime");
    return {
      cpuPct,
      load,
      cores: os.availableParallelism(),
      memUsedMb: Math.round((memTotal - memAvail) / MB),
      memTotalMb: Math.round(memTotal / MB),
      diskUsedGb: Math.round((diskUsed / GB) * 10) / 10,
      diskTotalGb: Math.round((diskTotal / GB) * 10) / 10,
      uptimeSeconds: Math.round(uptime ? Number(uptime.split(" ")[0]) : os.uptime()),
    };
  }
}

export interface NginxStatus { active: number; requests: number; t: number }

/** stub_status: "Active connections: N" and the accepts/handled/requests counters line. */
export function parseStubStatus(text: string, t: number): NginxStatus | null {
  const active = /Active connections:\s*(\d+)/.exec(text);
  const counters = /\n\s*(\d+)\s+(\d+)\s+(\d+)\s*\n/.exec(text);
  if (!active || !counters) return null;
  return { active: Number(active[1]), requests: Number(counters[3]), t };
}

export async function fetchStubStatus(url: string, now: number, timeoutMs = 1500): Promise<NginxStatus | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return parseStubStatus(await res.text(), now);
  } catch {
    return null;
  }
}
