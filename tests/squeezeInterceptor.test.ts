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

const LOG_CONTENT = "error occurred\n".repeat(600);

async function configureSettings(opts: { enableLogSqueeze: boolean }): Promise<void> {
  const { existsSync, readFileSync, statSync } = await import("node:fs");
  vi.mocked(existsSync).mockImplementation((p: string) =>
    p === "/project/.pi/plugins/ast-bro/settings.json" || p === "/project/app.log",
  );
  vi.mocked(readFileSync).mockImplementation((p: string) => {
    if (p === "/project/.pi/plugins/ast-bro/settings.json") {
      return JSON.stringify({
        enabled: true,
        fileSizeThresholdLines: 500,
        enableLogSqueeze: opts.enableLogSqueeze,
        supportedExtensions: [".rs"],
      });
    }
    if (p === "/project/app.log") return LOG_CONTENT;
    return "{not valid json";
  });
  vi.mocked(statSync).mockImplementation((p: string) => {
    if (p === "/project/app.log") return { size: Buffer.byteLength(LOG_CONTENT, "utf-8") } as ReturnType<typeof statSync>;
    return { size: 0 } as ReturnType<typeof statSync>;
  });
}

describe("squeeze interception", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(process, "on").mockReturnValue(process);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces a large .log read with ast-bro squeeze when enabled", async () => {
    const pi = createMockPi();
    extensionFactory(pi);
    const { spawnSync } = await import("node:child_process");

    await configureSettings({ enableLogSqueeze: true });
    vi.mocked(spawnSync).mockImplementation((command: string, args: readonly string[]) => {
      if (command === "ast-bro" && args[0] === "--version") {
        return { status: 0, stdout: "ast-bro 3.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "ast-bro" && args[0] === "squeeze") {
        return { status: 0, stdout: "compressed log", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const ctx = createMockContext({ overrideResult: undefined });
    await invokeHandlers(pi, "tool_call", { toolName: "read", input: { path: "app.log" }, toolCallId: "tc1" }, ctx);

    const resultEvent = {
      toolName: "read",
      toolCallId: "tc1",
      input: { path: "app.log" },
      content: [{ type: "text", text: "original log content" }],
      isError: false,
    };
    const results = await invokeHandlers(pi, "tool_result", resultEvent, ctx);

    expect(spawnSync).toHaveBeenCalledWith("ast-bro", ["squeeze", "/project/app.log"], expect.any(Object));
    const patch = results.find((r) => r && typeof r === "object" && "content" in r);
    expect(patch).toEqual(
      expect.objectContaining({
        content: [{ type: "text", text: expect.stringContaining("compressed log") }],
      }),
    );
  });

  it("does not squeeze when enableLogSqueeze is off", async () => {
    const pi = createMockPi();
    extensionFactory(pi);
    const { spawnSync } = await import("node:child_process");

    await configureSettings({ enableLogSqueeze: false });
    vi.mocked(spawnSync).mockImplementation((command: string, args: readonly string[]) => {
      if (command === "ast-bro" && args[0] === "--version") {
        return { status: 0, stdout: "ast-bro 3.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const ctx = createMockContext({ overrideResult: undefined });
    await invokeHandlers(pi, "tool_call", { toolName: "read", input: { path: "app.log" }, toolCallId: "tc2" }, ctx);

    const resultEvent = {
      toolName: "read",
      toolCallId: "tc2",
      input: { path: "app.log" },
      content: [{ type: "text", text: "original" }],
      isError: false,
    };
    const results = await invokeHandlers(pi, "tool_result", resultEvent, ctx);

    expect(spawnSync).not.toHaveBeenCalledWith("ast-bro", ["squeeze", expect.any(String)], expect.any(Object));
    const patch = results.find((r) => r && typeof r === "object" && "content" in r);
    expect(patch).toBeUndefined();
  });

  it("bypasses squeeze when limit or offset is provided", async () => {
    const pi = createMockPi();
    extensionFactory(pi);
    const { spawnSync } = await import("node:child_process");

    await configureSettings({ enableLogSqueeze: true });
    vi.mocked(spawnSync).mockImplementation((command: string, args: readonly string[]) => {
      if (command === "ast-bro" && args[0] === "--version") {
        return { status: 0, stdout: "ast-bro 3.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const ctx = createMockContext({ overrideResult: undefined });
    await invokeHandlers(pi, "tool_call", {
      toolName: "read",
      input: { path: "app.log", offset: 1, limit: 50 },
      toolCallId: "tc3",
    }, ctx);

    const resultEvent = {
      toolName: "read",
      toolCallId: "tc3",
      input: { path: "app.log", offset: 1, limit: 50 },
      content: [{ type: "text", text: "original" }],
      isError: false,
    };
    await invokeHandlers(pi, "tool_result", resultEvent, ctx);

    expect(spawnSync).not.toHaveBeenCalledWith("ast-bro", ["squeeze", expect.any(String)], expect.any(Object));
  });

  it("falls back to default read when ast-bro squeeze fails", async () => {
    const pi = createMockPi();
    extensionFactory(pi);
    const { spawnSync } = await import("node:child_process");

    await configureSettings({ enableLogSqueeze: true });
    vi.mocked(spawnSync).mockImplementation((command: string, args: readonly string[]) => {
      if (command === "ast-bro" && args[0] === "--version") {
        return { status: 0, stdout: "ast-bro 3.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "ast-bro" && args[0] === "squeeze") {
        return { status: 1, stdout: "", stderr: "squeeze failed" } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const ctx = createMockContext({ overrideResult: undefined });
    await invokeHandlers(pi, "tool_call", { toolName: "read", input: { path: "app.log" }, toolCallId: "tc4" }, ctx);

    const resultEvent = {
      toolName: "read",
      toolCallId: "tc4",
      input: { path: "app.log" },
      content: [{ type: "text", text: "original" }],
      isError: false,
    };
    const results = await invokeHandlers(pi, "tool_result", resultEvent, ctx);

    expect(spawnSync).toHaveBeenCalledWith("ast-bro", ["squeeze", "/project/app.log"], expect.any(Object));
    const patch = results.find((r) => r && typeof r === "object" && "content" in r);
    expect(patch).toBeUndefined();
  });
});
