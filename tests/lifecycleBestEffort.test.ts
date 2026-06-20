import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extensionFactory from "../src/index.js";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: vi.fn(),
}));

interface MockExtensionAPI extends ExtensionAPI {
  handlers: Record<string, Array<(event: unknown, ctx: unknown) => unknown | Promise<unknown>>>;
  registeredTools: Parameters<ExtensionAPI["registerTool"]>[0][];
  registeredCommands: Record<string, unknown>;
}

interface MockContext {
  cwd: string;
  hasUI: boolean;
  mode: string;
  ui: {
    notify: ReturnType<typeof vi.fn>;
    confirm: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    input: ReturnType<typeof vi.fn>;
    custom: ReturnType<typeof vi.fn>;
  };
  overrideResult: ReturnType<typeof vi.fn>;
  sessionManager: {
    getEntries: ReturnType<typeof vi.fn>;
  };
}

function createMockPi(): MockExtensionAPI {
  const handlers: MockExtensionAPI["handlers"] = {};
  const registeredTools: MockExtensionAPI["registeredTools"] = [];
  const registeredCommands: MockExtensionAPI["registeredCommands"] = {};

  return {
    handlers,
    registeredTools,
    registeredCommands,
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown | Promise<unknown>) {
      (handlers[event] ??= []).push(handler);
    },
    registerTool(definition) {
      registeredTools.push(definition);
    },
    registerCommand(name, command) {
      registeredCommands[name] = command;
    },
    getAllTools() {
      return [];
    },
  } as MockExtensionAPI;
}

function createMockContext(overrides?: Partial<MockContext>): MockContext {
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
    overrideResult: vi.fn(),
    sessionManager: { getEntries: vi.fn().mockReturnValue([]) },
    ...overrides,
  } as MockContext;
}

async function invokeHandlers(
  pi: MockExtensionAPI,
  eventType: string,
  event: unknown,
  ctx: MockContext,
): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const handler of pi.handlers[eventType] ?? []) {
    results.push(await handler(event, ctx));
  }
  return results;
}

async function configureSettings(opts: {
  enableIndexRefresh?: boolean;
  enableCyclePreflight?: boolean;
}): Promise<void> {
  const { existsSync, readFileSync } = await import("node:fs");
  vi.mocked(existsSync).mockImplementation((p: string) =>
    p === "/project/.pi/plugins/ast-bro/settings.json" || p === "/project/src/file.rs",
  );
  vi.mocked(readFileSync).mockImplementation((p: string) => {
    if (p === "/project/.pi/plugins/ast-bro/settings.json") {
      return JSON.stringify({
        enabled: true,
        fileSizeThresholdLines: 500,
        enablePreFlightSyntaxChecks: false,
        enableIndexRefresh: opts.enableIndexRefresh ?? false,
        enableCyclePreflight: opts.enableCyclePreflight ?? false,
        supportedExtensions: [".rs"],
      });
    }
    if (p === "/project/src/file.rs") return "fn main() {}";
    return "{not valid json";
  });
}

describe("lifecycle best-effort hooks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(process, "on").mockReturnValue(process);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const editEventBase = {
    toolName: "edit",
    input: { path: "src/file.rs", edits: [{ oldText: "x", newText: "y" }] },
    content: [{ type: "text", text: "ok" }],
    isError: false,
    details: {},
  };

  it("does not throw or mutate result when index refresh fails", async () => {
    const pi = createMockPi();
    extensionFactory(pi);
    const { spawnSync } = await import("node:child_process");

    await configureSettings({ enableIndexRefresh: true });
    vi.mocked(spawnSync).mockImplementation((command: string, args: readonly string[]) => {
      if (command === "ast-bro" && args[0] === "--version") {
        return { status: 0, stdout: "ast-bro 3.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "ast-bro" && args[0] === "index") {
        return { status: 1, stdout: "", stderr: "index refresh failed" } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const ctx = createMockContext();
    const results = await invokeHandlers(pi, "tool_result", editEventBase, ctx);

    const patch = results.find((r) => r && typeof r === "object" && ("content" in r || "isError" in r));
    expect(patch).toBeUndefined();
  });

  it("does not throw or mutate result when cycle check fails", async () => {
    const pi = createMockPi();
    extensionFactory(pi);
    const { spawnSync } = await import("node:child_process");

    await configureSettings({ enableCyclePreflight: true });
    vi.mocked(spawnSync).mockImplementation((command: string, args: readonly string[]) => {
      if (command === "ast-bro" && args[0] === "--version") {
        return { status: 0, stdout: "ast-bro 3.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "ast-bro" && args[0] === "cycles") {
        return { status: 1, stdout: "", stderr: "cycles failed" } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const ctx = createMockContext();
    const results = await invokeHandlers(pi, "tool_result", editEventBase, ctx);

    const patch = results.find((r) => r && typeof r === "object" && ("content" in r || "isError" in r));
    expect(patch).toBeUndefined();
  });

  it("flags newly detected cycles involving the edited file", async () => {
    const pi = createMockPi();
    extensionFactory(pi);
    const { spawnSync } = await import("node:child_process");

    await configureSettings({ enableCyclePreflight: true });
    let cycleOutput = JSON.stringify([]);
    vi.mocked(spawnSync).mockImplementation((command: string, args: readonly string[]) => {
      if (command === "ast-bro" && args[0] === "--version") {
        return { status: 0, stdout: "ast-bro 3.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "ast-bro" && args[0] === "cycles") {
        return { status: 0, stdout: cycleOutput, stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const ctx = createMockContext();
    // First edit: establish empty baseline.
    await invokeHandlers(pi, "tool_result", editEventBase, ctx);

    // Second edit: introduce a new cycle with the edited file.
    cycleOutput = JSON.stringify([["/project/src/a.rs", "/project/src/file.rs"]]);
    const results = await invokeHandlers(pi, "tool_result", editEventBase, ctx);

    const patch = results.find((r) => r && typeof r === "object" && "content" in r);
    expect(patch).toBeDefined();
    const text = (patch as { content: Array<{ text: string }> }).content[0].text;
    expect(text).toContain("new import cycle");
    expect(text).toContain("/project/src/file.rs");
  });
});
