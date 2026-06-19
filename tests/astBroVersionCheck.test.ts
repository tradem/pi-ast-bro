import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

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

describe("ast-bro version compatibility check", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("disables the extension when ast-bro version is below the supported range", async () => {
    vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "--version") {
        return { status: 0, stdout: "0.0.1", stderr: "" } as ReturnType<typeof spawnSync>;
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
      expect.stringContaining("installed ast-bro (0.0.1) is not supported"),
      "error",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("Expected >=3.0.0 <3.2.0"),
      "error",
    );
    expect(writeFileSync).toHaveBeenCalled();
    const writtenSettings = JSON.parse(
      (vi.mocked(writeFileSync).mock.calls[0] as [string, string])[1],
    ) as { enabled: boolean };
    expect(writtenSettings.enabled).toBe(false);
  });

  it("accepts ast-bro 3.0.0 as supported", async () => {
    vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "--version") {
        return { status: 0, stdout: "3.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
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

    expect(ctx.ui.notify).toHaveBeenCalledWith("pi-ast-bro: ast-bro detected", "info");
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("extracts the semver from prefixed version output like 'ast-bro 3.1.0'", async () => {
    vi.mocked(spawnSync).mockImplementation((command: string, args?: readonly string[]) => {
      if (command === "ast-bro" && args?.[0] === "--version") {
        return { status: 0, stdout: "ast-bro 3.1.0\n", stderr: "" } as ReturnType<typeof spawnSync>;
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

    expect(ctx.ui.notify).toHaveBeenCalledWith("pi-ast-bro: ast-bro detected", "info");
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
