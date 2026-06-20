import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

/**
 * A single recent interception event stored in the persistent history log.
 */
export const StatsHistoryEntrySchema = Type.Object(
  {
    timestamp: Type.String(),
    type: Type.Union([Type.Literal("read"), Type.Literal("error"), Type.Literal("squeeze")]),
    path: Type.String(),
    bytesSaved: Type.Optional(Type.Number({ minimum: 0 })),
    message: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

/**
 * Top-level shape of `.pi/plugins/ast-bro/stats.json`.
 */
export const StatsSchema = Type.Object(
  {
    totalBytesSaved: Type.Number({ default: 0, minimum: 0 }),
    totalReadsIntercepted: Type.Number({ default: 0, minimum: 0 }),
    totalPreFlightErrorsCaught: Type.Number({ default: 0, minimum: 0 }),
    totalSqueezeBytesSaved: Type.Number({ default: 0, minimum: 0 }),
    totalSessionSeedCost: Type.Number({ default: 0, minimum: 0 }),
    totalSessionSeedSavings: Type.Number({ default: 0, minimum: 0 }),
    history: Type.Array(StatsHistoryEntrySchema, { maxItems: 100 }),
  },
  { additionalProperties: false },
);

export type Stats = Static<typeof StatsSchema>;
export type StatsHistoryEntry = Static<typeof StatsHistoryEntrySchema>;

interface SessionSummary {
  bytesSaved: number;
  readsIntercepted: number;
  preFlightErrorsCaught: number;
  squeezeBytesSaved: number;
  sessionSeedCost: number;
  sessionSeedSavings: number;
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const HISTORY_LIMIT = 100;

function hasForbiddenKeys(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) return true;
    if (hasForbiddenKeys((value as Record<string, unknown>)[key])) return true;
  }
  return false;
}

/**
 * Persistent statistics manager for pi-ast-bro.
 *
 * Keeps separate session counters (what happened this run) and persistent
 * lifetime counters (on disk). Changes are buffered as "deltas" and flushed
 * with optimistic delta-updates to minimise parallel CLI race conditions.
 */
export class StatsManager {
  private cwd: string;
  private readonly saveDelayMs: number;
  private saveTimeout: ReturnType<typeof setTimeout> | null = null;

  private sessionBytesSaved = 0;
  private sessionReadsIntercepted = 0;
  private sessionPreFlightErrorsCaught = 0;
  private sessionSqueezeBytesSaved = 0;
  private sessionSeedCost = 0;
  private sessionSeedSavings = 0;

  private deltaBytesSaved = 0;
  private deltaReadsIntercepted = 0;
  private deltaPreFlightErrorsCaught = 0;
  private deltaSqueezeBytesSaved = 0;
  private deltaSessionSeedCost = 0;
  private deltaSessionSeedSavings = 0;
  private historyQueue: StatsHistoryEntry[] = [];

  constructor(cwd: string, options?: { saveDelayMs?: number }) {
    this.cwd = cwd;
    this.saveDelayMs = options?.saveDelayMs ?? 1000;
  }

  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  private statsPath(): string {
    return join(this.cwd, CONFIG_DIR_NAME, "plugins", "ast-bro", "stats.json");
  }

  addReadSavings(filePath: string, originalBytes: number, astOutputBytes: number): void {
    const saved = Math.max(0, originalBytes - astOutputBytes);
    this.sessionBytesSaved += saved;
    this.sessionReadsIntercepted += 1;
    this.deltaBytesSaved += saved;
    this.deltaReadsIntercepted += 1;
    this.historyQueue.push({
      timestamp: new Date().toISOString(),
      type: "read",
      path: filePath,
      bytesSaved: saved,
    });
    this.scheduleSave();
  }

  addSqueezeSavings(filePath: string, originalBytes: number, squeezedBytes: number): void {
    const saved = Math.max(0, originalBytes - squeezedBytes);
    this.sessionSqueezeBytesSaved += saved;
    this.deltaSqueezeBytesSaved += saved;
    this.historyQueue.push({
      timestamp: new Date().toISOString(),
      type: "squeeze",
      path: filePath,
      bytesSaved: saved,
    });
    this.scheduleSave();
  }

  recordSessionSeedCost(costBytes: number): void {
    const cost = Math.max(0, costBytes);
    this.sessionSeedCost += cost;
    this.deltaSessionSeedCost += cost;
    this.scheduleSave();
  }

  recordSessionSeedSavings(savingsBytes: number): void {
    const savings = Math.max(0, savingsBytes);
    this.sessionSeedSavings += savings;
    this.deltaSessionSeedSavings += savings;
    this.scheduleSave();
  }

  recordPreFlightError(filePath: string, message?: string): void {
    this.sessionPreFlightErrorsCaught += 1;
    this.deltaPreFlightErrorsCaught += 1;
    this.historyQueue.push({
      timestamp: new Date().toISOString(),
      type: "error",
      path: filePath,
      message: message ?? "Syntax error caught",
    });
    this.scheduleSave();
  }

  getSessionSummary(): SessionSummary {
    return {
      bytesSaved: this.sessionBytesSaved,
      readsIntercepted: this.sessionReadsIntercepted,
      preFlightErrorsCaught: this.sessionPreFlightErrorsCaught,
      squeezeBytesSaved: this.sessionSqueezeBytesSaved,
      sessionSeedCost: this.sessionSeedCost,
      sessionSeedSavings: this.sessionSeedSavings,
    };
  }

  async getLifetimeSummary(): Promise<Stats> {
    const data = this.loadStats();
    return this.mergeDeltas(data);
  }

  async save(): Promise<void> {
    try {
      await this.persist();
    } catch {
      // Graceful degradation: never crash the extension because of I/O or
      // validation failures.
    }
  }

  flushSync(): void {
    this.cancelScheduledSave();
    try {
      this.persistSync();
    } catch {
      // Graceful degradation.
    }
  }

  async flush(): Promise<void> {
    this.cancelScheduledSave();
    await this.save();
  }

  private persist(): Promise<void> {
    return Promise.resolve().then(() => this.persistSync());
  }

  private persistSync(): void {
    const data = this.loadStats();
    const merged = this.mergeDeltas(data);
    this.resetDeltas();

    const path = this.statsPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(merged, null, 2));
  }

  private loadStats(): Stats {
    let data: Stats = Value.Create(StatsSchema);
    const path = this.statsPath();
    if (!existsSync(path)) return data;

    try {
      const raw = readFileSync(path, "utf-8");
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || hasForbiddenKeys(parsed)) return data;

      const defaulted = Value.Default(StatsSchema, parsed);
      if (Value.Check(StatsSchema, defaulted)) {
        data = Value.Decode(StatsSchema, defaulted) as Stats;
      }
    } catch {
      // Keep defaults on any parse or validation error.
    }

    return data;
  }

  private mergeDeltas(data: Stats): Stats {
    return {
      totalBytesSaved: data.totalBytesSaved + this.deltaBytesSaved,
      totalReadsIntercepted: data.totalReadsIntercepted + this.deltaReadsIntercepted,
      totalPreFlightErrorsCaught: data.totalPreFlightErrorsCaught + this.deltaPreFlightErrorsCaught,
      totalSqueezeBytesSaved: data.totalSqueezeBytesSaved + this.deltaSqueezeBytesSaved,
      totalSessionSeedCost: data.totalSessionSeedCost + this.deltaSessionSeedCost,
      totalSessionSeedSavings: data.totalSessionSeedSavings + this.deltaSessionSeedSavings,
      history: [...data.history, ...this.historyQueue].slice(-HISTORY_LIMIT),
    };
  }

  private resetDeltas(): void {
    this.deltaBytesSaved = 0;
    this.deltaReadsIntercepted = 0;
    this.deltaPreFlightErrorsCaught = 0;
    this.deltaSqueezeBytesSaved = 0;
    this.deltaSessionSeedCost = 0;
    this.deltaSessionSeedSavings = 0;
    this.historyQueue = [];
  }

  private cancelScheduledSave(): void {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      this.saveTimeout = null;
    }
  }

  private scheduleSave(): void {
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      void this.save();
    }, this.saveDelayMs);
  }
}

export function formatTokens(bytes: number): string {
  const tokens = Math.round(bytes / 4);
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}

export function formatBytesHuman(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  const value = bytes / Math.pow(1000, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function relativePath(cwd: string, filePath: string): string {
  try {
    return relative(cwd, filePath);
  } catch {
    return filePath;
  }
}
