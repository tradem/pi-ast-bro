import { Type, type Static } from "typebox";
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { SettingsManager } from "./config.js";
import type { StatsManager } from "./statsManager.js";
import {
  createProgressThrottle,
  extractContextFilePaths,
  extractMapFilePaths,
  isAstBroAvailable,
  isExistingFile,
  isPathSafe,
  normalizeSymbol,
  progressPayload,
  recordReferencedFileSavings,
  resolveExistingFilePath,
  runAstBroAsync,
  type ProgressDetails,
} from "./utils.js";

/**
 * TypeBox schema for the AST context pilot tool.
 *
 * `path` scopes the search (file or directory). `target` optionally focuses
 * on a single symbol. `budget` caps the returned token volume.
 */
export const AnalyzeAstContextSchema = Type.Object({
  path: Type.String({ description: "Path to the file or root directory to inspect" }),
  target: Type.Optional(Type.String({ description: "Optional symbol name to focus the context on" })),
  budget: Type.Optional(
    Type.Number({ description: "Token budget for the returned context", minimum: 500 }),
  ),
});

export type AnalyzeAstContextParams = Static<typeof AnalyzeAstContextSchema>;

interface AstBroContextResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Reject symbol values that contain obvious shell metacharacters or control
 * characters while keeping generics and qualified names intact.
 */
function isTargetSafe(target: string): boolean {
  if (typeof target !== "string" || target.length === 0) return false;
  if (target.includes("\0")) return false;
  const dangerous = new RegExp("[;|&$`" + String.fromCharCode(13, 10) + "]");
  return !dangerous.test(target);
}

/**
 * Run `ast-bro context --json --compact --budget` with a symbol target.
 *
 * The CLI shape is `context [target] path` with flags before positional args.
 * The target is normalized so model-provided decoration (backticks, quotes,
 * keywords) does not leak into the CLI and cause "no symbol matches".
 */
async function runAstBroContext(
  targetPath: string,
  target: string,
  budget: number,
  signal?: AbortSignal,
): Promise<AstBroContextResult | null> {
  if (!isPathSafe(targetPath)) return null;
  const cleanTarget = normalizeSymbol(target);
  if (!isTargetSafe(cleanTarget)) return null;

  const args = ["context", "--json", "--compact", "--budget", String(budget)];
  if (cleanTarget) {
    args.push(cleanTarget, targetPath);
  } else {
    args.push(targetPath);
  }

  try {
    return await runAstBroAsync(args, { signal, timeoutMs: 60_000 });
  } catch {
    return null;
  }
}

/**
 * Run `ast-bro map --json --compact` on a single file.
 *
 * Used as the fallback for `analyze_ast_context` when no symbol `target` is
 * given: the CLI's `context` command has no file-only mode, so a structural
 * map of the file is the closest "context for a file" answer.
 */
async function runAstBroMapFallback(
  filePath: string,
  signal?: AbortSignal,
): Promise<AstBroContextResult | null> {
  if (!isPathSafe(filePath)) return null;

  try {
    return await runAstBroAsync(["map", "--json", "--compact", filePath], { signal, timeoutMs: 60_000 });
  } catch {
    return null;
  }
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

/**
 * Register `analyze_ast_context`: token-budgeted focused context for a symbol
 * or file. Used before falling back to whole-file `read` calls.
 */
export function registerAstContextTool(
  pi: ExtensionAPI,
  settings: SettingsManager,
  stats: StatsManager,
): void {
  pi.registerTool({
    name: "analyze_ast_context",
    label: "AST Context",
    description:
      "Token-budgeted focused context for a symbol or file. Preferred first tool for understanding how a specific symbol or file works before falling back to read. With a `target` symbol it returns the symbol's body plus relevant deps/callers; without a `target` (single file `path`) it returns a structural map of the file.",
    promptGuidelines: [
      "Use this tool first when the user asks how a specific symbol, function, or file works.",
      "Pass the root path or file in `path` and the symbol name in `target` when known.",
      "When no `target` is given, `path` must be a single existing file; the tool then returns a structural map of that file. For whole directories use analyze_ast_map instead.",
      "Fall back to read only when you need exact whitespace or a specific line range after the AST context.",
    ],
    parameters: AnalyzeAstContextSchema,
    async execute(
      _toolCallId: string,
      params: AnalyzeAstContextParams,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback | undefined,
      ctx: ExtensionContext,
    ) {
      if (!isAstBroAvailable()) {
        return errorResult("ast-bro is not installed or not on PATH.");
      }

      if (!isPathSafe(params.path)) {
        return errorResult("Invalid or unsafe file path.");
      }

      if (params.target !== undefined && !isTargetSafe(params.target)) {
        return errorResult("Invalid or unsafe target symbol.");
      }

      if (params.budget !== undefined && (typeof params.budget !== "number" || params.budget < 500)) {
        return errorResult("Budget must be a number >= 500.");
      }

      const config = await settings.load(ctx.cwd);
      const budget = params.budget ?? config.contextDefaultBudget;
      const throttle = createProgressThrottle(config.progressUpdateThrottleMs, onUpdate);

      try {
        throttle.progress(progressPayload("starting", "starting ast-bro context…"));

        // Without a symbol target the CLI's `context` command cannot resolve a
        // bare file path (it would treat it as a symbol and fail with
        // "no symbol matches"). Fall back to a structural `map` for single
        // files, and fail with a clear, actionable error otherwise.
        const cleanTarget = params.target === undefined ? undefined : normalizeSymbol(params.target);
        const hasTarget = cleanTarget !== undefined && cleanTarget.length > 0;
        const resolvedFile = hasTarget ? null : await isExistingFile(ctx.cwd, params.path);

        let result: AstBroContextResult | null;
        let referencedPaths: string[];
        if (hasTarget) {
          result = await runAstBroContext(params.path, cleanTarget, budget, signal);
          referencedPaths = [];
        } else if (resolvedFile) {
          const filePath = resolveExistingFilePath(ctx.cwd, params.path);
          result = filePath ? await runAstBroMapFallback(filePath, signal) : null;
          referencedPaths = extractMapFilePaths(result?.stdout ?? "");
        } else {
          return errorResult(
            "ast-bro context needs a symbol `target` when `path` is not a single existing file. Pass e.g. `target: \"make_ctx\"`, or use `analyze_ast_map` to inspect a whole directory.",
          );
        }
        throttle.progress(progressPayload("querying", "querying ast-bro context…"));

        if (!result) {
          return errorResult("Failed to run ast-bro context.");
        }

        if (signal?.aborted) {
          return errorResult("ast-bro context aborted.");
        }

        if (result.status === 0) {
          try {
            const stdout = result.stdout ?? "";
            const referenced = referencedPaths.length > 0
              ? referencedPaths
              : extractContextFilePaths(stdout);
            await recordReferencedFileSavings(referenced, stdout, ctx.cwd, stats);
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
