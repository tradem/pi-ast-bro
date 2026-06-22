import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerAstTools } from "../src/tools.js";
import { registerRefactoringTools } from "../src/astBroTools.js";
import { StatsManager } from "../src/statsManager.js";
import { clearAstBroInfoCache, runAstBroAsync } from "../src/utils.js";
import { createMockSpawnChild, emitSpawnError, emitSpawnResponse } from "./spawnMocks.js";

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

describe("async subprocess wrapper", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearAstBroInfoCache();
  });

  it("yields the event loop while waiting for the child process", async () => {
    vi.mocked(spawn).mockImplementation(() => {
      const child = createMockSpawnChild();
      setTimeout(() => {
        child.stdout?.emit("data", Buffer.from("ok", "utf-8"));
        child.emit("close", 0);
      }, 100);
      return child;
    });

    let resolved = false;
    const pending = runAstBroAsync(["--version"]).then((r) => {
      resolved = true;
      return r;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(resolved).toBe(false);

    const result = await pending;
    expect(resolved).toBe(true);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("ok");
  });

  it("captures spawn errors without throwing", async () => {
    vi.mocked(spawn).mockImplementation(() => emitSpawnError(new Error("ENOENT: ast-bro")));

    const result = await runAstBroAsync(["map", "src/lib.rs"]);

    expect(result.status).toBeNull();
    expect(result.stderr).toContain("ENOENT");
  });

  it("kills the child when the abort signal fires and returns an error result", async () => {
    const controller = new AbortController();
    const child = createMockSpawnChild();
    vi.mocked(spawn).mockReturnValue(child);

    const pending = runAstBroAsync(["context", "src/lib.rs"], {
      signal: controller.signal,
      timeoutMs: 60_000,
    });

    controller.abort();
    const result = await pending;

    expect(child.kill).toHaveBeenCalled();
    expect(result.status).toBeNull();
    expect(result.stderr.toLowerCase()).toContain("abort");
  });
});

describe("savings-recording invariant", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearAstBroInfoCache();
  });

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

  function getTool(pi: ExtensionAPI, name: string) {
    return (pi as unknown as { registeredTools: Array<{ name: string; execute: (...args: unknown[]) => Promise<unknown> }> }).registeredTools.find(
      (t) => t.name === name,
    )!;
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

  it("records addReadSavings exactly once for analyze_ast_map", async () => {
    mockAstBroAvailable();
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "map") {
        return emitSpawnResponse(0, "AST map summary", "");
      }
      return emitSpawnResponse(0, "", "");
    });
    vi.mocked(existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    vi.mocked(readFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      "line\n".repeat(500),
    );

    const stats = new StatsManager("");
    const addSpy = vi.spyOn(stats, "addReadSavings");
    const pi = createMockPi();
    registerAstTools(pi, stats, {
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
        }) as unknown as import("../src/config.js").Settings,
    } as unknown as import("../src/config.js").SettingsManager);

    const tool = getTool(pi, "analyze_ast_map");
    const result = (await tool.execute(
      "tc",
      { path: "src/lib.rs" },
      undefined,
      undefined,
      createMockContext(),
    )) as { isError: boolean };

    expect(result.isError).toBe(false);
    expect(addSpy).toHaveBeenCalledTimes(1);
    const [path, originalBytes, outputBytes] = addSpy.mock.calls[0] as [string, number, number];
    expect(path).toBe("/project/src/lib.rs");
    expect(originalBytes).toBeGreaterThanOrEqual(0);
    expect(outputBytes).toBeGreaterThanOrEqual(0);
  });

  it("records addReadSavings exactly once for analyze_ast_impact", async () => {
    mockAstBroAvailable();
    const impactJson = JSON.stringify([{ file: "src/lib.rs", line: 1, kind: "caller" }]);
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "impact") {
        return emitSpawnResponse(0, impactJson, "");
      }
      return emitSpawnResponse(0, "", "");
    });
    vi.mocked(existsSync as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    vi.mocked(readFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      "line\n".repeat(500),
    );

    const stats = new StatsManager("");
    const addSpy = vi.spyOn(stats, "addReadSavings");
    const pi = createMockPi();
    registerRefactoringTools(pi, stats);

    const tool = getTool(pi, "analyze_ast_impact");
    const result = (await tool.execute(
      "tc",
      { symbol: "target" },
      undefined,
      undefined,
      createMockContext(),
    )) as { isError: boolean };

    expect(result.isError).toBe(false);
    expect(addSpy).toHaveBeenCalledTimes(1);
    const [, originalBytes, outputBytes] = addSpy.mock.calls[0] as [string, number, number];
    expect(originalBytes).toBeGreaterThanOrEqual(0);
    expect(outputBytes).toBeGreaterThanOrEqual(0);
  });
});
