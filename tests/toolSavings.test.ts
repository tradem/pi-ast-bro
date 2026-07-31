import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Settings, SettingsManager } from "../src/config.js";
import type { StatsManager } from "../src/statsManager.js";
import { clearAstBroInfoCache } from "../src/utils.js";
import { registerAstContextTool } from "../src/astContextPilot.js";
import { registerAstGraphTool } from "../src/astGraphPilot.js";
import { registerNavigationTools } from "../src/astNavigationTools.js";
import { emitSpawnResponse } from "./spawnMocks.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  stat: vi.fn(),
}));

interface TestTool {
  name: string;
  execute: (...args: unknown[]) => Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }>;
}

function createMockPi(): ExtensionAPI {
  const registeredTools: unknown[] = [];
  return {
    registeredTools,
    on() {},
    registerTool(definition: unknown) {
      registeredTools.push(definition);
    },
    registerCommand() {},
    getAllTools() {
      return [];
    },
  } as unknown as ExtensionAPI;
}

function getTool(pi: ExtensionAPI, name: string): TestTool {
  return ((pi as unknown as { registeredTools: unknown[] }).registeredTools.find(
    (t) => (t as TestTool).name === name,
  ) as unknown) as TestTool;
}

function createMockContext(): ExtensionContext {
  return {
    cwd: "/project",
    hasUI: true,
    mode: "tui",
    ui: {
      notify: vi.fn(),
      confirm: vi.fn(),
      select: vi.fn(),
      input: vi.fn(),
      custom: vi.fn(),
    },
  } as unknown as ExtensionContext;
}

function createMockSettings(): SettingsManager {
  return {
    load: async () =>
      ({
        enabled: true,
        supportedExtensions: [".rs"],
        fileSizeThresholdLines: 500,
        enablePreFlightSyntaxChecks: true,
        graphMaxEdges: 500,
        contextDefaultBudget: 4000,
        enableLogSqueeze: false,
        enableIndexRefresh: false,
        enableSessionSeed: false,
        sessionSeedBudget: 4000,
        sessionSeedScope: "root",
        enableCyclePreflight: false,
        searchSnippetBudget: 8000,
      }) as Settings,
  } as unknown as SettingsManager;
}

function createFakeStats(): StatsManager & { addReadSavings: ReturnType<typeof vi.fn> } {
  return { addReadSavings: vi.fn() } as unknown as StatsManager & {
    addReadSavings: ReturnType<typeof vi.fn>;
  };
}

function mockAstBroAvailable(): void {
  vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
    if (command === "ast-bro" && args?.[0] === "--version") {
      return { status: 0, stdout: "3.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
    }
    if (command === "which" && args?.[0] === "ast-bro") {
      return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
    }
    return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
  });
}

/** Resolve any /project/src/*.rs reference and size it at 1000 bytes. */
function mockResolvableSources(): void {
  vi.mocked(existsSync).mockImplementation((p) => {
    const s = typeof p === "string" ? p : "";
    return s === "/project/src/lib.rs" || s === "/project/src/main.rs" || s === "/project/src/a.rs";
  });
  vi.mocked(stat).mockImplementation(async (p) => ({ size: 1000 } as Awaited<ReturnType<typeof stat>>));
}

describe("AST tool savings tracking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearAstBroInfoCache();
  });

  it("analyze_ast_context records savings from report.entries[].file", async () => {
    mockAstBroAvailable();
    mockResolvableSources();
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "context") {
        return emitSpawnResponse(
          0,
          JSON.stringify({
            schema: "ast-bro.context.v1",
            report: { symbol: "make_ctx", entries: [{ label: "target", file: "src/lib.rs", line: 1 }] },
          }),
          "",
        );
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const stats = createFakeStats();
    registerAstContextTool(pi, createMockSettings(), stats);
    const tool = getTool(pi, "analyze_ast_context");

    const result = await tool.execute("tc", { path: "src/lib.rs", target: "make_ctx", budget: 2000 }, undefined, undefined, createMockContext());

    expect(result.isError).toBe(false);
    expect(stats.addReadSavings).toHaveBeenCalledTimes(1);
    expect(stats.addReadSavings).toHaveBeenCalledWith("src/lib.rs", 1000, expect.any(Number));
  });

  it("analyze_ast_graph records savings from edges[].from/.to", async () => {
    mockAstBroAvailable();
    mockResolvableSources();
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "graph") {
        return emitSpawnResponse(
          0,
          JSON.stringify({
            schema: "ast-bro.graph.v1",
            edges: [
              { from: "src/main.rs", to: "src/a.rs", kind: "mod", line: 1 },
              { from: "src/main.rs", to: "src/lib.rs", kind: "mod", line: 2 },
            ],
          }),
          "",
        );
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const stats = createFakeStats();
    registerAstGraphTool(pi, createMockSettings(), stats);
    const tool = getTool(pi, "analyze_ast_graph");

    const result = await tool.execute("tc", {}, undefined, undefined, createMockContext());

    expect(result.isError).toBe(false);
    expect(stats.addReadSavings).toHaveBeenCalledTimes(1);
    expect(stats.addReadSavings).toHaveBeenCalledWith("src/main.rs", 3000, expect.any(Number));
  });

  it("analyze_ast_trace records savings from the trace entries", async () => {
    mockAstBroAvailable();
    mockResolvableSources();
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "trace") {
        return emitSpawnResponse(
          0,
          [
            "# trace: entry → a_fn   (1 hop)",
            "1. src/main.rs::entry  src/main.rs:2  [function]",
            "       pub fn entry() { crate::a::a_fn(); }",
            "   ↓ call (line 2)",
            "2. src/a.rs::a_fn  src/a.rs:1  [function]",
            "       pub fn a_fn() {}",
          ].join("\n"),
          "",
        );
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const stats = createFakeStats();
    registerNavigationTools(pi, createMockSettings(), stats);
    const tool = getTool(pi, "analyze_ast_trace");

    const result = await tool.execute("tc", { from: "entry", to: "a_fn" }, undefined, undefined, createMockContext());

    expect(result.isError).toBe(false);
    expect(stats.addReadSavings).toHaveBeenCalledTimes(1);
    expect(stats.addReadSavings).toHaveBeenCalledWith("src/main.rs", 2000, expect.any(Number));
  });

  it("analyze_ast_surface records savings from surface path:line entries", async () => {
    mockAstBroAvailable();
    mockResolvableSources();
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "surface") {
        return emitSpawnResponse(0, "a_fn  src/a.rs:1\nPlayer  src/lib.rs:1\n", "");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const stats = createFakeStats();
    registerNavigationTools(pi, createMockSettings(), stats);
    const tool = getTool(pi, "analyze_ast_surface");

    const result = await tool.execute("tc", { path: "src" }, undefined, undefined, createMockContext());

    expect(result.isError).toBe(false);
    expect(stats.addReadSavings).toHaveBeenCalledTimes(1);
    expect(stats.addReadSavings).toHaveBeenCalledWith("src/a.rs", 2000, expect.any(Number));
  });

  it("does not record savings when ast-bro fails", async () => {
    mockAstBroAvailable();
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "surface") {
        return emitSpawnResponse(1, "", "surface failed");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const stats = createFakeStats();
    registerNavigationTools(pi, createMockSettings(), stats);
    const tool = getTool(pi, "analyze_ast_surface");

    const result = await tool.execute("tc", { path: "src" }, undefined, undefined, createMockContext());

    expect(result.isError).toBe(true);
    expect(stats.addReadSavings).not.toHaveBeenCalled();
  });
});
