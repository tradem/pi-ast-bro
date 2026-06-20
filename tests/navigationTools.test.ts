import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerNavigationTools } from "../src/astNavigationTools.js";
import { SettingsManager } from "../src/config.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

interface MockExtensionAPI extends ExtensionAPI {
  registeredTools: Parameters<ExtensionAPI["registerTool"]>[0][];
}

function createMockPi(): MockExtensionAPI {
  const registeredTools: MockExtensionAPI["registeredTools"] = [];
  return {
    registeredTools,
    registerTool(definition) {
      registeredTools.push(definition);
    },
    on() {},
    registerCommand() {},
    getAllTools() {
      return [];
    },
  } as MockExtensionAPI;
}

function createMockContext(): { cwd: string; ui: { notify: ReturnType<typeof vi.fn> } } {
  return { cwd: "/project", ui: { notify: vi.fn() } };
}

describe("navigation tools", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an error result when ast-bro is unavailable", async () => {
    const pi = createMockPi();
    const settings = new SettingsManager();
    registerNavigationTools(pi, settings);

    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockReturnValue({
      status: 1,
      stdout: "",
      stderr: "not found",
    } as ReturnType<typeof spawnSync>);

    const traceTool = pi.registeredTools.find((t) => t.name === "analyze_ast_trace")!;
    const result = await traceTool.execute(
      "tc",
      { from: "foo", to: "bar" },
      new AbortController().signal,
      undefined,
      createMockContext(),
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("not installed");
  });

  it("validates trace symbol inputs", async () => {
    const pi = createMockPi();
    const settings = new SettingsManager();
    registerNavigationTools(pi, settings);

    const traceTool = pi.registeredTools.find((t) => t.name === "analyze_ast_trace")!;
    const result = await traceTool.execute(
      "tc",
      { from: "foo; rm -rf /", to: "bar" },
      new AbortController().signal,
      undefined,
      createMockContext(),
    );

    expect(result.isError).toBe(true);
  });

  it("runs ast-bro trace for valid inputs", async () => {
    const pi = createMockPi();
    const settings = new SettingsManager();
    registerNavigationTools(pi, settings);

    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockImplementation((command: string, args: readonly string[]) => {
      if (command === "ast-bro" && args[0] === "--version") {
        return { status: 0, stdout: "ast-bro 3.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "ast-bro" && args[0] === "trace") {
        return { status: 0, stdout: "path found", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const traceTool = pi.registeredTools.find((t) => t.name === "analyze_ast_trace")!;
    const result = await traceTool.execute(
      "tc",
      { from: "foo", to: "bar" },
      new AbortController().signal,
      undefined,
      createMockContext(),
    );

    expect(spawnSync).toHaveBeenCalledWith("ast-bro", ["trace", "foo", "bar", "/project"], expect.any(Object));
    expect(result.isError).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain("path found");
  });

  it("validates surface path inputs", async () => {
    const pi = createMockPi();
    const settings = new SettingsManager();
    registerNavigationTools(pi, settings);

    const surfaceTool = pi.registeredTools.find((t) => t.name === "analyze_ast_surface")!;
    const result = await surfaceTool.execute(
      "tc",
      { path: "src; rm -rf /" },
      new AbortController().signal,
      undefined,
      createMockContext(),
    );

    expect(result.isError).toBe(true);
  });

  it("runs ast-bro surface for valid inputs", async () => {
    const pi = createMockPi();
    const settings = new SettingsManager();
    registerNavigationTools(pi, settings);

    const { spawnSync } = await import("node:child_process");
    vi.mocked(spawnSync).mockImplementation((command: string, args: readonly string[]) => {
      if (command === "ast-bro" && args[0] === "--version") {
        return { status: 0, stdout: "ast-bro 3.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "ast-bro" && args[0] === "surface") {
        return { status: 0, stdout: "pub fn api()", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const surfaceTool = pi.registeredTools.find((t) => t.name === "analyze_ast_surface")!;
    const result = await surfaceTool.execute(
      "tc",
      { path: "src" },
      new AbortController().signal,
      undefined,
      createMockContext(),
    );

    expect(spawnSync).toHaveBeenCalledWith("ast-bro", ["surface", "/project/src"], expect.any(Object));
    expect(result.isError).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain("pub fn api()");
  });
});
