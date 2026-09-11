import { Type, type Static } from "typebox";
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";
import type { SettingsManager } from "./config.js";
import type { StatsManager } from "./statsManager.js";
import {
  createProgressThrottle,
  extractSurfaceFilePaths,
  extractTraceFilePaths,
  isAstBroAvailable,
  isPathSafe,
  progressPayload,
  recordReferencedFileSavings,
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
export function registerNavigationTools(
  pi: ExtensionAPI,
  settings: SettingsManager,
  stats: StatsManager,
): void {
  pi.registerTool({
    name: "analyze_ast_trace",
    label: "AST Trace",
    promptSnippet: "analyze_ast_trace(from, to, path?) — shortest static call path between two symbols",
    description:
      "Trace the shortest static call path from one symbol to another, with inlined source bodies (budget-trimmed). The one-call answer to 'how does A reach B?' — use it instead of chaining searches and reads across files.",
    promptGuidelines: [
      "Use this when asked how data or control flows from one symbol to another, or to explain an indirect call chain — do not reconstruct the path manually from multiple searches and reads.",
      "Good trigger: you found a call site whose origin is unclear and want the intermediate hops with their code inline.",
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

        if (result.status === 0) {
          try {
            await recordReferencedFileSavings(
              extractTraceFilePaths(result.stdout ?? ""),
              output,
              ctx.cwd,
              stats,
            );
          } catch {
            // savings tracking is best-effort
          }
        }

        return {
          content: [{ type: "text", text: output }],
          isError: result.status !== 0,
          details: { exitCode: result.status },
        };
      } catch (err) {
        throttle.flush();
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(`Internal error: ${message}`);
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
      "Returns the actually-published API surface of a crate or package, resolving re-exports such as `pub use` and `__all__`. Run this before writing code against a library — it shows the true public API, which may differ from the files on disk.",
    promptGuidelines: [
      "Use this before integrating with or extending a library/crate/package: it reveals the real public API instead of you guessing from source files.",
      "Use it to answer 'what does this package export?' in one call instead of reading lib.rs/index.ts/__init__.py.",
      "For a single symbol's details follow up with analyze_ast_context; for module relationships use analyze_ast_graph.",
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

        if (result.status === 0) {
          try {
            await recordReferencedFileSavings(
              extractSurfaceFilePaths(result.stdout ?? ""),
              result.stdout ?? "",
              ctx.cwd,
              stats,
            );
          } catch {
            // savings tracking is best-effort
          }
        }

        return {
          content: [{ type: "text", text: result.stdout || result.stderr }],
          isError: result.status !== 0,
          details: { exitCode: result.status },
        };
      } catch (err) {
        throttle.flush();
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(`Internal error: ${message}`);
      } finally {
        throttle.flush();
      }
    },
  } as ToolDefinition<any, any, any>);
}
