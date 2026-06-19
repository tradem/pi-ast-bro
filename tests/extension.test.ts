import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import extensionFactory from "../src/index.js";

vi.mock("node:child_process", () => ({
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
  registeredTools: Parameters<ExtensionAPI["registerTool"]>[0][];
  registeredCommands: Record<string, unknown>;
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

interface MockContext extends ExtensionContext {
  overrideResult: ReturnType<typeof vi.fn>;
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

describe("pi-ast-bro extension", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(process, "on").mockReturnValue(process);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("scaffolding and lifecycle", () => {
    it("exports an extension factory and registers expected handlers", () => {
      const pi = createMockPi();
      extensionFactory(pi);
      expect(pi.handlers["tool_call"]).toHaveLength(2); // read + view_file
      expect(pi.handlers["tool_result"]).toHaveLength(3); // read fallback + view_file fallback + edit/write
      expect(pi.handlers["session_start"]).toHaveLength(1);
      expect(pi.registeredTools.map((t) => t.name).sort()).toEqual([
        "analyze_ast_impact",
        "analyze_ast_map",
        "analyze_ast_search",
      ]);
      expect(pi.registeredCommands["ast"]).toBeDefined();
      expect(pi.registeredCommands["ast-gain"]).toBeDefined();
      expect(process.on).toHaveBeenCalledWith("exit", expect.any(Function));
    });

    it("prompts to install ast-bro on startup when binary is missing and user confirms", async () => {
      const pi = createMockPi();
      extensionFactory(pi);
      const { spawnSync } = await import("node:child_process");
      const { existsSync } = await import("node:fs");

      vi.mocked(spawnSync).mockImplementation((command: string, args: string[]) => {
        if (command === "ast-bro" && args[0] === "--version") {
          return { status: 1, stdout: "", stderr: "not found" } as ReturnType<typeof spawnSync>;
        }
        if (command === "ast-bro" && args[0] === "install") {
          return { status: 0, stdout: "installed", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
      });
      vi.mocked(existsSync).mockReturnValue(true);

      const ctx = createMockContext({ ui: { ...createMockContext().ui, confirm: vi.fn().mockResolvedValue(true) } });
      const [sessionHandler] = pi.handlers["session_start"]!;
      await sessionHandler({}, ctx);

      expect(ctx.ui.confirm).toHaveBeenCalledWith(
        "ast-bro not found",
        "The ast-bro binary is not in PATH. Would you like to install it?",
      );
      expect(spawnSync).toHaveBeenCalledWith("ast-bro", ["install"], expect.any(Object));
      expect(ctx.ui.notify).toHaveBeenCalledWith("pi-ast-bro: ast-bro installed successfully", "info");
    });
  });

  describe("read interceptor", () => {
    async function mockFileContent(path: string, content: string): Promise<void> {
      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockImplementation((p: string) => p === path);
      vi.mocked(fs.readFileSync).mockImplementation((p: string) => {
        if (p === path) return content;
        // Any other file read (e.g. corrupt settings file) returns invalid JSON so
        // SettingsManager falls back to defaults.
        return "{not valid json";
      });
    }

    it("uses ctx.overrideResult when the runtime supports it", async () => {
      const pi = createMockPi();
      extensionFactory(pi);
      const { spawnSync } = await import("node:child_process");

      await mockFileContent("/project/src/large.rs", "line\n".repeat(501));
      vi.mocked(spawnSync).mockImplementation((command: string, args: string[]) => {
        if (command === "ast-bro" && args[0] === "map") {
          return { status: 0, stdout: "AST context summary", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
      });

      const ctx = createMockContext();
      const event = { toolName: "read", input: { path: "src/large.rs" }, toolCallId: "tc1" };
      await invokeHandlers(pi, "tool_call", event, ctx);

      expect(spawnSync).toHaveBeenCalledWith("ast-bro", ["map", "/project/src/large.rs"], expect.any(Object));
      expect(ctx.overrideResult).toHaveBeenCalledTimes(1);
      expect(ctx.overrideResult).toHaveBeenCalledWith({
        content: [{ type: "text", text: expect.stringContaining("AST context summary") }],
      });
      expect(ctx.overrideResult).toHaveBeenCalledWith({
        content: [{ type: "text", text: expect.stringContaining("full raw source") }],
      });
    });

    it("rewrites the tool_result when overrideResult is unavailable (e.g. pi 0.79.8)", async () => {
      const pi = createMockPi();
      extensionFactory(pi);
      const { spawnSync } = await import("node:child_process");

      await mockFileContent("/project/src/large.rs", "line\n".repeat(501));
      vi.mocked(spawnSync).mockImplementation((command: string, args: string[]) => {
        if (command === "ast-bro" && args[0] === "map") {
          return { status: 0, stdout: "AST context summary", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
      });

      // Simulate pi versions that do not expose ctx.overrideResult.
      const ctx = createMockContext({ overrideResult: undefined });

      const toolCallEvent = { toolName: "read", input: { path: "src/large.rs" }, toolCallId: "tc1" };
      await invokeHandlers(pi, "tool_call", toolCallEvent, ctx);

      // tool_call does not call overrideResult, so it should have registered a pending rewrite.
      if (ctx.overrideResult) expect(ctx.overrideResult).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalledWith("ast-bro", ["context", "/project/src/large.rs"], expect.any(Object));

      const toolResultEvent = {
        toolName: "read",
        toolCallId: "tc1",
        input: { path: "src/large.rs" },
        content: [{ type: "text", text: "original file content with many lines\n".repeat(400) }],
        isError: false,
      };
      const results = await invokeHandlers(pi, "tool_result", toolResultEvent, ctx);

      expect(spawnSync).toHaveBeenCalledWith("ast-bro", ["map", "/project/src/large.rs"], expect.any(Object));
      const patch = results.find((r) => r && typeof r === "object" && "content" in r);
      expect(patch).toEqual(
        expect.objectContaining({
          content: [{ type: "text", text: expect.stringContaining("AST context summary") }],
        }),
      );
    });

    it("does not rewrite when offset or limit are present (raw bypass)", async () => {
      const pi = createMockPi();
      extensionFactory(pi);
      const { spawnSync } = await import("node:child_process");
      const { existsSync, readFileSync } = await import("node:fs");

      vi.mocked(existsSync).mockImplementation((p: string) => p === "/project/src/large.rs");
      vi.mocked(readFileSync).mockImplementation((p: string) =>
        p === "/project/src/large.rs" ? "line\n".repeat(501) : "{not valid json",
      );

      const ctx = createMockContext({ overrideResult: undefined });
      const toolCallEvent = { toolName: "read", input: { path: "src/large.rs", offset: 1, limit: 50 }, toolCallId: "tc2" };
      await invokeHandlers(pi, "tool_call", toolCallEvent, ctx);

      const toolResultEvent = {
        toolName: "read",
        toolCallId: "tc2",
        input: { path: "src/large.rs", offset: 1, limit: 50 },
        content: [{ type: "text", text: "original" }],
        isError: false,
      };
      await invokeHandlers(pi, "tool_result", toolResultEvent, ctx);

      expect(spawnSync).not.toHaveBeenCalledWith("ast-bro", ["map", expect.any(String)], expect.any(Object));
    });

    it("does not rewrite small files", async () => {
      const pi = createMockPi();
      extensionFactory(pi);
      const { spawnSync } = await import("node:child_process");
      const { existsSync, readFileSync } = await import("node:fs");

      vi.mocked(existsSync).mockImplementation((p: string) => p === "/project/src/small.rs");
      vi.mocked(readFileSync).mockImplementation((p: string) =>
        p === "/project/src/small.rs" ? "line\n".repeat(10) : "{not valid json",
      );

      const ctx = createMockContext({ overrideResult: undefined });
      const toolCallEvent = { toolName: "read", input: { path: "src/small.rs" }, toolCallId: "tc3" };
      await invokeHandlers(pi, "tool_call", toolCallEvent, ctx);

      const toolResultEvent = {
        toolName: "read",
        toolCallId: "tc3",
        input: { path: "src/small.rs" },
        content: [{ type: "text", text: "original" }],
        isError: false,
      };
      await invokeHandlers(pi, "tool_result", toolResultEvent, ctx);

      expect(spawnSync).not.toHaveBeenCalled();
    });

    it("does not rewrite unsupported extensions", async () => {
      const pi = createMockPi();
      extensionFactory(pi);
      const { spawnSync } = await import("node:child_process");
      const { existsSync, readFileSync } = await import("node:fs");

      vi.mocked(existsSync).mockImplementation((p: string) => p === "/project/docs/readme.md");
      vi.mocked(readFileSync).mockImplementation((p: string) =>
        p === "/project/docs/readme.md" ? "line\n".repeat(501) : "{not valid json",
      );

      const ctx = createMockContext({ overrideResult: undefined });
      const toolCallEvent = { toolName: "read", input: { path: "docs/readme.md" }, toolCallId: "tc4" };
      await invokeHandlers(pi, "tool_call", toolCallEvent, ctx);

      const toolResultEvent = {
        toolName: "read",
        toolCallId: "tc4",
        input: { path: "docs/readme.md" },
        content: [{ type: "text", text: "original" }],
        isError: false,
      };
      await invokeHandlers(pi, "tool_result", toolResultEvent, ctx);

      expect(spawnSync).not.toHaveBeenCalled();
    });

    it("falls back silently when ast-bro context exits with an error", async () => {
      const pi = createMockPi();
      extensionFactory(pi);
      const { spawnSync } = await import("node:child_process");
      const { existsSync, readFileSync } = await import("node:fs");

      vi.mocked(existsSync).mockImplementation((p: string) => p === "/project/src/large.rs");
      vi.mocked(readFileSync).mockImplementation((p: string) =>
        p === "/project/src/large.rs" ? "line\n".repeat(501) : "{not valid json",
      );
      vi.mocked(spawnSync).mockReturnValue({
        status: 1,
        stdout: "",
        stderr: "parse error",
      } as ReturnType<typeof spawnSync>);

      const ctx = createMockContext({ overrideResult: undefined });
      const toolCallEvent = { toolName: "read", input: { path: "src/large.rs" }, toolCallId: "tc5" };
      await invokeHandlers(pi, "tool_call", toolCallEvent, ctx);

      const toolResultEvent = {
        toolName: "read",
        toolCallId: "tc5",
        input: { path: "src/large.rs" },
        content: [{ type: "text", text: "original" }],
        isError: false,
      };
      const results = await invokeHandlers(pi, "tool_result", toolResultEvent, ctx);

      const patch = results.find((r) => r && typeof r === "object" && "content" in r);
      expect(patch).toBeUndefined();
    });
  });

  describe("pre-flight edit/write interceptor", () => {
    it("mutates edit result to isError: true when ast-bro map reports a syntax fault", async () => {
      const pi = createMockPi();
      extensionFactory(pi);
      const { spawnSync } = await import("node:child_process");
      const { existsSync, readFileSync } = await import("node:fs");

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue("");
      vi.mocked(spawnSync).mockImplementation((command: string, args: string[]) => {
        if (command === "ast-bro" && args[0] === "--version") {
          return { status: 0, stdout: "1.0", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        if (command === "ast-bro" && args[0] === "map") {
          return { status: 1, stdout: "", stderr: "unexpected token at line 10" } as ReturnType<typeof spawnSync>;
        }
        return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
      });

      const ctx = createMockContext();
      const event = {
        toolName: "edit",
        input: { path: "src/broken.rs", edits: [{ oldText: "x", newText: "y" }] },
        content: [{ type: "text", text: "ok" }],
        isError: false,
        details: { diff: "...", patch: "..." },
      };
      const results = await invokeHandlers(pi, "tool_result", event, ctx);

      expect(spawnSync).toHaveBeenCalledWith("ast-bro", ["map", "/project/src/broken.rs"], expect.any(Object));
      const patch = results.find((r) => r && typeof r === "object" && "isError" in r);
      expect(patch).toEqual(
        expect.objectContaining({
          isError: true,
          content: [{ type: "text", text: expect.stringContaining("unexpected token at line 10") }],
        }),
      );
    });

    it("does not mutate result when ast-bro map succeeds", async () => {
      const pi = createMockPi();
      extensionFactory(pi);
      const { spawnSync } = await import("node:child_process");
      const { existsSync } = await import("node:fs");

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(spawnSync).mockImplementation((command: string, args: string[]) => {
        if (command === "ast-bro" && args[0] === "--version") {
          return { status: 0, stdout: "1.0", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        if (command === "ast-bro" && args[0] === "map") {
          return { status: 0, stdout: "OK", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
      });

      const ctx = createMockContext();
      const event = {
        toolName: "write",
        input: { path: "src/clean.rs", content: "fn main() {}" },
        content: [{ type: "text", text: "written" }],
        isError: false,
      };
      const results = await invokeHandlers(pi, "tool_result", event, ctx);

      const patch = results.find((r) => r && typeof r === "object" && "isError" in r);
      expect(patch).toBeUndefined();
    });
  });

  describe("dedicated AST tools", () => {
    it("execute analyze_ast_impact by spawning ast-bro impact", async () => {
      const pi = createMockPi();
      extensionFactory(pi);
      const { spawnSync } = await import("node:child_process");

      vi.mocked(spawnSync).mockImplementation((command: string, args: string[]) => {
        if (command === "ast-bro" && args[0] === "--version") {
          return { status: 0, stdout: "1.0", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        if (command === "ast-bro" && args[0] === "impact") {
          return { status: 0, stdout: "impact result", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
      });

      const impactTool = pi.registeredTools.find((t) => t.name === "analyze_ast_impact")!;
      const result = await impactTool.execute("tc", { path: "src/lib.rs" }, new AbortController().signal, undefined, createMockContext());

      expect(spawnSync).toHaveBeenCalledWith("ast-bro", ["impact", "src/lib.rs"], expect.any(Object));
      const typedResult = result as unknown as { content: Array<{ type: string; text: string }>; isError: boolean };
      expect(typedResult.content[0].text).toContain("impact result");
      expect(typedResult.isError).toBe(false);
    });

    it("records gain stats when analyze_ast_map succeeds", async () => {
      const pi = createMockPi();
      extensionFactory(pi);
      const { spawnSync } = await import("node:child_process");
      const { existsSync, readFileSync } = await import("node:fs");

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue("original file content with many lines\n".repeat(400));
      vi.mocked(spawnSync).mockImplementation((command: string, args: string[]) => {
        if (command === "ast-bro" && args[0] === "--version") {
          return { status: 0, stdout: "1.0", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        if (command === "ast-bro" && args[0] === "map") {
          return { status: 0, stdout: "AST map summary", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
      });

      const mapTool = pi.registeredTools.find((t) => t.name === "analyze_ast_map")!;
      const result = await mapTool.execute(
        "tc",
        { path: "src/lib.rs" },
        new AbortController().signal,
        undefined,
        createMockContext(),
      );

      expect(spawnSync).toHaveBeenCalledWith("ast-bro", ["map", "src/lib.rs"], expect.any(Object));
      expect(readFileSync).toHaveBeenCalledWith("/project/src/lib.rs", "utf-8");
      const typedResult = result as unknown as { content: Array<{ type: string; text: string }>; isError: boolean };
      expect(typedResult.content[0].text).toContain("AST map summary");
      expect(typedResult.isError).toBe(false);
    });
  });
});

// Type assertion helpers satisfied by the test objects above.
