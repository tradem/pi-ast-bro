import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
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

interface MockExtensionAPI extends ExtensionAPI {
  handlers: Record<string, Array<(event: unknown, ctx: unknown) => unknown | Promise<unknown>>>;
}

function createMockPi(): MockExtensionAPI {
  const handlers: MockExtensionAPI["handlers"] = {};
  return {
    handlers,
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown | Promise<unknown>) {
      (handlers[event] ??= []).push(handler);
    },
    registerTool() {},
    registerCommand() {},
    getAllTools() {
      return [];
    },
  } as unknown as MockExtensionAPI;
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

function mockAstBroVersion(version: string): void {
  vi.mocked(spawn).mockImplementation((command: string, args?: readonly string[]) => {
    if (command === "ast-bro" && args?.[0] === "--version") {
      return emitSpawnResponse(0, version, "");
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

/**
 * Load the extension under a mocked pi-coding-agent VERSION. Uses vi.doMock +
 * dynamic import so each test can run against a different runtime version.
 */
async function loadExtensionWithPiVersion(piVersion: string): Promise<{
  factory: (pi: ExtensionAPI) => void;
}> {
  vi.resetModules();
  vi.doMock("@earendil-works/pi-coding-agent", async () => {
    const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
      "@earendil-works/pi-coding-agent",
    );
    return { ...actual, VERSION: piVersion };
  });
  const mod = await import("../src/index.js");
  return { factory: mod.default };
}

describe("pi version compatibility check", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearAstBroInfoCache();
  });

  it("fires no 'outside tested range' warning when pi version is 0.80.2", async () => {
    mockAstBroVersion("3.0.0");

    const { factory } = await loadExtensionWithPiVersion("0.80.2");
    const pi = createMockPi();
    factory(pi);

    const ctx = createMockContext();
    const [sessionHandler] = pi.handlers["session_start"]!;
    await sessionHandler({}, ctx);

    expect(ctx.ui.notify).not.toHaveBeenCalledWith(
      expect.stringContaining("outside the tested range"),
      "warning",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("ast-bro detected"),
      "info",
    );
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("fires exactly one 'outside tested range' warning when pi version is 0.81.0", async () => {
    mockAstBroVersion("3.0.0");

    const { factory } = await loadExtensionWithPiVersion("0.81.0");
    const pi = createMockPi();
    factory(pi);

    const ctx = createMockContext();
    const [sessionHandler] = pi.handlers["session_start"]!;
    await sessionHandler({}, ctx);

    const warningCalls = vi.mocked(ctx.ui.notify).mock.calls.filter(([message, level]) =>
      typeof message === "string" &&
      message.includes("outside the tested range") &&
      level === "warning",
    );
    expect(warningCalls).toHaveLength(1);
    expect(warningCalls[0]![0]).toContain("0.81.0");
    expect(warningCalls[0]![0]).toContain("^0.80.0");
  });
});
