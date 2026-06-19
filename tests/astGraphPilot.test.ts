import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SettingsManager } from "../src/config.js";
import { registerAstGraphTool } from "../src/astGraphPilot.js";

vi.mock("node:child_process", () => ({
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

describe("astGraphPilot", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("spawns ast-bro graph with the resolved path", async () => {
    mockSettings();
    vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "--version") {
        return { status: 0, stdout: "1.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "which" && args?.[0] === "ast-bro") {
        return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "ast-bro" && args?.[0] === "graph") {
        return {
          status: 0,
          stdout: JSON.stringify({ nodes: [], edges: [{ from: "a", to: "b" }] }),
          stderr: "",
        } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const pi = createMockPi();
    const settings = new SettingsManager();
    registerAstGraphTool(pi, settings);
    const tool = getTool(pi, "analyze_ast_graph");

    const result = await tool.execute(
      "tc",
      { path: "backend/crates/core" },
      undefined,
      undefined,
      createMockContext(),
    );

    expect(spawnSync).toHaveBeenCalledWith(
      "ast-bro",
      ["graph", "--json", "--compact", "--hide-external", "/project/backend/crates/core"],
      expect.any(Object),
    );
    expect(result.isError).toBe(false);
    const payload = JSON.parse(getText(result));
    expect(payload.edges).toHaveLength(1);
    expect(payload.truncated).toBe(false);
  });

  it("defaults to the current working directory when no path is provided", async () => {
    mockSettings();
    vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "--version") {
        return { status: 0, stdout: "1.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "which" && args?.[0] === "ast-bro") {
        return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "ast-bro" && args?.[0] === "graph") {
        return { status: 0, stdout: JSON.stringify({ edges: [] }), stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const pi = createMockPi();
    const settings = new SettingsManager();
    registerAstGraphTool(pi, settings);
    const tool = getTool(pi, "analyze_ast_graph");

    await tool.execute("tc", {}, undefined, undefined, createMockContext());

    expect(spawnSync).toHaveBeenCalledWith(
      "ast-bro",
      ["graph", "--json", "--compact", "--hide-external", "/project"],
      expect.any(Object),
    );
  });

  it("truncates edges to graphMaxEdges and annotates the result", async () => {
    mockSettings({ graphMaxEdges: 2 });
    vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "--version") {
        return { status: 0, stdout: "1.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "which" && args?.[0] === "ast-bro") {
        return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "ast-bro" && args?.[0] === "graph") {
        return {
          status: 0,
          stdout: JSON.stringify({
            nodes: [],
            edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }],
          }),
          stderr: "",
        } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const pi = createMockPi();
    const settings = new SettingsManager();
    registerAstGraphTool(pi, settings);
    const tool = getTool(pi, "analyze_ast_graph");

    const result = await tool.execute("tc", {}, undefined, undefined, createMockContext());

    expect(result.isError).toBe(false);
    const payload = JSON.parse(getText(result));
    expect(payload.edges).toHaveLength(2);
    expect(payload.truncated).toBe(true);
    expect(payload.total_edges).toBe(3);
  });

  it("does not annotate truncation when the graph is within the limit", async () => {
    mockSettings({ graphMaxEdges: 10 });
    vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "--version") {
        return { status: 0, stdout: "1.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "which" && args?.[0] === "ast-bro") {
        return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "ast-bro" && args?.[0] === "graph") {
        return {
          status: 0,
          stdout: JSON.stringify({ nodes: [], edges: [{ from: "a", to: "b" }] }),
          stderr: "",
        } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const pi = createMockPi();
    const settings = new SettingsManager();
    registerAstGraphTool(pi, settings);
    const tool = getTool(pi, "analyze_ast_graph");

    const result = await tool.execute("tc", {}, undefined, undefined, createMockContext());

    const payload = JSON.parse(getText(result));
    expect(payload.truncated).toBe(false);
    expect(payload.total_edges).toBeUndefined();
  });

  it("returns an error when ast-bro graph exits non-zero", async () => {
    mockSettings();
    vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "--version") {
        return { status: 0, stdout: "1.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "which" && args?.[0] === "ast-bro") {
        return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "ast-bro" && args?.[0] === "graph") {
        return { status: 1, stdout: "", stderr: "graph failed" } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const pi = createMockPi();
    const settings = new SettingsManager();
    registerAstGraphTool(pi, settings);
    const tool = getTool(pi, "analyze_ast_graph");

    const result = await tool.execute("tc", {}, undefined, undefined, createMockContext());

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("graph failed");
  });

  it("rejects unsafe paths without invoking ast-bro", async () => {
    mockAstBroAvailable();
    mockSettings();

    const pi = createMockPi();
    const settings = new SettingsManager();
    registerAstGraphTool(pi, settings);
    const tool = getTool(pi, "analyze_ast_graph");

    const result = await tool.execute(
      "tc",
      { path: "src; rm -rf /" },
      undefined,
      undefined,
      createMockContext(),
    );

    expect(spawnSync).not.toHaveBeenCalledWith("ast-bro", expect.arrayContaining(["graph"]), expect.any(Object));
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("Invalid or unsafe file path");
  });
});

function getText(result: { content: Array<{ type: string; text: string }> }): string {
  return result.content[0]?.text ?? "";
}
