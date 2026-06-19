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
    description:
      "Extract the hierarchical AST block of a symbol or file. Use first for structure questions; pair with analyze_ast_graph for architecture and analyze_ast_search for locating symbols.",
    promptGuidelines: [
      "Use this tool when the user asks for the structure of a file or symbol.",
      "For architecture or module-relationship questions start with analyze_ast_graph, then use analyze_ast_map on key modules, then analyze_ast_search, and only fall back to read for semantics.",
      "For 'how does this symbol work' questions start with analyze_ast_context before reading the full file.",
      "Before reading more than two files for a structural question, stop and prefer analyze_ast_graph, analyze_ast_map, or analyze_ast_search first.",
    ],
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
            // Fall back to not recording stats on read failure.
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
    promptSnippet: "analyze_ast_search(query, top_k?, mode?) — hybrid BM25 + semantic repo search",
    description:
      "Hybrid BM25 + semantic search over the repository based on syntax and text. Returns the most relevant locations for a query or symbol name. Use mode:'summary' to get a grouped map of hits by file and line range instead of raw snippets.",
    promptGuidelines: [
      "Use this tool when the user asks to search, find, or locate code patterns, symbols, or call sites.",
      "Prefer it over bash/rg/grep unless the user explicitly asks for a shell-based search.",
      "If many results are expected, pass a higher top_k (up to 100) or use mode:'summary' for a compact grouped overview.",
      "For architecture questions start with analyze_ast_graph/analyze_ast_map; for symbol usage questions start with analyze_ast_impact; for implementation questions start with find_implementations.",
      "Before reading more than two files for a structural question, stop and prefer analyze_ast_graph, analyze_ast_map, or analyze_ast_search first.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query or symbol name" }),
      top_k: Type.Optional(
        Type.Number({ description: "Maximum number of results (default 10, max 100)", minimum: 1, maximum: 100 }),
      ),
      mode: Type.Optional(
        Type.Union([Type.Literal("snippets"), Type.Literal("summary")], {
          default: "snippets",
          description: "Output mode: raw snippets (default) or a grouped summary by file",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { query: string; top_k?: number; mode?: "snippets" | "summary" },
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

      if (result.status !== 0 || params.mode !== "summary") {
        return {
          content: [{ type: "text", text: result.stdout || result.stderr }],
          isError: result.status !== 0,
          details: { exitCode: result.status },
        };
      }

      const summary = parseSearchSummary(result.stdout || "");
      if (!summary) {
        // Fallback to raw stdout when headers cannot be parsed.
        return {
          content: [{ type: "text", text: result.stdout || result.stderr }],
          isError: false,
          details: { exitCode: result.status },
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        isError: false,
        details: { exitCode: result.status },
      };
    },
  });
}

interface SearchSummary {
  total_hits: number;
  files: Record<string, { hit_count: number; ranges: string[] }>;
}

/**
 * Parse `ast-bro search` header lines of the form `path:start-end [...]` and
 * emit a compact JSON summary grouped by file.
 *
 * Returns `null` when no recognizable headers are found so callers can fall
 * back to the raw output.
 */
export function parseSearchSummary(stdout: string): SearchSummary | null {
  const summary: SearchSummary = { total_hits: 0, files: {} };
  const headerPattern = /^(.+?):(\d+)-(\d+)(?:\s|$)/;

  for (const line of stdout.split("\n")) {
    const match = line.match(headerPattern);
    if (!match) continue;

    const file = match[1];
    const range = `${match[2]}-${match[3]}`;

    if (!summary.files[file]) {
      summary.files[file] = { hit_count: 0, ranges: [] };
    }
    summary.files[file].hit_count += 1;
    summary.files[file].ranges.push(range);
    summary.total_hits += 1;
  }

  if (summary.total_hits === 0) return null;
  return summary;
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
      // Ignore files that disappear between listing and stat.
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
