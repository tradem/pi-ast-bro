import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Type, type Static } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SettingsManager } from "./config.js";
import { isAstBroAvailable, isPathSafe } from "./utils.js";

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

function runAstBroGraph(filePath: string): AstBroGraphResult | null {
  if (!isPathSafe(filePath)) return null;

  try {
    const result = spawnSync("ast-bro", ["graph", "--json", "--compact", "--hide-external", filePath], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
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
export function registerAstGraphTool(pi: ExtensionAPI, settings: SettingsManager): void {
  pi.registerTool({
    name: "analyze_ast_graph",
    label: "AST Graph",
    description:
      "Returns a compact file/module dependency graph for architecture, coupling, and relationship questions. Start here before reading individual files.",
    promptGuidelines: [
      "Use this tool first for architecture, module relationship, or coupling questions.",
      "Start with the crate/root path and inspect the returned graph before diving into specific files.",
      "Combine with analyze_ast_map and analyze_ast_context to explore key modules.",
    ],
    parameters: AnalyzeAstGraphSchema,
    async execute(
      _toolCallId: string,
      params: AnalyzeAstGraphParams,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
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

      const result = runAstBroGraph(resolvedPath);
      if (!result) {
        return errorResult("Failed to run ast-bro graph.");
      }

      if (result.status !== 0) {
        return {
          content: [{ type: "text", text: result.stdout || result.stderr }],
          isError: true,
          details: { exitCode: result.status },
        };
      }

      const config = await settings.load(ctx.cwd);
      const formatted = truncateGraph(result.stdout, config.graphMaxEdges);

      return {
        content: [{ type: "text", text: formatted.text }],
        isError: false,
        details: { exitCode: 0 },
      };
    },
  });
}
