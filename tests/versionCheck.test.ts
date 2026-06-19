import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { writeFileSync } from "node:fs";

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

  it("disables the extension and notifies the user when pi-coding-agent version is incompatible", async () => {
    vi.mocked(writeFileSync).mockImplementation(() => undefined);

    const pi = createMockPi();
    extensionFactory(pi);

    const ctx = createMockContext();
    const [sessionHandler] = pi.handlers["session_start"]!;
    await sessionHandler({}, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("incompatible pi-coding-agent version (0.80.0)"),
      "error",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Expected ^0.79.8"), "error");
    expect(writeFileSync).toHaveBeenCalled();
    const writtenSettings = JSON.parse(
      (vi.mocked(writeFileSync).mock.calls[0] as [string, string])[1],
    ) as { enabled: boolean };
    expect(writtenSettings.enabled).toBe(false);
  });
});
