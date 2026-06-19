import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  return { ...actual, VERSION: "0.80.0" };
});

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import extensionFactory from "../src/index.js";

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

describe("pi version compatibility check", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("warns but keeps running when pi-coding-agent version is outside the tested range", async () => {
    vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "--version") {
        return { status: 0, stdout: "1.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      if (command === "which" && args?.[0] === "ast-bro") {
        return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
      }
      return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
    });

    const pi = createMockPi();
    extensionFactory(pi);

    const ctx = createMockContext();
    const [sessionHandler] = pi.handlers["session_start"]!;
    await sessionHandler({}, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("pi-coding-agent 0.80.0 is outside the tested range"),
      "warning",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("ast-bro detected"),
      "info",
    );
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
