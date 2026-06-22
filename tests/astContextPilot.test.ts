import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "../src/config.js";
import { clearAstBroInfoCache } from "../src/utils.js";
import { registerAstContextTool } from "../src/astContextPilot.js";
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

interface TestTool {
  name: string;
  execute: (...args: unknown[]) => Promise<{ content: Array<{ type: string; text: string }>; isError: boolean }>;
}

interface MockExtensionAPI {
  registeredTools: unknown[];
  on(event: string, handler: (...args: unknown[]) => unknown): void;
  registerTool(definition: unknown): void;
  registerCommand(name: string, command: unknown): void;
  getAllTools(): unknown[];
}

function createMockPi(): MockExtensionAPI {
  const registeredTools: unknown[] = [];
  return {
    registeredTools,
    on() {},
    registerTool(definition) {
      registeredTools.push(definition);
    },
    registerCommand() {},
    getAllTools() {
      return [];
    },
  } as MockExtensionAPI;
}

function getTool(pi: MockExtensionAPI, name: string): TestTool {
  return pi.registeredTools.find((t) => (t as TestTool).name === name) as TestTool;
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

function mockSettings(settings: Record<string, unknown> = {}): void {
  vi.mocked(existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (p: string) => p === "/project/.pi/plugins/ast-bro/settings.json",
  );
  vi.mocked(readFileSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((p: string) => {
    if (p === "/project/.pi/plugins/ast-bro/settings.json") {
      return JSON.stringify(settings);
    }
    return "";
  });
}

function mockAstBroAvailable(): void {
  vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
    if (command === "ast-bro" && args?.[0] === "--version") {
      return { status: 0, stdout: "1.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
    }
    if (command === "which" && args?.[0] === "ast-bro") {
      return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
    }
    return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
  });
}

describe("astContextPilot", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearAstBroInfoCache();
  });

  it("spawns ast-bro context with target, path, and explicit budget", async () => {
    mockSettings();
    mockAstBroAvailable();

    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "context") {
        return emitSpawnResponse(0, "{\"ok\":true}", "");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const settings = new SettingsManager();
    registerAstContextTool(pi as never, settings);
    const tool = getTool(pi, "analyze_ast_context");

    const result = await tool.execute(
      "tc",
      { path: "backend/crates/core", target: "CostumeAggregate", budget: 8000 },
      undefined,
      undefined,
      createMockContext(),
    );

    expect(spawn).toHaveBeenCalledWith(
      "ast-bro",
      ["context", "--json", "--compact", "--budget", "8000", "CostumeAggregate", "backend/crates/core"],
      expect.any(Object),
    );
    expect(result.isError).toBe(false);
    expect(getText(result)).toContain('"ok":true');
  });

  it("uses contextDefaultBudget from settings when budget is omitted", async () => {
    mockSettings({ contextDefaultBudget: 6000 });
    mockAstBroAvailable();

    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "context") {
        return emitSpawnResponse(0, "{\"ok\":true}", "");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const settings = new SettingsManager();
    registerAstContextTool(pi as never, settings);
    const tool = getTool(pi, "analyze_ast_context");

    await tool.execute("tc", { path: "src/lib.rs" }, undefined, undefined, createMockContext());

    expect(spawn).toHaveBeenCalledWith(
      "ast-bro",
      ["context", "--json", "--compact", "--budget", "6000", "src/lib.rs"],
      expect.any(Object),
    );
  });

  it("returns an error when ast-bro context exits non-zero", async () => {
    mockSettings();
    mockAstBroAvailable();

    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "context") {
        return emitSpawnResponse(1, "", "context failed");
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const settings = new SettingsManager();
    registerAstContextTool(pi as never, settings);
    const tool = getTool(pi, "analyze_ast_context");

    const result = await tool.execute("tc", { path: "src/lib.rs" }, undefined, undefined, createMockContext());

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("context failed");
  });

  it("rejects unsafe paths without invoking ast-bro", async () => {
    mockAstBroAvailable();
    mockSettings();

    const pi = createMockPi();
    const settings = new SettingsManager();
    registerAstContextTool(pi as never, settings);
    const tool = getTool(pi, "analyze_ast_context");

    const result = await tool.execute(
      "tc",
      { path: "src/lib.rs; rm -rf /" },
      undefined,
      undefined,
      createMockContext(),
    );

    expect(spawn).not.toHaveBeenCalledWith("ast-bro", expect.arrayContaining(["context"]), expect.any(Object));
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("Invalid or unsafe file path");
  });

  it("rejects unsafe targets without invoking ast-bro", async () => {
    mockAstBroAvailable();
    mockSettings();

    const pi = createMockPi();
    const settings = new SettingsManager();
    registerAstContextTool(pi as never, settings);
    const tool = getTool(pi, "analyze_ast_context");

    const result = await tool.execute(
      "tc",
      { path: "src/lib.rs", target: "Foo; rm -rf /" },
      undefined,
      undefined,
      createMockContext(),
    );

    expect(spawn).not.toHaveBeenCalledWith("ast-bro", expect.arrayContaining(["context"]), expect.any(Object));
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("Invalid or unsafe target symbol");
  });

  it("returns an error when ast-bro is unavailable", async () => {
    mockSettings();
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "not found",
    } as ReturnType<typeof spawnSync>);

    const pi = createMockPi();
    const settings = new SettingsManager();
    registerAstContextTool(pi as never, settings);
    const tool = getTool(pi, "analyze_ast_context");

    const result = await tool.execute("tc", { path: "src/lib.rs" }, undefined, undefined, createMockContext());

    expect(spawnSync).toHaveBeenCalledWith("ast-bro", ["--version"], expect.any(Object));
    expect(spawn).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("not installed");
  });

  it("returns an error when the call is aborted", async () => {
    mockSettings();
    mockAstBroAvailable();

    const controller = new AbortController();

    vi.mocked(spawn).mockImplementation((command: string, _args?: readonly string[]) => {
      if (command === "ast-bro") {
        const child = emitSpawnResponse(0, "{\"ok\":true}", "");
        // Simulate the abort firing before the child closes.
        controller.abort();
        return child;
      }
      return emitSpawnResponse(0, "", "");
    });

    const pi = createMockPi();
    const settings = new SettingsManager();
    registerAstContextTool(pi as never, settings);
    const tool = getTool(pi, "analyze_ast_context");

    const result = await tool.execute(
      "tc",
      { path: "src/lib.rs" },
      controller.signal,
      undefined,
      createMockContext(),
    );

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("aborted");
  });
});

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? "";
}
