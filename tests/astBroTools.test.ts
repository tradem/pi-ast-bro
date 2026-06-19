import { beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { executeAstBroRefactorTool, AnalyzeAstImpactSchema, FindImplementationsSchema } from "../src/astBroTools.js";

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

async function mockFileSystem(opts: { path: string; content: string; size: number }) {
  const { existsSync, readFileSync, statSync } = await import("node:fs");
  vi.mocked(existsSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((p: string) => p === opts.path);
  vi.mocked(readFileSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((p: string) => (p === opts.path ? opts.content : ""));
  vi.mocked(statSync as unknown as ReturnType<typeof vi.fn>).mockImplementation((p: string) =>
    p === opts.path ? ({ size: opts.size } as ReturnType<typeof statSync>) : ({ size: 0 } as ReturnType<typeof statSync>),
  );
}

describe("astBroTools", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("executeAstBroRefactorTool", () => {
    it("injects exact_snippet from a JSON match and reports context savings", async () => {
      mockAstBroAvailable();
      await mockFileSystem({
        path: "/project/src/lib.rs",
        content: ["pub mod one;", "pub mod two;", "pub fn target() {}", "pub fn four() {}", "pub fn five() {}"].join("\n"),
        size: 5_000,
      });

      vi.mocked(spawnSync).mockImplementation((command: string, args: string[]) => {
        if (command === "ast-bro" && args[0] === "--version") {
          return { status: 0, stdout: "1.0.0", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        if (command === "which" && args[0] === "ast-bro") {
          return { status: 0, stdout: "/usr/bin/ast-bro", stderr: "" } as ReturnType<typeof spawnSync>;
        }
        if (command === "ast-bro" && args[0] === "impact") {
          expect(args).toEqual(["impact", "--json", "src/lib.rs:target"]);
          return {
            status: 0,
            stdout: JSON.stringify([{ file: "src/lib.rs", line: 3, kind: "caller" }]),
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
      });

      const ctx = createMockContext();
      const result = await executeAstBroRefactorTool("impact", "target", "src/lib.rs", ctx);

      expect(result.isError).toBe(false);
      const payload = JSON.parse(result.content[0].text) as {
        results: Array<{ file: string; line: number; exact_snippet: string }>;
      };
      expect(payload.results).toHaveLength(1);
      expect(payload.results[0].exact_snippet).toBe(
        ["pub mod one;", "pub mod two;", "pub fn target() {}", "pub fn four() {}", "pub fn five() {}"].join("\n"),
      );

      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("saved"), "info");
    });

    it("truncates to 50 results and includes attention_required", async () => {
      mockAstBroAvailable();
      await mockFileSystem({
        path: "/project/src/lib.rs",
        content: "line\n".repeat(60),
        size: 100,
      });

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
      const result = await executeAstBroRefactorTool("implements", "MyTrait", undefined, ctx);

      expect(result.isError).toBe(false);
      const payload = JSON.parse(result.content[0].text) as {
        results: unknown[];
        attention_required?: string;
      };
      expect(payload.results).toHaveLength(50);
      expect(payload.attention_required).toBe("Truncated. 5 additional elements omitted.");
    });

    it("injects snippets into nested impact JSON sections", async () => {
      mockAstBroAvailable();
      await mockFileSystem({
        path: "/project/src/lib.rs",
        content: ["pub struct Player;", "impl Player {", "    pub fn take_damage(&self) {}", "}", "pub fn enemy_attack(p: &Player) { p.take_damage() }"].join("\n"),
        size: 2_000,
      });

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
            stdout: JSON.stringify({
              schema: "ast-bro.impact.v1",
              target: "Player.take_damage",
              impacts: [
                {
                  sections: [
                    {
                      title: "called by (1)",
                      entries: [{ qn: "enemy_attack", file: "src/lib.rs", line: 5, kind: "function" }],
                    },
                  ],
                },
              ],
            }),
            stderr: "",
          } as ReturnType<typeof spawnSync>;
        }
        return { status: null, stdout: "", stderr: "" } as ReturnType<typeof spawnSync>;
      });

      const ctx = createMockContext();
      const result = await executeAstBroRefactorTool("impact", "Player.take_damage", undefined, ctx);

      expect(result.isError).toBe(false);
      const payload = JSON.parse(result.content[0].text) as {
        impacts: Array<{ sections: Array<{ entries: Array<{ exact_snippet: string }> }> }>;
      };
      expect(payload.impacts[0].sections[0].entries[0].exact_snippet).toContain("enemy_attack");
      expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("saved"), "info");
    });

    it("rejects unsafe target paths", async () => {
      mockAstBroAvailable();

      const ctx = createMockContext();
      const result = await executeAstBroRefactorTool("impact", "make_ctx; rm -rf /", undefined, ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid or unsafe");
    });

    it("returns an error when ast-bro exits non-zero", async () => {
      mockAstBroAvailable();

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
      const result = await executeAstBroRefactorTool("impact", "make_ctx", undefined, ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("parse error");
    });

    it("falls back to raw stdout when the CLI does not emit JSON", async () => {
      mockAstBroAvailable();

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
      const result = await executeAstBroRefactorTool("impact", "make_ctx", undefined, ctx);

      expect(result.isError).toBe(false);
      expect(result.content[0].text).toContain("legacy impact result");
    });
  });

  describe("schemas", () => {
    it("AnalyzeAstImpactSchema requires a symbol and optional file", () => {
      expect(AnalyzeAstImpactSchema.type).toBe("object");
      expect(AnalyzeAstImpactSchema.properties.symbol.type).toBe("string");
      expect((AnalyzeAstImpactSchema as { required?: string[] }).required).toContain("symbol");
      expect((AnalyzeAstImpactSchema as { required?: string[] }).required as string[] | undefined).not.toContain("file");
    });

    it("FindImplementationsSchema requires a symbol and optional file", () => {
      expect(FindImplementationsSchema.type).toBe("object");
      expect(FindImplementationsSchema.properties.symbol.type).toBe("string");
    });
  });
});
