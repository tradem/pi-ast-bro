import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { registerAstContextTool } from "../src/astContextPilot.js";
import { registerAstGraphTool } from "../src/astGraphPilot.js";
import { registerNavigationTools } from "../src/astNavigationTools.js";
import { registerRefactoringTools } from "../src/astBroTools.js";
import { registerAstTools } from "../src/tools.js";
import { SettingsManager, type Settings } from "../src/config.js";
import { StatsManager } from "../src/statsManager.js";
import { clearAstBroInfoCache } from "../src/utils.js";
import { emitSpawnResponse } from "./spawnMocks.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  stat: vi.fn(),
}));

interface ProgressPayload {
  content: Array<{ type: string; text: string }>;
  details?: { phase?: string; current?: number; total?: number };
}

interface TestTool {
  name: string;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: ((payload: ProgressPayload) => void) | undefined,
    ctx: ExtensionContext,
  ) => Promise<{ content: Array<{ type: string; text: string }>; isError: boolean; details?: unknown }>;
}

function createMockPi(): ExtensionAPI {
  const registeredTools: ToolDefinition<any, any, any>[] = [];
  return {
    registeredTools,
    on() {},
    registerTool(definition: ToolDefinition<any, any, any>) {
      registeredTools.push(definition);
    },
    registerCommand() {},
    getAllTools() {
      return [];
    },
  } as unknown as ExtensionAPI;
}

function getTool(pi: ExtensionAPI, name: string): TestTool {
  return (pi as unknown as { registeredTools: TestTool[] }).registeredTools.find(
    (t) => t.name === name,
  ) as TestTool;
}

function createMockContext(overrides?: Partial<ExtensionContext>): ExtensionContext {
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
    ...overrides,
  } as ExtensionContext;
}

function createMockSettings(overrides: Partial<Settings> = {}): SettingsManager {
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
        progressUpdateThrottleMs: 100,
        ...overrides,
      }) as Settings,
    save: async () => undefined,
  } as unknown as SettingsManager;
}

function mockAstBroAvailable(): void {
  vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
    if (command === "ast-bro" && args?.[0] === "--version") {
      return { status: 0, stdout: "ast-bro 3.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
    }
    if (command === "which" && args?.[0] === "ast-bro") {
      return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
    }
    return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
  });
}

function createMockOnUpdate(): { payloads: ProgressPayload[]; onUpdate: (payload: ProgressPayload) => void } {
  const payloads: ProgressPayload[] = [];
  return {
    payloads,
    onUpdate(payload) {
      payloads.push(payload);
    },
  };
}

function phaseSequence(payloads: ProgressPayload[]): string[] {
  return payloads.map((p) => p.details?.phase).filter((p): p is string => typeof p === "string");
}

