import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { StatsManager, formatTokens, relativePath } from "../src/statsManager";

vi.mock("node:fs");

describe("StatsManager", () => {
  const mockedExists = vi.mocked(existsSync);
  const mockedRead = vi.mocked(readFileSync);
  const mockedWrite = vi.mocked(writeFileSync);
  const mockedMkdir = vi.mocked(mkdirSync);

  const STATS_PATH = "/project/.pi/plugins/ast-bro/stats.json";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  function useFiles(files: Record<string, string>): void {
    mockedExists.mockImplementation((p) => Object.prototype.hasOwnProperty.call(files, p as string));
    mockedRead.mockImplementation((p) => {
      if (Object.prototype.hasOwnProperty.call(files, p as string)) return files[p as string];
      throw new Error(`ENOENT: ${p}`);
    });
  }

  function lastWritten(path: string): unknown {
    const calls = mockedWrite.mock.calls.filter(([p]) => p === path);
    if (calls.length === 0) return undefined;
    const last = calls[calls.length - 1];
    return JSON.parse(last[1] as string);
  }

  describe("session tracking", () => {
    it("tracks read savings and pre-flight errors separately for the current session", () => {
      const manager = new StatsManager("/project");
      manager.addReadSavings("/project/src/large.ts", 1000, 100);
      manager.recordPreFlightError("/project/src/broken.ts", "unexpected token");

      expect(manager.getSessionSummary()).toEqual({
        bytesSaved: 900,
        readsIntercepted: 1,
        preFlightErrorsCaught: 1,
      });
    });

    it("does not let negative savings reduce counters", () => {
      const manager = new StatsManager("/project");
      manager.addReadSavings("/project/src/large.ts", 100, 1000);
      expect(manager.getSessionSummary().bytesSaved).toBe(0);
      expect(manager.getSessionSummary().readsIntercepted).toBe(1);
    });
  });

  describe("persistence", () => {
    it("writes defaults plus pending deltas when no stats file exists", async () => {
      useFiles({});
      const manager = new StatsManager("/project", { saveDelayMs: 10_000 });
      manager.addReadSavings("/project/src/large.ts", 1000, 100);
      await manager.flush();

      expect(mockedMkdir).toHaveBeenCalledWith("/project/.pi/plugins/ast-bro", { recursive: true });
      const written = lastWritten(STATS_PATH);
      expect(written).toEqual(
        expect.objectContaining({
          totalBytesSaved: 900,
          totalReadsIntercepted: 1,
          totalPreFlightErrorsCaught: 0,
        }),
      );
      expect((written as { history: unknown[] }).history).toHaveLength(1);
    });

    it("applies deltas to existing on-disk counters", async () => {
      useFiles({
        [STATS_PATH]: JSON.stringify({
          totalBytesSaved: 100,
          totalReadsIntercepted: 5,
          totalPreFlightErrorsCaught: 1,
          history: [],
        }),
      });
      const manager = new StatsManager("/project", { saveDelayMs: 10_000 });
      manager.addReadSavings("/project/src/large.ts", 1000, 100);
      await manager.flush();

      const written = lastWritten(STATS_PATH);
      expect((written as { totalBytesSaved: number }).totalBytesSaved).toBe(1000);
      expect((written as { totalReadsIntercepted: number }).totalReadsIntercepted).toBe(6);
      expect((written as { totalPreFlightErrorsCaught: number }).totalPreFlightErrorsCaught).toBe(1);
    });

    it("preserves externally changed disk state when applying deltas", async () => {
      useFiles({
        [STATS_PATH]: JSON.stringify({
          totalBytesSaved: 100,
          totalReadsIntercepted: 5,
          totalPreFlightErrorsCaught: 1,
          history: [{ timestamp: "2026-01-01T00:00:00Z", type: "read", path: "a.ts", bytesSaved: 100 }],
        }),
      });

      const manager = new StatsManager("/project", { saveDelayMs: 10_000 });
      manager.addReadSavings("/project/src/large.ts", 1000, 100);

      // Simulate another CLI instance updating the file before our save runs.
      const updated = JSON.stringify({
        totalBytesSaved: 200,
        totalReadsIntercepted: 8,
        totalPreFlightErrorsCaught: 2,
        history: [{ timestamp: "2026-01-01T01:00:00Z", type: "read", path: "b.ts", bytesSaved: 50 }],
      });
      mockedRead.mockReturnValue(updated);

      await manager.flush();

      const written = lastWritten(STATS_PATH);
      expect((written as { totalBytesSaved: number }).totalBytesSaved).toBe(1100);
      expect((written as { totalReadsIntercepted: number }).totalReadsIntercepted).toBe(9);
      expect((written as { totalPreFlightErrorsCaught: number }).totalPreFlightErrorsCaught).toBe(2);
      expect((written as { history: unknown[] }).history).toHaveLength(2);
    });
  });

  describe("history limit", () => {
    it("does not allow the history array to exceed 100 entries", async () => {
      useFiles({});
      const manager = new StatsManager("/project", { saveDelayMs: 10_000 });
      for (let i = 0; i < 105; i++) {
        manager.addReadSavings(`/project/src/file${i}.ts`, 1000, 0);
      }
      await manager.flush();

      const written = lastWritten(STATS_PATH) as { history: { path: string }[] };
      expect(written.history).toHaveLength(100);
      expect(written.history[0].path).toContain("file5");
      expect(written.history[99].path).toContain("file104");
    });
  });

  describe("invalid and malicious input", () => {
    it("falls back to defaults when the stats file contains invalid JSON", async () => {
      useFiles({ [STATS_PATH]: "{not valid json" });
      const manager = new StatsManager("/project", { saveDelayMs: 10_000 });
      manager.addReadSavings("/project/src/large.ts", 1000, 100);
      await manager.flush();

      const written = lastWritten(STATS_PATH) as { totalBytesSaved: number; history: unknown[] };
      expect(written.totalBytesSaved).toBe(900);
      expect(written.history).toHaveLength(1);
    });

    it("falls back to defaults when the stats file contains forbidden prototype keys", async () => {
      // Build the malicious JSON by hand: JSON.stringify({ __proto__: ... }) does
      // not emit the key as an own property, so we use a raw string with
      // `"__proto__"` as a regular object key.
      useFiles({
        [STATS_PATH]:
          '{"totalBytesSaved":999,"totalReadsIntercepted":99,"totalPreFlightErrorsCaught":9,"__proto__":{"polluted":true},"history":[]}',
      });

      const manager = new StatsManager("/project", { saveDelayMs: 10_000 });
      manager.addReadSavings("/project/src/large.ts", 1000, 100);
      await manager.flush();

      const written = lastWritten(STATS_PATH) as { totalBytesSaved: number };
      // Existing file is rejected, so only the delta is persisted.
      expect(written.totalBytesSaved).toBe(900);
    });

    it("falls back to defaults when the stats file has additional properties", async () => {
      useFiles({
        [STATS_PATH]: JSON.stringify({
          totalBytesSaved: 100,
          totalReadsIntercepted: 5,
          totalPreFlightErrorsCaught: 1,
          extraField: "should be rejected",
          history: [],
        }),
      });

      const manager = new StatsManager("/project", { saveDelayMs: 10_000 });
      manager.addReadSavings("/project/src/large.ts", 1000, 100);
      await manager.flush();

      const written = lastWritten(STATS_PATH) as { totalBytesSaved: number };
      expect(written.totalBytesSaved).toBe(900);
    });
  });

  describe("lifetime summary", () => {
    it("merges on-disk state with pending unsaved deltas", async () => {
      useFiles({
        [STATS_PATH]: JSON.stringify({
          totalBytesSaved: 100,
          totalReadsIntercepted: 2,
          totalPreFlightErrorsCaught: 1,
          history: [],
        }),
      });

      const manager = new StatsManager("/project", { saveDelayMs: 10_000 });
      manager.addReadSavings("/project/src/large.ts", 1000, 100);
      manager.recordPreFlightError("/project/src/broken.ts");

      const summary = await manager.getLifetimeSummary();
      expect(summary.totalBytesSaved).toBe(1000);
      expect(summary.totalReadsIntercepted).toBe(3);
      expect(summary.totalPreFlightErrorsCaught).toBe(2);
      expect(summary.history).toHaveLength(2);
    });
  });

  describe("flushSync", () => {
    it("writes pending deltas synchronously", () => {
      useFiles({});
      const manager = new StatsManager("/project", { saveDelayMs: 10_000 });
      manager.addReadSavings("/project/src/large.ts", 1000, 100);
      manager.flushSync();

      const written = lastWritten(STATS_PATH) as { totalBytesSaved: number };
      expect(written.totalBytesSaved).toBe(900);
    });
  });

  describe("formatting helpers", () => {
    it("formats bytes as an approximate token count", () => {
      expect(formatTokens(0)).toBe("0");
      expect(formatTokens(4_000)).toBe("1.0k");
      expect(formatTokens(4_000_000)).toBe("1.0M");
    });

    it("produces a relative path when cwd is a parent", () => {
      expect(relativePath("/project", "/project/src/file.ts")).toBe("src/file.ts");
    });
  });
});
