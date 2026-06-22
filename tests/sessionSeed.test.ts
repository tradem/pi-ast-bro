// @ts-nocheck
import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extensionFactory from "../src/index.js";
import { clearSessionSeed } from "../src/sessionSeedState.js";
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

async function configureSettings(seedOptions: {
  enabled: boolean;
  budget?: number;
  scope?: "cwd" | "root";
}): Promise<void> {
  const { existsSync, readFileSync } = await import("node:fs");
  vi.mocked(existsSync).mockImplementation((p: string) => p === "/project/.pi/plugins/ast-bro/settings.json");
  vi.mocked(readFileSync).mockImplementation((p: string) => {
    if (p === "/project/.pi/plugins/ast-bro/settings.json") {
      return JSON.stringify({
        enabled: true,
        fileSizeThresholdLines: 500,
        enableSessionSeed: seedOptions.enabled,
        sessionSeedBudget: seedOptions.budget ?? 4000,
        sessionSeedScope: seedOptions.scope ?? "root",
        supportedExtensions: [".rs"],
      });
    }
    return "{not valid json";
  });
}

function mockAstBro(version: string, digestStdout = ""): void {
  vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
    if (command === "ast-bro" && args?.[0] === "--version") {
      return emitSpawnResponse(0, version, "");
    }
    if (command === "ast-bro" && args?.[0] === "digest") {
      return emitSpawnResponse(0, digestStdout, "");
    }
    return emitSpawnResponse(0, "", "");
  });

  vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
    if (command === "which" && args?.[0] === "ast-bro") {
      return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
    }
    return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
  });
}

describe("session seed", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(process, "on").mockReturnValue(process);
    clearSessionSeed("/project");
    clearAstBroInfoCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is no-op by default", async () => {
    const pi = createMockPi();
    extensionFactory(pi);
    const { spawnSync } = await import("node:child_process");

    await configureSettings({ enabled: false });
    vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "--version") {
        return { status: 0, stdout: "ast-bro 3.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });
    vi.mocked(spawn).mockImplementation(() => emitSpawnResponse(0, "", ""));

    const ctx = createMockContext();
    await invokeHandlers(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
    const results = await invokeHandlers(pi, "before_agent_start", { type: "before_agent_start" }, ctx);

    expect(spawn).not.toHaveBeenCalledWith("ast-bro", ["digest", expect.any(String)], expect.any(Object));
    const messageResult = results.find(
      (r) => r && typeof r === "object" && "message" in r,
    );
    expect(messageResult).toBeUndefined();
  });

  it("injects a digest message when enabled", async () => {
    const pi = createMockPi();
    extensionFactory(pi);
    const { spawnSync } = await import("node:child_process");

    await configureSettings({ enabled: true });
    mockAstBro("ast-bro 3.0.0", "digest output");

    const ctx = createMockContext();
    await invokeHandlers(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
    const results = await invokeHandlers(pi, "before_agent_start", { type: "before_agent_start" }, ctx);

    expect(spawn).toHaveBeenCalledWith("ast-bro", ["digest", "/project"], expect.any(Object));
    const messageResult = results.find(
      (r) => r && typeof r === "object" && "message" in r,
    ) as { message: { customType: string; content: string; display: boolean } } | undefined;
    expect(messageResult).toBeDefined();
    expect(messageResult!.message.customType).toBe("ast-bro-session-seed");
    expect(messageResult!.message.content).toContain("digest output");
    expect(messageResult!.message.display).toBe(false);
  });

  it("trims and annotates when the digest exceeds the budget", async () => {
    const pi = createMockPi();
    extensionFactory(pi);

    await configureSettings({ enabled: true, budget: 500 });
    const longDigest = "x".repeat(3000);
    mockAstBro("ast-bro 3.0.0", longDigest);

    const ctx = createMockContext();
    await invokeHandlers(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
    const results = await invokeHandlers(pi, "before_agent_start", { type: "before_agent_start" }, ctx);

    const messageResult = results.find(
      (r) => r && typeof r === "object" && "message" in r,
    ) as { message: { content: string } } | undefined;
    expect(messageResult).toBeDefined();
    expect(messageResult!.message.content).toContain("partial repo map");
  });

  it("falls back gracefully when ast-bro digest fails", async () => {
    const pi = createMockPi();
    extensionFactory(pi);
    const { spawn } = await import("node:child_process");
    const { spawnSync } = await import("node:child_process");

    await configureSettings({ enabled: true });
    vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "--version") {
        return emitSpawnResponse(0, "ast-bro 3.0.0", "");
      }
      if (command === "ast-bro" && args?.[0] === "digest") {
        return emitSpawnResponse(1, "", "digest error");
      }
      return emitSpawnResponse(0, "", "");
    });
    vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "which" && args?.[0] === "ast-bro") {
        return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const ctx = createMockContext();
    await invokeHandlers(pi, "session_start", { type: "session_start", reason: "startup" }, ctx);
    const results = await invokeHandlers(pi, "before_agent_start", { type: "before_agent_start" }, ctx);

    const messageResult = results.find(
      (r) => r && typeof r === "object" && "message" in r,
    );
    expect(messageResult).toBeUndefined();
  });
});
