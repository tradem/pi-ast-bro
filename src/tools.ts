import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readFileSync, statSync } from "node:fs";
import { formatBytesHuman, type StatsManager } from "./statsManager.js";
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
 *
 * `analyze_ast_impact` is registered separately in {@link registerRefactoringTools}
 * because it augments the CLI output with exact-match source snippets.
 */
export function registerAstTools(pi: ExtensionAPI, stats: StatsManager): void {
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
    promptSnippet: "analyze_ast_search(query, top_k?) — hybrid BM25 + semantic repo search",
    description:
      "Hybrid BM25 + semantic search over the repository based on syntax and text. Returns the most relevant locations for a query or symbol name.",
    promptGuidelines: [
      "Use this tool when the user asks to search, find, or locate code patterns, symbols, or call sites.",
      "Prefer it over bash/rg/grep unless the user explicitly asks for a shell-based search.",
      "If many results are expected, pass a higher top_k (up to 100).",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query or symbol name" }),
      top_k: Type.Optional(
        Type.Number({ description: "Maximum number of results (default 10, max 100)", minimum: 1, maximum: 100 }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { query: string; top_k?: number },
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

      const result = runAstBroSearch(params.query, { topK: params.top_k });
      if (!result) {
        return {
          content: [{ type: "text", text: "Failed to run ast-bro search." }],
          isError: true,
          details: undefined,
        };
      }

      if (result.status === 0 && typeof ctx?.cwd === "string") {
        recordSearchSavings(result.stdout || "", ctx.cwd, stats, ctx);
      }

      return {
        content: [{ type: "text", text: result.stdout || result.stderr }],
        isError: result.status !== 0,
        details: { exitCode: result.status },
      };
    },
  });
}

/**
 * Estimate byte savings from `ast-bro search` by comparing the full size of
 * every referenced file against the emitted result text. The search output
 * already contains small excerpts, so this approximates how much raw source
 * was avoided.
 */
function recordSearchSavings(
  stdout: string,
  cwd: string,
  stats: StatsManager,
  ctx: ExtensionContext,
): void {
  const lines = stdout.split("\n");
  const seenFiles = new Set<string>();
  let originalBytes = 0;

  const headerPattern = /^([A-Za-z]:)?\/?.+?:\d+-\d+\s+\[score/;

  for (const line of lines) {
    const match = line.match(headerPattern);
    if (!match) continue;

    const rawPath = match[0].split(":")[0];
    if (seenFiles.has(rawPath)) continue;

    const resolved = resolveExistingFilePath(cwd, rawPath);
    if (!resolved) continue;

    seenFiles.add(rawPath);
    try {
      originalBytes += statSync(resolved).size;
    } catch {
      // Ignore files we cannot stat.
    }
  }

  const outputBytes = Buffer.byteLength(stdout, "utf-8");
  const savedBytes = Math.max(0, originalBytes - outputBytes);

  if (savedBytes > 0 && seenFiles.size > 0) {
    const representative = Array.from(seenFiles)[0];
    if (representative) {
      stats.addReadSavings(representative, originalBytes, outputBytes);
      ctx.ui.notify(`ast-bro search: saved ~${formatBytesHuman(savedBytes)} of context`, "info");
    }
  }
}
