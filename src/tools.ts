import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import type { StatsManager } from "./statsManager.js";
import {
  isAstBroAvailable,
  isPathSafe,
  resolveExistingFilePath,
  runAstBro,
  runAstBroSearch,
} from "./utils.js";

/**
 * Register dedicated LLM-facing tools that expose ast-bro structural analysis
 * capabilities beyond the transparent read/write interceptors.
 *
 * `analyze_ast_map` also contributes to persistent gain statistics because it
 * serves the same purpose as an intercepted read: providing token-efficient AST
 * context in place of the full raw source.
 */
export function registerAstTools(pi: ExtensionAPI, stats: StatsManager): void {
  pi.registerTool({
    name: "analyze_ast_impact",
    label: "AST Impact",
    description:
      "Cross-file impact analysis: traces callers, callees, and reverse-deps. Use this before a major refactor to plan changes.",
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file or symbol to analyze" }),
    }),
    async execute(_toolCallId, params) {
      if (!isAstBroAvailable()) {
        return {
          content: [{ type: "text", text: "ast-bro is not installed or not on PATH." }],
          isError: true,
          details: undefined,
        };
      }

      const path = params.path;
      if (!isPathSafe(path)) {
        return {
          content: [{ type: "text", text: "Invalid or unsafe file path." }],
          isError: true,
          details: undefined,
        };
      }

      const result = runAstBro("impact", path);
      if (!result) {
        return {
          content: [{ type: "text", text: "Failed to run ast-bro impact." }],
          isError: true,
          details: undefined,
        };
      }

      return {
        content: [{ type: "text", text: result.stdout || result.stderr }],
        isError: result.status !== 0,
        details: { exitCode: result.status },
      };
    },
  });

  pi.registerTool({
    name: "analyze_ast_map",
    label: "AST Map",
    description: "Extract the hierarchical AST block of a symbol or file.",
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file or symbol to map" }),
    }),
    async execute(
      _toolCallId: string,
      params: { path: string },
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ) {
      if (!isAstBroAvailable()) {
        return {
          content: [{ type: "text", text: "ast-bro is not installed or not on PATH." }],
          isError: true,
          details: undefined,
        };
      }

      const path = params.path;
      if (!isPathSafe(path)) {
        return {
          content: [{ type: "text", text: "Invalid or unsafe file path." }],
          isError: true,
          details: undefined,
        };
      }

      const result = runAstBro("map", path);
      if (!result) {
        return {
          content: [{ type: "text", text: "Failed to run ast-bro map." }],
          isError: true,
          details: undefined,
        };
      }

      // Treat a successful AST map as a token-saving read interception and
      // record it in the persistent stats. We resolve the path against the
      // current working directory so the recorded path matches the project root.
      if (result.status === 0 && typeof ctx?.cwd === "string") {
        const resolved = resolveExistingFilePath(ctx.cwd, path);
        if (resolved) {
          try {
            const original = readFileSync(resolved, "utf-8");
            const output = result.stdout || "";
            stats.addReadSavings(
              resolved,
              Buffer.byteLength(original, "utf-8"),
              Buffer.byteLength(output, "utf-8"),
            );
          } catch {
            // Best-effort telemetry: if the original cannot be measured, still
            // serve the AST output.
          }
        }
      }

      return {
        content: [{ type: "text", text: result.stdout || result.stderr }],
        isError: result.status !== 0,
        details: { exitCode: result.status },
      };
    },
  });

  pi.registerTool({
    name: "analyze_ast_search",
    label: "AST Search",
    description: "Hybrid search over the repository based on syntax and text.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
    }),
    async execute(_toolCallId, params) {
      if (!isAstBroAvailable()) {
        return {
          content: [{ type: "text", text: "ast-bro is not installed or not on PATH." }],
          isError: true,
          details: undefined,
        };
      }

      const result = runAstBroSearch(params.query);
      if (!result) {
        return {
          content: [{ type: "text", text: "Failed to run ast-bro search." }],
          isError: true,
          details: undefined,
        };
      }

      return {
        content: [{ type: "text", text: result.stdout || result.stderr }],
        isError: result.status !== 0,
        details: { exitCode: result.status },
      };
    },
  });
}
