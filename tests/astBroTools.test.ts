import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { executeAstBroRefactorTool, FindImplementationsSchema } from "../src/astBroTools.js";

vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

function createMockContext() {
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
  } as unknown as import("@earendil-works/pi-coding-agent").ExtensionContext;
}

function mockAstBroAvailable() {
  vi.mocked(spawnSync).mockImplementation((command: string, args: string[]) => {
    if (command === "ast-bro" && args[0] === "--version") {
      return { status: 0, stdout: "1.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
    }
    if (command === "which" && args[0] === "ast-bro") {
      return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
    }
    return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
  });
}

describe("astBroTools", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("executeAstBroRefactorTool", () => {
    it("injects exact_snippet from a JSON match and reports context savings", async () => {
      mockAstBroAvailable();

      const { spawnSync } = await import("node:child_process");
      const { existsSync, readFileSync, statSync } = await import("node:fs");

      // prettier-ignore
      const fileContent = [
        "pub mod one;",
        "pub mod two;",
        "pub fn target() {}",
        "pub fn four() {}",
        "pub fn five() {}",
      ].join("\n");

      const resolvedPath = "/project/src/lib.rs";
      vi.mocked(existsSync).mockImplementation((p: string) => p === resolvedPath);
      vi.mocked(readFileSync).mockImplementation((p: string) => (p === resolvedPath ? fileContent : ""));
      vi.mocked(statSync).mockImplementation((p: string) =>
        p === resolvedPath ? ({ size: 5_000 } as ReturnType<typeof statSync>) : ({ size: 0 } as ReturnType<typeof statSync>),
      );

      vi.mocked(spawnSync).mockImplementation((command: string, args: string[]) => {
        if (command === "ast-bro" && args[0] === "--version") {
          return { status: 0, stdout: "1.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        if (command === "which" && args[0] === "ast-bro") {
          return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        if (command === "ast-bro" && args[0] === "impact") {
          return {
            status: 0,
            stdout: JSON.stringify([{ file: "src/lib.rs", line: 3, kind: "caller" }]),
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
      });

      const ctx = createMockContext();
      const result = await executeAstBroRefactorTool("impact", "src/lib.rs", ctx);

      expect(result.isError).toBe(false);
      const payload = JSON.parse(result.content[0].text) as {
        results: Array<{ file: string; line: number; exact_snippet: string }>;
      };
      expect(payload.results).toHaveLength(1);
      expect(payload.results[0].exact_snippet).toBe([
        "pub mod one;",
        "pub mod two;",
        "pub fn target() {}",
        "pub fn four() {}",
        "pub fn five() {}",
      ].join("\n"));

      expect(ctx.ui.notify).toHaveBeenCalledWith(
        expect.stringContaining("saved"),
        "info",
      );
    });

    it("truncates to 50 results and includes attention_required", async () => {
      mockAstBroAvailable();

      const { spawnSync } = await import("node:child_process");
      const { existsSync, readFileSync, statSync } = await import("node:fs");

      const resolvedPath = "/project/src/lib.rs";
      vi.mocked(existsSync).mockImplementation((p: string) => p === resolvedPath);
      vi.mocked(readFileSync).mockImplementation((p: string) => (p === resolvedPath ? "line\n".repeat(60) : ""));
      vi.mocked(statSync).mockImplementation((p: string) =>
        p === resolvedPath ? ({ size: 100 } as ReturnType<typeof statSync>) : ({ size: 0 } as ReturnType<typeof statSync>),
      );

      vi.mocked(spawnSync).mockImplementation((command: string, args: string[]) => {
        if (command === "ast-bro" && args[0] === "--version") {
          return { status: 0, stdout: "1.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        if (command === "which" && args[0] === "ast-bro") {
          return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        if (command === "ast-bro" && args[0] === "implements") {
          const items = Array.from({ length: 55 }, (_, i) => ({ file: "src/lib.rs", line: i + 1, kind: "impl" }));
          return { status: 0, stdout: JSON.stringify(items), stderr: "" } as ReturnType<typeof spawnSync>;
        }
        return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
      });

      const ctx = createMockContext();
      const result = await executeAstBroRefactorTool("implements", "MyTrait", ctx);

      expect(result.isError).toBe(false);
      const payload = JSON.parse(result.content[0].text) as {
        results: unknown[];
        attention_required?: string;
      };
      expect(payload.results).toHaveLength(50);
      expect(payload.attention_required).toBe("Truncated. 5 additional elements omitted.");
    });

    it("rejects unsafe target paths", async () => {
      mockAstBroAvailable();

      const ctx = createMockContext();
      const result = await executeAstBroRefactorTool("impact", "src/lib.rs; rm -rf /", ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid or unsafe");
    });

    it("returns an error when ast-bro exits non-zero", async () => {
      const { spawnSync } = await import("node:child_process");
      vi.mocked(spawnSync).mockImplementation((command: string, args: string[]) => {
        if (command === "ast-bro" && args[0] === "--version") {
          return { status: 0, stdout: "1.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        if (command === "which" && args[0] === "ast-bro") {
          return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        if (command === "ast-bro" && args[0] === "impact") {
          return { status: 1, stdout: "", stderr: "parse error" } as ReturnType<typeof spawnSync>;
        }
        return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
      });

      const ctx = createMockContext();
      const result = await executeAstBroRefactorTool("impact", "src/lib.rs", ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("parse error");
    });

    it("falls back to raw stdout when the CLI does not emit JSON", async () => {
      const { spawnSync } = await import("node:child_process");
      vi.mocked(spawnSync).mockImplementation((command: string, args: string[]) => {
        if (command === "ast-bro" && args[0] === "--version") {
          return { status: 0, stdout: "1.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        if (command === "which" && args[0] === "ast-bro") {
          return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        if (command === "ast-bro" && args[0] === "impact") {
          return { status: 0, stdout: "legacy impact result", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
      });

      const ctx = createMockContext();
      const result = await executeAstBroRefactorTool("impact", "src/lib.rs", ctx);

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("legacy impact result");
    });
  });

  describe("FindImplementationsSchema", () => {
    it("requires a path string", () => {
      // Static schema is exercised by the tool registration; this simply
      // ensures the export is wired and valid TypeBox object.
      expect(FindImplementationsSchema.type).toBe("object");
      expect(FindImplementationsSchema.properties.path.type).toBe("string");
    });
  });
});
