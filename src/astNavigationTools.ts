import { Type, type Static } from "typebox";
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import type { SettingsManager } from "./config.js";
import {
  createProgressThrottle,
  isAstBroAvailable,
  isPathSafe,
  progressPayload,
  runAstBroSurface,
  runAstBroTrace,
  type ProgressDetails,
} from "./utils.js";

/**
 * TypeBox schemas for the optional filtered navigation tools.
 */
export const AnalyzeAstTraceSchema = Type.Object({
  from: Type.String({ description: "Source symbol where the call path starts" }),
  to: Type.String({ description: "Destination symbol the path should reach" }),
  path: Type.Optional(
    Type.String({ description: "Optional repository root path (defaults to current working directory)" }),
  ),
});

export const AnalyzeAstSurfaceSchema = Type.Object({
  path: Type.String({ description: "Crate root file, package init, or directory to inspect" }),
});

export type AnalyzeAstTraceParams = Static<typeof AnalyzeAstTraceSchema>;
export type AnalyzeAstSurfaceParams = Static<typeof AnalyzeAstSurfaceSchema>;

function isSymbolSafe(symbol: string): boolean {
  if (typeof symbol !== "string" || symbol.length === 0) return false;
  if (symbol.includes("\0")) return false;
  const dangerous = /[;|&$`\r\n]/;
  return !dangerous.test(symbol);
}

function errorResult(text: string): {
  content: Array<{ type: "text"; text: string }>;
  isError: true;
  details: { exitCode: null };
} {
  return {
    content: [{ type: "text", text }],
    isError: true,
    details: { exitCode: null },
  };
}

function trimToBudget(stdout: string, budgetTokens: number): string {
  const budgetBytes = budgetTokens * 4;
  if (Buffer.byteLength(stdout, "utf-8") <= budgetBytes) return stdout;

  // Trim on a line boundary to keep output readable.
  let trimmed = stdout;
  while (Buffer.byteLength(trimmed, "utf-8") > budgetBytes && trimmed.includes("\n")) {
    trimmed = trimmed.slice(0, trimmed.lastIndexOf("\n"));
  }
  if (Buffer.byteLength(trimmed, "utf-8") > budgetBytes) {
    trimmed = trimmed.slice(0, budgetBytes);
  }

  return `${trimmed}\n\n[pi-ast-bro: output trimmed to ~${budgetTokens} token budget]`;
}

/**
 * Register `analyze_ast_trace` and `analyze_ast_surface`.
 *
 * These are deliberately filtered wrappers around `ast-bro trace` and
 * `ast-bro surface`. Redundant or unsafe commands (`callers`, `callees`,
 * `show`, `deps`, `reverse-deps`, `run`) are intentionally not registered;
 * their rationale is documented in `README.md` and `docs/architecture.md`.
 */
export function registerNavigationTools(pi: ExtensionAPI, settings: SettingsManager): void {
  pi.registerTool({
    name: "analyze_ast_trace",
    label: "AST Trace",
    promptSnippet: "analyze_ast_trace(from, to, path?) — shortest static call path between two symbols",
    description:
      "Trace the shortest static call path from one symbol to another. Returns the BFS path with inlined source bodies, budget-trimmed when oversized.",
    promptGuidelines: [
      "Use this tool when the user asks how a symbol reaches another symbol.",
      "For ambiguous symbols, scope with the optional path parameter.",
    ],
    parameters: AnalyzeAstTraceSchema,
    async execute(
      _toolCallId: string,
      params: AnalyzeAstTraceParams,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback | undefined,
      ctx: ExtensionContext,
    ) {
      if (!isAstBroAvailable()) {
        return errorResult("ast-bro is not installed or not on PATH.");
      }

      if (!isSymbolSafe(params.from)) {
        return errorResult("Invalid or unsafe source symbol.");
      }
      if (!isSymbolSafe(params.to)) {
        return errorResult("Invalid or unsafe destination symbol.");
      }

      let resolvedPath = ctx.cwd;
      if (params.path) {
        if (!isPathSafe(params.path)) {
          return errorResult("Invalid or unsafe repository path.");
        }
        resolvedPath = resolve(ctx.cwd, params.path);
      }

      const config = await settings.load(ctx.cwd);
      const throttle = createProgressThrottle(config.progressUpdateThrottleMs, onUpdate);

      try {
        throttle.progress(progressPayload("starting", "starting ast-bro trace…"));
        const result = await runAstBroTrace(params.from, params.to, resolvedPath, { signal });
        throttle.progress(progressPayload("querying", "querying ast-bro trace…"));

        if (!result) {
          return errorResult("Failed to run ast-bro trace.");
        }

        if (signal?.aborted) {
          return errorResult("ast-bro trace aborted.");
        }

        const output = trimToBudget(result.stdout || result.stderr, config.contextDefaultBudget);

        return {
          content: [{ type: "text", text: output }],
          isError: result.status !== 0,
          details: { exitCode: result.status },
        };
      } finally {
        throttle.flush();
      }
    },
  } as ToolDefinition<any, any, any>);

  pi.registerTool({
    name: "analyze_ast_surface",
    label: "AST Surface",
    promptSnippet: "analyze_ast_surface(path) — true public API surface of a directory or crate",
    description:
      "Returns the actually-published API surface of a crate or package, resolving re-exports such as `pub use` and `__all__`.",
    promptGuidelines: [
      "Use this tool when the user asks for the public API of a module, crate, or package.",
    ],
    parameters: AnalyzeAstSurfaceSchema,
    async execute(
      _toolCallId: string,
      params: AnalyzeAstSurfaceParams,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback | undefined,
      ctx: ExtensionContext,
    ) {
      if (!isAstBroAvailable()) {
        return errorResult("ast-bro is not installed or not on PATH.");
      }

      if (!isPathSafe(params.path)) {
        return errorResult("Invalid or unsafe directory path.");
      }

      const resolvedPath = resolve(ctx.cwd, params.path);
      const config = await settings.load(ctx.cwd);
      const throttle = createProgressThrottle(config.progressUpdateThrottleMs, onUpdate);

      try {
        throttle.progress(progressPayload("starting", "starting ast-bro surface…"));
        const result = await runAstBroSurface(resolvedPath, { signal });
        throttle.progress(progressPayload("querying", "querying ast-bro surface…"));

        if (!result) {
          return errorResult("Failed to run ast-bro surface.");
        }

        if (signal?.aborted) {
          return errorResult("ast-bro surface aborted.");
        }

        return {
          content: [{ type: "text", text: result.stdout || result.stderr }],
          isError: result.status !== 0,
          details: { exitCode: result.status },
        };
      } finally {
        throttle.flush();
      }
    },
  } as ToolDefinition<any, any, any>);
}