describe("tool progress phases", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearAstBroInfoCache();
  });

  it("analyze_ast_context emits starting and querying", async () => {
    mockAstBroAvailable();
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "context") {
        return emitSpawnResponse(0, "{\"ok\":true}", "");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const settings = createMockSettings();
    registerAstContextTool(pi, settings);
    const tool = getTool(pi, "analyze_ast_context");
    const { payloads, onUpdate } = createMockOnUpdate();

    await tool.execute("tc", { path: "src/lib.rs" }, undefined, onUpdate, createMockContext());

    expect(phaseSequence(payloads)).toEqual(["starting", "querying"]);
  });

  it("analyze_ast_graph emits starting and querying", async () => {
    mockAstBroAvailable();
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "graph") {
        return emitSpawnResponse(0, JSON.stringify({ edges: [] }), "");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const settings = createMockSettings();
    registerAstGraphTool(pi, settings);
    const tool = getTool(pi, "analyze_ast_graph");
    const { payloads, onUpdate } = createMockOnUpdate();

    await tool.execute("tc", {}, undefined, onUpdate, createMockContext());

    expect(phaseSequence(payloads)).toEqual(["starting", "querying"]);
  });

  it("analyze_ast_trace and analyze_ast_surface emit starting and querying", async () => {
    mockAstBroAvailable();
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "trace") {
        return emitSpawnResponse(0, "path found", "");
      }
      if (command === "ast-bro" && args?.[0] === "surface") {
        return emitSpawnResponse(0, "pub fn api()", "");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const settings = createMockSettings();
    registerNavigationTools(pi, settings);
    const traceTool = getTool(pi, "analyze_ast_trace");
    const surfaceTool = getTool(pi, "analyze_ast_surface");

    const traceUpdate = createMockOnUpdate();
    await traceTool.execute("tc", { from: "a", to: "b" }, undefined, traceUpdate.onUpdate, createMockContext());
    expect(phaseSequence(traceUpdate.payloads)).toEqual(["starting", "querying"]);

    const surfaceUpdate = createMockOnUpdate();
    await surfaceTool.execute("tc", { path: "src" }, undefined, surfaceUpdate.onUpdate, createMockContext());
    expect(phaseSequence(surfaceUpdate.payloads)).toEqual(["starting", "querying"]);
  });

  it("analyze_ast_impact emits starting, querying, and augmenting with current/total", async () => {
    mockAstBroAvailable();
    vi.mocked(existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    vi.mocked(readFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      "pub fn one() {}\npub fn two() {}\npub fn target() {}\n",
    );
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "impact") {
        return emitSpawnResponse(
          0,
          JSON.stringify([
            { file: "src/lib.rs", line: 1 },
            { file: "src/lib.rs", line: 2 },
            { file: "src/lib.rs", line: 3 },
          ]),
          "",
        );
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const stats = new StatsManager("");
    const settings = createMockSettings({ progressUpdateThrottleMs: 0 });
    registerRefactoringTools(pi, stats, settings);
    const tool = getTool(pi, "analyze_ast_impact");
    const { payloads, onUpdate } = createMockOnUpdate();

    const result = await tool.execute(
      "tc",
      { symbol: "target" },
      undefined,
      onUpdate,
      createMockContext(),
    );

    expect(result.isError).toBe(false);
    const phases = phaseSequence(payloads);
    expect(phases.slice(0, 2)).toEqual(["starting", "querying"]);
    expect(phases.slice(2).every((p) => p === "augmenting")).toBe(true);

    const augmenting = payloads.filter((p) => p.details && (p.details as { phase?: string }).phase === "augmenting");
    expect(augmenting.length).toBeGreaterThan(0);
    const last = augmenting[augmenting.length - 1]!.details as { current: number; total: number };
    expect(last.current).toBe(last.total);
  });

  it("find_implementations emits starting, querying, and augmenting", async () => {
    mockAstBroAvailable();
    vi.mocked(existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    vi.mocked(readFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("pub fn one() {}\n");
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "implements") {
        return emitSpawnResponse(0, JSON.stringify([{ file: "src/lib.rs", line: 1 }]), "");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const stats = new StatsManager("");
    const settings = createMockSettings({ progressUpdateThrottleMs: 0 });
    registerRefactoringTools(pi, stats, settings);
    const tool = getTool(pi, "find_implementations");
    const { payloads, onUpdate } = createMockOnUpdate();

    await tool.execute("tc", { symbol: "MyTrait" }, undefined, onUpdate, createMockContext());

    expect(phaseSequence(payloads)).toEqual(["starting", "querying", "augmenting"]);
  });

  it("analyze_ast_map emits starting, querying, and augmenting", async () => {
    mockAstBroAvailable();
    vi.mocked(existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (p: string) => p === "/project/src/lib.rs",
    );
    vi.mocked(readFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("fn map() {}\n".repeat(100));
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "map") {
        return emitSpawnResponse(0, "map output", "");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const stats = new StatsManager("");
    const settings = createMockSettings({ progressUpdateThrottleMs: 0 });
    registerAstTools(pi, stats, settings);
    const tool = getTool(pi, "analyze_ast_map");
    const { payloads, onUpdate } = createMockOnUpdate();

    await tool.execute("tc", { path: "src/lib.rs" }, undefined, onUpdate, createMockContext());

    expect(phaseSequence(payloads)).toEqual(["starting", "querying", "augmenting"]);
    const augmenting = payloads.find(
      (p) => p.details && (p.details as { phase?: string }).phase === "augmenting",
    )!.details as { current: number; total: number };
    expect(augmenting.current).toBe(1);
    expect(augmenting.total).toBe(1);
  });

  it("analyze_ast_search emits starting, querying, and augmenting", async () => {
    mockAstBroAvailable();
    vi.mocked(existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (p: string) => p === "/project/src/a.rs" || p === "/project/src/b.rs",
    );
    vi.mocked(stat as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 1024 } as never);
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "search") {
        return emitSpawnResponse(
          0,
          [
            "/project/src/a.rs:10-20 [score 0.9]",
            "snippet",
          ].join("\n"),
          "",
        );
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const stats = new StatsManager("");
    const settings = createMockSettings({ progressUpdateThrottleMs: 0 });
    registerAstTools(pi, stats, settings);
    const tool = getTool(pi, "analyze_ast_search");
    const { payloads, onUpdate } = createMockOnUpdate();
    const ctx = createMockContext();

    await tool.execute("tc", { query: "foo" }, undefined, onUpdate, ctx);

    expect(phaseSequence(payloads)).toEqual(["starting", "querying", "augmenting"]);
    const augmenting = payloads.filter((p) => (p.details as { phase?: string })?.phase === "augmenting");
    expect(augmenting.length).toBeGreaterThan(0);
    const last = augmenting[augmenting.length - 1]!.details as { current: number; total: number };
    expect(last.current).toBe(last.total);
  });

  it("keeps ctx.ui.notify working alongside onUpdate for search", async () => {
    mockAstBroAvailable();
    vi.mocked(existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    vi.mocked(stat as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ size: 2000 } as never);
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "search") {
        return emitSpawnResponse(0, "/project/src/a.rs:10-20 [score 0.9]\nsnippet\n", "");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const stats = new StatsManager("");
    const settings = createMockSettings();
    registerAstTools(pi, stats, settings);
    const tool = getTool(pi, "analyze_ast_search");
    const ctx = createMockContext();
    const { onUpdate, payloads } = createMockOnUpdate();

    await tool.execute("tc", { query: "foo" }, undefined, onUpdate, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("saved"), "info");
    expect(payloads.some((p) => (p.details as { phase?: string })?.phase === "augmenting")).toBe(true);
  });

  it("does not throw when onUpdate is undefined", async () => {
    mockAstBroAvailable();
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "context") {
        return emitSpawnResponse(0, "{\"ok\":true}", "");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const settings = createMockSettings();
    registerAstContextTool(pi, settings);
    const tool = getTool(pi, "analyze_ast_context");

    const result = await tool.execute("tc", { path: "src/lib.rs" }, undefined, undefined, createMockContext());
    expect(result.isError).toBe(false);
  });

  it("does not include onUpdate payloads in the final result content", async () => {
    mockAstBroAvailable();
    vi.mocked(existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    vi.mocked(readFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("pub fn target() {}\n");
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "impact") {
        return emitSpawnResponse(0, JSON.stringify([{ file: "src/lib.rs", line: 1 }]), "");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const stats = new StatsManager("");
    const settings = createMockSettings();
    registerRefactoringTools(pi, stats, settings);
    const tool = getTool(pi, "analyze_ast_impact");
    const { onUpdate, payloads } = createMockOnUpdate();

    const result = await tool.execute(
      "tc",
      { symbol: "target" },
      undefined,
      onUpdate,
      createMockContext(),
    );

    expect(payloads.length).toBeGreaterThan(0);
    const text = result.content.map((c) => c.text).join("");
    expect(text).not.toContain("starting ast-bro");
    expect(text).not.toContain("augmenting snippet");
  });
});

describe("progress throttle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearAstBroInfoCache();
  });

  it("coalesces rapid augmenting emissions and flushes the final phase", async () => {
    mockAstBroAvailable();

    vi.mocked(existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    vi.mocked(readFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("pub fn target() {}\n");
    const matches = Array.from({ length: 5 }, (_, i) => ({ file: "src/lib.rs", line: i + 1 }));
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "impact") {
        return emitSpawnResponse(0, JSON.stringify(matches), "");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const stats = new StatsManager("");
    const settings = createMockSettings({ progressUpdateThrottleMs: 1000 });
    registerRefactoringTools(pi, stats, settings);
    const tool = getTool(pi, "analyze_ast_impact");
    const { onUpdate, payloads } = createMockOnUpdate();

    await tool.execute("tc", { symbol: "target" }, undefined, onUpdate, createMockContext());

    const augmenting = payloads.filter((p) => (p.details as { phase?: string })?.phase === "augmenting");
    expect(augmenting.length).toBeLessThanOrEqual(2);
    const lastAugmenting = augmenting[augmenting.length - 1]!.details as { current: number; total: number };
    expect(lastAugmenting.current).toBe(5);
    expect(lastAugmenting.total).toBe(5);
  });

  it("emits immediately when throttle is 0", async () => {
    mockAstBroAvailable();
    vi.mocked(existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    vi.mocked(readFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue("pub fn target() {}\n");
    const matches = Array.from({ length: 5 }, (_, i) => ({ file: "src/lib.rs", line: i + 1 }));
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "impact") {
        return emitSpawnResponse(0, JSON.stringify(matches), "");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const stats = new StatsManager("");
    const settings = createMockSettings({ progressUpdateThrottleMs: 0 });
    registerRefactoringTools(pi, stats, settings);
    const tool = getTool(pi, "analyze_ast_impact");
    const { onUpdate, payloads } = createMockOnUpdate();

    await tool.execute("tc", { symbol: "target" }, undefined, onUpdate, createMockContext());

    const augmenting = payloads.filter((p) => (p.details as { phase?: string })?.phase === "augmenting");
    expect(augmenting.length).toBe(5);
    const last = augmenting[augmenting.length - 1]!.details as { current: number; total: number };
    expect(last.current).toBe(5);
  });
});
