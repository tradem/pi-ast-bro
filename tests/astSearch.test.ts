import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerAstTools, parseSearchSummary, trimSearchSnippets } from "../src/tools.js";
import { StatsManager } from "../src/statsManager.js";
import type { Settings } from "../src/config.js";
import type { SettingsManager } from "../src/config.js";
import { clearAstBroInfoCache } from "../src/utils.js";
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
        ...overrides,
      }) as Settings,
  } as unknown as SettingsManager;
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

describe("parseSearchSummary", () => {
  it("groups hits by file and range", () => {
    const stdout = [
      "/project/src/a.rs:10-20 [score 0.9]",
      "snippet line one",
      "snippet line two",
      "/project/src/a.rs:30-40 [score 0.8]",
      "/project/src/b.rs:5-15 [score 0.7]",
      "",
    ].join("\n");

    const summary = parseSearchSummary(stdout);
    expect(summary).toEqual({
      total_hits: 3,
      files: {
        "/project/src/a.rs": {
          hit_count: 2,
          ranges: ["10-20", "30-40"],
        },
        "/project/src/b.rs": {
          hit_count: 1,
          ranges: ["5-15"],
        },
      },
    });
  });

  it("returns null when no headers are found", () => {
    expect(parseSearchSummary("just some raw output\nwithout headers")).toBeNull();
  });
});

describe("analyze_ast_search summary mode", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearAstBroInfoCache();
  });

  function mockSearchStdout(stdout: string, status = 0): void {
    mockAstBroAvailable();
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "search") {
        return emitSpawnResponse(status, stdout, status !== 0 ? "search error" : "");
      }
      return emitSpawnResponse(0, "", "");
    });
  }

  it("returns grouped JSON in summary mode", async () => {
    mockSearchStdout(
      "/project/src/foo.rs:10-20 [score 0.9]\nsnippet\n/project/src/foo.rs:30-40 [score 0.8]\n/project/src/bar.rs:5-15 [score 0.7]\n",
    );

    const pi = createMockPi();
    const stats = new StatsManager("");
    registerAstTools(pi, stats, createMockSettings());
    const tool = getTool(pi, "analyze_ast_search");

    const result = await tool.execute(
      "tc",
      { query: "character_id", mode: "summary" },
      undefined,
      undefined,
      createMockContext(),
    );

    expect(result.isError).toBe(false);
    const payload = JSON.parse(getText(result));
    expect(payload.total_hits).toBe(3);
    expect(payload.files["/project/src/foo.rs"].hit_count).toBe(2);
    expect(payload.files["/project/src/bar.rs"].ranges).toEqual(["5-15"]);
  });

  it("falls back to raw stdout when headers cannot be parsed", async () => {
    mockSearchStdout("unexpected output format");

    const pi = createMockPi();
    const stats = new StatsManager("");
    registerAstTools(pi, stats, createMockSettings());
    const tool = getTool(pi, "analyze_ast_search");

    const result = await tool.execute("tc", { query: "x", mode: "summary" }, undefined, undefined, createMockContext());

    expect(result.isError).toBe(false);
    expect(getText(result)).toBe("unexpected output format");
  });

  it("preserves raw snippet mode by default", async () => {
    mockSearchStdout("raw snippet output");

    const pi = createMockPi();
    const stats = new StatsManager("");
    registerAstTools(pi, stats, createMockSettings());
    const tool = getTool(pi, "analyze_ast_search");

    const result = await tool.execute("tc", { query: "x" }, undefined, undefined, createMockContext());

    expect(result.isError).toBe(false);
    expect(getText(result)).toBe("raw snippet output");
  });

  it("preserves raw snippet mode when explicitly requested", async () => {
    mockSearchStdout("raw snippet output");

    const pi = createMockPi();
    const stats = new StatsManager("");
    registerAstTools(pi, stats, createMockSettings());
    const tool = getTool(pi, "analyze_ast_search");

    const result = await tool.execute(
      "tc",
      { query: "x", mode: "snippets" },
      undefined,
      undefined,
      createMockContext(),
    );

    expect(result.isError).toBe(false);
    expect(getText(result)).toBe("raw snippet output");
  });

  it("reports isError true in summary mode when ast-bro search fails", async () => {
    mockSearchStdout("", 1);

    const pi = createMockPi();
    const stats = new StatsManager("");
    registerAstTools(pi, stats, createMockSettings());
    const tool = getTool(pi, "analyze_ast_search");

    const result = await tool.execute(
      "tc",
      { query: "x", mode: "summary" },
      undefined,
      undefined,
      createMockContext(),
    );

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("search error");
  });
});

describe("trimSearchSnippets", () => {
  it("is a no-op when output is under budget", () => {
    const stdout = [
      "/project/src/a.rs:10-20 [score 0.9]",
      "snippet line",
      "/project/src/b.rs:5-15 [score 0.8]",
      "snippet line",
    ].join("\n");

    const result = trimSearchSnippets(stdout, 8000);
    expect(result.output).toBe(stdout);
    expect(result.truncated).toBe(false);
    expect(result.omittedHits).toBe(0);
  });

  it("keeps top-ranked hits and annotates omissions", () => {
    const stdout = [
      "/project/src/first.rs:1-2 [score 0.9]",
      "line",
      "/project/src/second.rs:3-4 [score 0.8]",
      "line",
      "/project/src/third.rs:5-6 [score 0.7]",
      "line",
    ].join("\n");

    // Budget forces only the first hit to fit.
    const result = trimSearchSnippets(stdout, 1);
    expect(result.output).toContain("/project/src/first.rs:1-2 [score 0.9]");
    expect(result.output).not.toContain("/project/src/third.rs:5-6 [score 0.7]");
    expect(result.output).not.toContain("/project/src/second.rs:3-4 [score 0.8]");
    expect(result.truncated).toBe(true);
    expect(result.omittedHits).toBe(2);
    expect(result.output).toContain("2 additional hits omitted");
  });

  it("preserves singular wording for a single omitted hit", () => {
    const stdout = [
      "/project/src/first.rs:1-2 [score 0.9]",
      "line",
      "/project/src/second.rs:3-4 [score 0.8]",
      "line",
    ].join("\n");

    const result = trimSearchSnippets(stdout, 1);
    expect(result.omittedHits).toBe(1);
    expect(result.output).toContain("1 additional hit omitted");
  });
});

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? "";
}
