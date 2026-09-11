import { resolve } from "node:path";
import { Type, type Static } from "typebox";
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { SettingsManager } from "./config.js";
import type { StatsManager } from "./statsManager.js";
import {
  createProgressThrottle,
  extractGraphFilePaths,
  isAstBroAvailable,
  isPathSafe,
  progressPayload,
  recordReferencedFileSavings,
  runAstBroAsync,
  type ProgressDetails,
} from "./utils.js";

/**
 * TypeBox schema for the AST graph pilot tool.
 *
 * `path` is optional and defaults to the agent's current working directory.
 */
export const AnalyzeAstGraphSchema = Type.Object({
  path: Type.Optional(
    Type.String({ description: "Optional path to scope the graph (defaults to current working directory)" }),
  ),
});

export type AnalyzeAstGraphParams = Static<typeof AnalyzeAstGraphSchema>;

interface AstBroGraphResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface GraphPayload {
  edges?: unknown[];
  truncated?: boolean;
  total_edges?: number;
  [key: string]: unknown;
}

async function runAstBroGraph(filePath: string, signal?: AbortSignal): Promise<AstBroGraphResult | null> {
  if (!isPathSafe(filePath)) return null;

  try {
    return await runAstBroAsync(["graph", "--json", "--compact", "--hide-external", filePath], {
      signal,
      timeoutMs: 60_000,
    });
  } catch {
    return null;
  }
}

/**
 * Truncate the graph to the configured maximum number of edges.
 *
 * If the parsed JSON is an object with an `edges` array, the array is sliced
 * and `truncated`/`total_edges` annotations are added. Other shapes are
 * returned unchanged.
 */
function truncateGraph(stdout: string, maxEdges: number): { text: string; truncated: boolean; totalEdges?: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { text: stdout, truncated: false };
  }

  let container: GraphPayload | undefined;
  if (Array.isArray(parsed)) {
    container = { edges: parsed };
  } else if (parsed && typeof parsed === "object") {
    container = parsed as GraphPayload;
  }

  const edges = Array.isArray(container?.edges) ? container.edges : undefined;
  if (!edges) return { text: stdout, truncated: false };

  if (edges.length <= maxEdges) {
    container!.truncated = false;
    return { text: JSON.stringify(container, null, 2), truncated: false };
  }

  container!.edges = edges.slice(0, maxEdges);
  container!.truncated = true;
  container!.total_edges = edges.length;

  return { text: JSON.stringify(container, null, 2), truncated: true, totalEdges: edges.length };
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
 * Register `analyze_ast_graph`: compact file/module dependency graph for
 * architecture and coupling questions.
 */
export function registerAstGraphTool(
  pi: ExtensionAPI,
  settings: SettingsManager,
  stats: StatsManager,
): void {
  pi.registerTool({
    name: "analyze_ast_graph",
    label: "AST Graph",
    description:
      "Returns a compact file/module dependency graph for architecture, coupling, and relationship questions. THE entry point for unfamiliar codebases: run it once on the repo root before reading any files, then drill down with analyze_ast_map and analyze_ast_context.",
    promptGuidelines: [
      "Use this tool first when starting work in an unfamiliar repo or module, or when asked how modules/crates relate, which files couple to each other, or where a change would ripple.",
      "Do NOT answer architecture or coupling questions by reading many files — the graph answers them in one call.",
      "Start with the crate/root path and inspect the returned graph before diving into specific files; then use analyze_ast_map on interesting modules and analyze_ast_context on key symbols.",
      "Also the right call for reverse-dependency questions: if you need to know which files depend on a specific file, the graph shows it in one call.",
    ],
    parameters: AnalyzeAstGraphSchema,
    async execute(
      _toolCallId: string,
      params: AnalyzeAstGraphParams,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback | undefined,
      ctx: ExtensionContext,
    ) {
      if (!isAstBroAvailable()) {
        return errorResult("ast-bro is not installed or not on PATH.");
      }

      let resolvedPath = typeof ctx.cwd === "string" ? ctx.cwd : "";
      if (params.path) {
        if (!isPathSafe(params.path)) {
          return errorResult("Invalid or unsafe file path.");
        }
        resolvedPath = resolve(resolvedPath, params.path);
      }

      if (!resolvedPath) {
        return errorResult("No valid working directory available to scope the graph.");
      }

      const config = await settings.load(ctx.cwd);
      const throttle = createProgressThrottle(config.progressUpdateThrottleMs, onUpdate);

      try {
        throttle.progress(progressPayload("starting", "starting ast-bro graph…"));
        const result = await runAstBroGraph(resolvedPath, signal);
        throttle.progress(progressPayload("querying", "querying ast-bro graph…"));

        if (!result) {
          return errorResult("Failed to run ast-bro graph.");
        }

        if (signal?.aborted) {
          return errorResult("ast-bro graph aborted.");
        }

        if (result.status !== 0) {
          return {
            content: [{ type: "text", text: result.stdout || result.stderr }],
            isError: true,
            details: { exitCode: result.status },
          };
        }

        const formatted = truncateGraph(result.stdout, config.graphMaxEdges);

        if (result.status === 0) {
          try {
            await recordReferencedFileSavings(
              extractGraphFilePaths(result.stdout ?? ""),
              formatted.text,
              ctx.cwd,
              stats,
            );
          } catch {
            // savings tracking is best-effort
          }
        }

        return {
          content: [{ type: "text", text: formatted.text }],
          isError: false,
          details: { exitCode: 0 },
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
