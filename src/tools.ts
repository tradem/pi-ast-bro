import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isAstBroAvailable, isPathSafe, runAstBro, runAstBroSearch } from "./utils";

/**
 * Register dedicated LLM-facing tools that expose ast-bro structural analysis
 * capabilities beyond the transparent read/write interceptors.
 */
export function registerAstTools(pi: ExtensionAPI): void {
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
        };
      }

      const path = params.path;
      if (!isPathSafe(path)) {
        return {
          content: [{ type: "text", text: "Invalid or unsafe file path." }],
          isError: true,
        };
      }

      const result = runAstBro("impact", path);
      if (!result) {
        return {
          content: [{ type: "text", text: "Failed to run ast-bro impact." }],
          isError: true,
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
    async execute(_toolCallId, params) {
      if (!isAstBroAvailable()) {
        return {
          content: [{ type: "text", text: "ast-bro is not installed or not on PATH." }],
          isError: true,
        };
      }

      const path = params.path;
      if (!isPathSafe(path)) {
        return {
          content: [{ type: "text", text: "Invalid or unsafe file path." }],
          isError: true,
        };
      }

      const result = runAstBro("map", path);
      if (!result) {
        return {
          content: [{ type: "text", text: "Failed to run ast-bro map." }],
          isError: true,
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
        };
      }

      const result = runAstBroSearch(params.query);
      if (!result) {
        return {
          content: [{ type: "text", text: "Failed to run ast-bro search." }],
          isError: true,
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
