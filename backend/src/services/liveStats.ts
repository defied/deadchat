import os from 'os';

export interface RequestEvent {
  id: number;
  userId: number;
  username: string;
  model: string;
  endpoint: 'chat' | 'generate';
  startedAt: number;
  firstTokenAt?: number;
  finishedAt: number;
  wallDurationMs: number;
  promptTokens: number;
  evalTokens: number;
  totalDurationNs?: number;
  loadDurationNs?: number;
  promptEvalDurationNs?: number;
  evalDurationNs?: number;
  error?: string;
}

export interface RunningModelLite {
  name: string;
  size: number;
  size_vram: number;
  expires_at?: string;
}

export interface NginxStatus {
  active: number;
  accepts: number;
  handled: number;
  requests: number;
  reading: number;
  writing: number;
  waiting: number;
}

const MAX_EVENTS = 100;
const ROLLING_WINDOW_MS = 5 * 60 * 1000;

const events: RequestEvent[] = [];
let nextId = 1;

export function recordRequest(
  event: Omit<RequestEvent, 'id' | 'wallDurationMs'>
): void {
  const full: RequestEvent = {
    ...event,
    id: nextId++,
    wallDurationMs: event.finishedAt - event.startedAt,
  };
  events.push(full);
  if (events.length > MAX_EVENTS) {
    events.splice(0, events.length - MAX_EVENTS);
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

export function parseNginxStatus(body: string): NginxStatus | null {
  // nginx stub_status format:
  //   Active connections: 12
  //   server accepts handled requests
  //    1000 1000 5000
  //   Reading: 0 Writing: 1 Waiting: 11
  const active = /Active connections:\s*(\d+)/.exec(body)?.[1];
  const counts = /server accepts handled requests\s*\n\s*(\d+)\s+(\d+)\s+(\d+)/.exec(body);
  const rww = /Reading:\s*(\d+)\s*Writing:\s*(\d+)\s*Waiting:\s*(\d+)/.exec(body);
  if (!active || !counts || !rww) return null;
  return {
    active: Number(active),
    accepts: Number(counts[1]),
    handled: Number(counts[2]),
    requests: Number(counts[3]),
    reading: Number(rww[1]),
    writing: Number(rww[2]),
    waiting: Number(rww[3]),
  };
}

export async function fetchNginxStatus(url: string, timeoutMs = 1500): Promise<NginxStatus | null> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!response.ok) return null;
    const text = await response.text();
    return parseNginxStatus(text);
  } catch {
    return null;
  }
}

export interface Snapshot {
  rolling: {
    windowMs: number;
    requests: number;
    totalPromptTokens: number;
    totalEvalTokens: number;
    avgTokensPerSec: number;
    p50TokensPerSec: number;
    p95TokensPerSec: number;
    avgTtftMs: number;
    errors: number;
  };
  recent: RequestEvent[];
  backend: {
    processRssMB: number;
    processHeapUsedMB: number;
    uptimeSec: number;
    nodeVersion: string;
  };
  frontend: {
    status: NginxStatus | null;
    error?: string;
  };
  node: {
    loadavg: number[];
    cpus: number;
    totalMemMB: number;
    freeMemMB: number;
    platform: string;
  };
  gpu: {
    source: string;
    totalVramMB: number;
    models: Array<{ name: string; vramMB: number; totalMB: number }>;
    reachable: boolean;
  };
}

interface SnapshotInputs {
  runningModels: RunningModelLite[];
  nginxStatus: NginxStatus | null;
  nginxError?: string;
  ollamaReachable: boolean;
}

export function buildSnapshot(inputs: SnapshotInputs): Snapshot {
  const now = Date.now();
  const inWindow = events.filter((e) => now - e.finishedAt <= ROLLING_WINDOW_MS);

  const tokensPerSec: number[] = [];
  let totalPromptTokens = 0;
  let totalEvalTokens = 0;
  let ttftSum = 0;
  let ttftCount = 0;
  let errors = 0;

  for (const e of inWindow) {
    if (e.error) errors++;
    totalPromptTokens += e.promptTokens;
    totalEvalTokens += e.evalTokens;
    if (e.evalDurationNs && e.evalTokens > 0) {
      const tps = e.evalTokens / (e.evalDurationNs / 1e9);
      if (Number.isFinite(tps)) tokensPerSec.push(tps);
    }
    if (e.firstTokenAt) {
      ttftSum += e.firstTokenAt - e.startedAt;
      ttftCount++;
    }
  }

  tokensPerSec.sort((a, b) => a - b);
  const avg = tokensPerSec.length
    ? tokensPerSec.reduce((s, v) => s + v, 0) / tokensPerSec.length
    : 0;

  const MB = 1024 * 1024;
  const mem = process.memoryUsage();

  const gpuModels = inputs.runningModels.map((m) => ({
    name: m.name,
    vramMB: (m.size_vram || 0) / MB,
    totalMB: (m.size || 0) / MB,
  }));
  const totalVramMB = gpuModels.reduce((s, m) => s + m.vramMB, 0);

  return {
    rolling: {
      windowMs: ROLLING_WINDOW_MS,
      requests: inWindow.length,
      totalPromptTokens,
      totalEvalTokens,
      avgTokensPerSec: avg,
      p50TokensPerSec: percentile(tokensPerSec, 0.5),
      p95TokensPerSec: percentile(tokensPerSec, 0.95),
      avgTtftMs: ttftCount ? ttftSum / ttftCount : 0,
      errors,
    },
    recent: events.slice(-30).reverse(),
    backend: {
      processRssMB: mem.rss / MB,
      processHeapUsedMB: mem.heapUsed / MB,
      uptimeSec: process.uptime(),
      nodeVersion: process.version,
    },
    frontend: {
      status: inputs.nginxStatus,
      error: inputs.nginxError,
    },
    node: {
      loadavg: os.loadavg(),
      cpus: os.cpus().length,
      totalMemMB: os.totalmem() / MB,
      freeMemMB: os.freemem() / MB,
      platform: `${os.platform()} ${os.arch()}`,
    },
    gpu: {
      source: 'ollama:/api/ps',
      totalVramMB,
      models: gpuModels,
      reachable: inputs.ollamaReachable,
    },
  };
}
