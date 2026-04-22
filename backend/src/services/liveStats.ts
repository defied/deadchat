import os from 'os';

export interface RequestEvent {
  id: number;
  userId: number;
  username: string;
  model: string;
  endpoint: 'chat' | 'generate';
  startedAt: number;               // ms epoch
  firstTokenAt?: number;           // ms epoch (when first token arrived)
  finishedAt: number;              // ms epoch
  wallDurationMs: number;
  promptTokens: number;
  evalTokens: number;
  totalDurationNs?: number;
  loadDurationNs?: number;
  promptEvalDurationNs?: number;
  evalDurationNs?: number;
  error?: string;
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

export function getSnapshot(): {
  recent: RequestEvent[];
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
  host: {
    loadavg: number[];
    cpus: number;
    totalMemMB: number;
    freeMemMB: number;
    processRssMB: number;
    processHeapUsedMB: number;
    uptimeSec: number;
    nodeVersion: string;
    platform: string;
  };
} {
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

  const mem = process.memoryUsage();
  const MB = 1024 * 1024;

  return {
    recent: events.slice(-30).reverse(),
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
    host: {
      loadavg: os.loadavg(),
      cpus: os.cpus().length,
      totalMemMB: os.totalmem() / MB,
      freeMemMB: os.freemem() / MB,
      processRssMB: mem.rss / MB,
      processHeapUsedMB: mem.heapUsed / MB,
      uptimeSec: process.uptime(),
      nodeVersion: process.version,
      platform: `${os.platform()} ${os.arch()}`,
    },
  };
}
