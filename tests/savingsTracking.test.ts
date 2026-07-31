import { beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { StatsManager } from "../src/statsManager.js";
import {
  extractContextFilePaths,
  extractGraphFilePaths,
  extractSurfaceFilePaths,
  extractTraceFilePaths,
  recordReferencedFileSavings,
} from "../src/utils.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  stat: vi.fn(),
}));

function createFakeStats(): StatsManager {
  return { addReadSavings: vi.fn() } as unknown as StatsManager;
}

describe("extractGraphFilePaths", () => {
  it("collects deduplicated edges[].from/.to", () => {
    const stdout = JSON.stringify({
      schema: "ast-bro.graph.v1",
      edges: [
        { from: "src/main.rs", to: "src/a.rs", kind: "mod", line: 1 },
        { from: "src/main.rs", to: "src/b.rs", kind: "mod", line: 2 },
      ],
    });
    expect(extractGraphFilePaths(stdout).sort()).toEqual(["src/a.rs", "src/b.rs", "src/main.rs"]);
  });

  it("handles a bare array of edges", () => {
    const stdout = JSON.stringify([{ from: "a.ts" }, { to: "b.ts" }]);
    expect(extractGraphFilePaths(stdout).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("returns [] for non-JSON output and unknown shapes", () => {
    expect(extractGraphFilePaths("4 files, 1 edges")).toEqual([]);
    expect(extractGraphFilePaths(JSON.stringify({ nodes: ["a"] }))).toEqual([]);
    expect(extractGraphFilePaths("{not json")).toEqual([]);
  });
});

describe("extractContextFilePaths", () => {
  it("collects deduplicated report.entries[].file", () => {
    const stdout = JSON.stringify({
      schema: "ast-bro.context.v1",
      report: {
        symbol: "a_fn",
        entries: [
          { label: "target", file: "src/a.rs", line: 1 },
          { label: "caller", file: "src/main.rs", line: 2 },
          { label: "caller", file: "src/main.rs", line: 9 },
        ],
      },
    });
    expect(extractContextFilePaths(stdout).sort()).toEqual(["src/a.rs", "src/main.rs"]);
  });

  it("returns [] for non-JSON or missing report", () => {
    expect(extractContextFilePaths('{"ok":true}')).toEqual([]);
    expect(extractContextFilePaths("not json")).toEqual([]);
  });
});

describe("extractTraceFilePaths", () => {
  it("captures file:line tokens from numbered entries", () => {
    const stdout = [
      "# trace: entry → a_fn   (1 hop)",
      "1. src/main.rs::entry  src/main.rs:2  [function]",
      "       pub fn entry() { crate::a::a_fn(); }",
      "",
      "   ↓ call (line 2)",
      "2. src/a.rs::a_fn  src/a.rs:1  [function]  [Inferred]",
      "       pub fn a_fn() {}",
    ].join("\n");
    expect(extractTraceFilePaths(stdout).sort()).toEqual(["src/a.rs", "src/main.rs"]);
  });

  it("returns [] when no static path was found", () => {
    const stdout = "# trace: a_fn → b_fn   no static call path found";
    expect(extractTraceFilePaths(stdout)).toEqual([]);
  });
});

describe("extractSurfaceFilePaths", () => {
  it("captures path:line tokens (relative and absolute)", () => {
    const stdout = [
      "a_fn                src/a.rs:1",
      "b_fn                src/b.rs:1",
      "Player              /tmp/repo/src/lib.rs:1",
    ].join("\n");
    expect(extractSurfaceFilePaths(stdout).sort()).toEqual([
      "/tmp/repo/src/lib.rs",
      "src/a.rs",
      "src/b.rs",
    ]);
  });
});

describe("recordReferencedFileSavings", () => {
  const mockedExists = vi.mocked(existsSync);
  const mockedStat = vi.mocked(stat);

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("records savings = sum of referenced file sizes minus output size", async () => {
    mockedExists.mockImplementation((p) => typeof p === "string" && p.startsWith("/project/"));
    mockedStat.mockImplementation(async (p) => ({ size: 1000 } as Awaited<ReturnType<typeof stat>>));

    const stats = createFakeStats();
    await recordReferencedFileSavings(["src/a.rs", "src/b.rs"], "small output", "/project", stats);

    expect(stats.addReadSavings).toHaveBeenCalledTimes(1);
    expect(stats.addReadSavings).toHaveBeenCalledWith(
      "src/a.rs",
      2000,
      Buffer.byteLength("small output", "utf-8"),
    );
  });

  it("does not record when there is no net saving", async () => {
    mockedExists.mockImplementation((p) => typeof p === "string" && p.startsWith("/project/"));
    mockedStat.mockImplementation(async (p) => ({ size: 10 } as Awaited<ReturnType<typeof stat>>));

    const stats = createFakeStats();
    await recordReferencedFileSavings(["src/a.rs"], "a very long output that dwarfs the file", "/project", stats);

    expect(stats.addReadSavings).not.toHaveBeenCalled();
  });

  it("does nothing for an empty path list", async () => {
    const stats = createFakeStats();
    await recordReferencedFileSavings([], "any output", "/project", stats);
    expect(stats.addReadSavings).not.toHaveBeenCalled();
  });

  it("skips unresolvable files and stat errors", async () => {
    mockedExists.mockImplementation(() => false);
    mockedStat.mockImplementation(async () => {
      throw new Error("ENOENT");
    });

    const stats = createFakeStats();
    await recordReferencedFileSavings(["missing.rs"], "output", "/project", stats);
    expect(stats.addReadSavings).not.toHaveBeenCalled();
  });

  it("bails out early when the signal is aborted", async () => {
    mockedExists.mockImplementation(() => true);
    mockedStat.mockImplementation(async (p) => ({ size: 1000 } as Awaited<ReturnType<typeof stat>>));

    const controller = new AbortController();
    controller.abort();

    const stats = createFakeStats();
    await recordReferencedFileSavings(["a.rs", "b.rs"], "output", "/project", stats, {
      signal: controller.signal,
    });
    expect(stats.addReadSavings).not.toHaveBeenCalled();
  });
});
