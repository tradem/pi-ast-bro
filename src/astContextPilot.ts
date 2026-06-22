import { Type, type Static } from "typebox";
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { SettingsManager } from "./config.js";
import {
  createProgressThrottle,
  isAstBroAvailable,
  isPathSafe,
  progressPayload,
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
 * Run `ast-bro context --json --compact --budget` with an optional target.
 *
 * The CLI shape is `context [target] path` with flags before positional args.
 */
async function runAstBroContext(
  targetPath: string,
  target: string | undefined,
  budget: number,
  signal?: AbortSignal,
): Promise<AstBroContextResult | null> {
  if (!isPathSafe(targetPath)) return null;
  if (target !== undefined && !isTargetSafe(target)) return null;

  const args = ["context", "--json", "--compact", "--budget", String(budget)];
  if (target) {
    args.push(target, targetPath);
  } else {
    args.push(targetPath);
  }

  try {
    return await runAstBroAsync(args, { signal, timeoutMs: 60_000 });
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
export function registerAstContextTool(pi: ExtensionAPI, settings: SettingsManager): void {
  pi.registerTool({
    name: "analyze_ast_context",
    label: "AST Context",
    description:
      "Token-budgeted focused context for a symbol or file. Preferred first tool for understanding how a specific symbol or file works before falling back to read.",
    promptGuidelines: [
      "Use this tool first when the user asks how a specific symbol, function, or file works.",
      "Pass the root path or file in `path` and the symbol name in `target` when known.",
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
        const result = await runAstBroContext(params.path, params.target, budget, signal);
        throttle.progress(progressPayload("querying", "querying ast-bro context…"));

        if (!result) {
          return errorResult("Failed to run ast-bro context.");
        }

        if (signal?.aborted) {
          return errorResult("ast-bro context aborted.");
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
