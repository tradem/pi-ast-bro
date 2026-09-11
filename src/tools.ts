import { Type } from "typebox";
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { readFile, stat } from "node:fs/promises";
import { formatBytesHuman, type StatsManager } from "./statsManager.js";
import type { SettingsManager } from "./config.js";
import {
  createProgressThrottle,
  isAstBroAvailable,
  isPathSafe,
  progressPayload,
  resolveExistingFilePath,
  runAstBroAsync,
  runAstBroSearch,
  type ProgressDetails,
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
export function registerAstTools(pi: ExtensionAPI, stats: StatsManager, settings: SettingsManager): void {
  pi.registerTool({
    name: "analyze_ast_map",
    label: "AST Map",
    description:
      "Extract the hierarchical AST block of a file or symbol: declarations, signatures, and line ranges — at a fraction of the tokens a full `read` would cost. Default to this INSTEAD of `read` whenever you need to see what a file contains, find where something is defined, or decide which parts of a file are worth reading in full.",
    promptGuidelines: [
      "Prefer this over `read` for a first look at any file: it returns the skeleton (declarations + line numbers) without the bodies, so you can target a precise `read` offset afterwards instead of scanning the whole file.",
      "Use it to locate definitions and understand file layout before editing, before running analyze_ast_context on a symbol, or before answering 'what does this file/module contain?'.",
      "For architecture or module-relationship questions start with analyze_ast_graph, then drill into key modules here.",
      "When you need exact whitespace or bodies for an edit, follow up with a targeted `read` of the mapped line range — never edit from the map alone.",
      "Before reading more than two files for a structural question, stop and map them here first.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Path to the file or symbol to map" }),
    }),
    async execute(
      _toolCallId: string,
      params: { path: string },
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback | undefined,
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

      const config = await settings.load(ctx.cwd);
      const throttle = createProgressThrottle(config.progressUpdateThrottleMs, onUpdate);

      try {
        throttle.progress(progressPayload("starting", "starting ast-bro map…"));
        const result = await runAstBroAsync(["map", path], { signal, timeoutMs: 30_000 });
        throttle.progress(progressPayload("querying", "querying ast-bro map…"));

        if (!result) {
          return {
            content: [{ type: "text", text: "Failed to run ast-bro map." }],
            isError: true,
            details: undefined,
          };
        }

        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "ast-bro map aborted." }],
            isError: true,
            details: undefined,
          };
        }

        if (result.status === 0 && typeof ctx?.cwd === "string") {
          const resolved = resolveExistingFilePath(ctx.cwd, path);
          if (resolved) {
            try {
              const original = await readFile(resolved, "utf-8");
              const output = result.stdout || "";
              throttle.progress(
                progressPayload(
                  "augmenting",
                  "augmenting ast-bro map…",
                  1,
                  1,
                ),
              );
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
      } catch (err) {
        throttle.flush();
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Internal error: ${message}` }],
          isError: true,
          details: { exitCode: null },
        };
      } finally {
        throttle.flush();
      }
    },
  } as ToolDefinition<any, any, any>);

  pi.registerTool({
    name: "analyze_ast_search",
    label: "AST Search",
    promptSnippet: "analyze_ast_search(query, top_k?, mode?) — hybrid BM25 + semantic repo search",
    description:
      "Hybrid BM25 + semantic search over the repository based on syntax and text. Finds WHERE things are — it does not explain how code works. Use mode:'summary' to get a grouped map of hits by file and line range instead of raw snippets.",
    promptGuidelines: [
      "IMPORTANT — hand off instead of searching when the question is one of these: 'how does X work?' → analyze_ast_context; 'who calls X / what does X affect?' → analyze_ast_impact; 'what implements interface X?' → find_implementations; 'how does X reach Y?' → analyze_ast_trace; 'how do modules relate?' → analyze_ast_graph. Search only finds locations, not explanations.",
      "Use this tool to LOCATE code: find symbols by name or concept, find patterns, find where a keyword appears — especially when you do not know the exact file or symbol name yet.",
      "Prefer it over bash/rg/grep unless the user explicitly asks for a shell-based search.",
      "If many results are expected, pass a higher top_k (up to 100) or use mode:'summary' for a compact grouped overview.",
      "Before reading more than two files for a structural question, stop and prefer analyze_ast_graph, analyze_ast_map, or this tool first.",
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
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback | undefined,
      ctx: ExtensionContext,
    ) {
      if (!isAstBroAvailable()) {
        return {
          content: [{ type: "text", text: "ast-bro is not installed or not on PATH." }],
          isError: true,
          details: undefined,
        };
      }

      const config = await settings.load(ctx.cwd);
      const throttle = createProgressThrottle(config.progressUpdateThrottleMs, onUpdate);

      try {
        throttle.progress(progressPayload("starting", "starting ast-bro search…"));
        const result = await runAstBroSearch(params.query, { topK: params.top_k, signal });
        throttle.progress(progressPayload("querying", "querying ast-bro search…"));

        if (!result) {
          return {
            content: [{ type: "text", text: "Failed to run ast-bro search." }],
            isError: true,
            details: undefined,
          };
        }

        if (signal?.aborted) {
          return {
            content: [{ type: "text", text: "ast-bro search aborted." }],
            isError: true,
            details: undefined,
          };
        }

        const mode = params.mode ?? "snippets";
        let output = result.stdout || "";

        if (result.status === 0 && typeof ctx?.cwd === "string") {
          if (mode === "snippets") {
            try {
              const trimmed = trimSearchSnippets(output, config.searchSnippetBudget);
              output = trimmed.output;
            } catch {
              // Keep raw output if settings could not be loaded.
            }
          }
          await recordSearchSavings(output, ctx.cwd, stats, ctx, (current, total) => {
            throttle.progress(
              progressPayload("augmenting", `augmenting ${current}/${total}…`, current, total),
            );
          });
        }

        if (result.status !== 0 || mode !== "summary") {
          return {
            content: [{ type: "text", text: output || result.stderr }],
            isError: result.status !== 0,
            details: { exitCode: result.status },
          };
        }

        const summary = parseSearchSummary(output);
        if (!summary) {
          // Fallback to raw stdout when headers cannot be parsed.
          return {
            content: [{ type: "text", text: output || result.stderr }],
            isError: false,
            details: { exitCode: result.status },
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
          isError: false,
          details: { exitCode: result.status },
        };
      } catch (err) {
        throttle.flush();
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Internal error: ${message}` }],
          isError: true,
          details: { exitCode: null },
        };
      } finally {
        throttle.flush();
      }
    },
  } as ToolDefinition<any, any, any>);
}

export interface TrimmedSearchResult {
  output: string;
  truncated: boolean;
  omittedHits: number;
}

const SEARCH_HIT_HEADER = /^(.+?):(\d+)-(\d+)(?:\s|$)/;

/**
 * Split `ast-bro search` stdout into individual hits.
 *
 * Each hit starts with a header line of the form `path:start-end [...]`
 * and continues until the next header line.
 */
function splitSearchHits(stdout: string): string[] {
  const hits: string[] = [];
  const lines = stdout.split("\n");
  let current: string[] = [];

  for (const line of lines) {
    if (SEARCH_HIT_HEADER.test(line)) {
      if (current.length > 0) {
        hits.push(current.join("\n"));
        current = [];
      }
    }
    current.push(line);
  }

  if (current.length > 0) {
    hits.push(current.join("\n"));
  }

  return hits;
}

/**
 * Trim `ast-bro search` snippet output to a byte budget derived from
 * approximate tokens, dropping lowest-ranked hits first.
 *
 * Returns the (possibly unchanged) output, a truncation flag, and the
 * count of omitted hits.
 */
export function trimSearchSnippets(stdout: string, budgetTokens: number): TrimmedSearchResult {
  const budgetBytes = budgetTokens * 4;
  if (Buffer.byteLength(stdout, "utf-8") <= budgetBytes) {
    return { output: stdout, truncated: false, omittedHits: 0 };
  }

  const hits = splitSearchHits(stdout);
  if (hits.length === 0) {
    return { output: stdout, truncated: false, omittedHits: 0 };
  }

  let kept = hits;
  while (
    kept.length > 1 &&
    Buffer.byteLength(kept.join("\n"), "utf-8") > budgetBytes
  ) {
    kept = kept.slice(0, -1);
  }

  const keptOutput = kept.join("\n");
  const omitted = hits.length - kept.length;
  if (omitted === 0) {
    return { output: keptOutput, truncated: false, omittedHits: 0 };
  }

  const annotation =
    `\n\n[pi-ast-bro: search results trimmed to fit ${budgetTokens} token budget; ${omitted} additional hit${omitted === 1 ? "" : "s"} omitted]`;
  return { output: keptOutput + annotation, truncated: true, omittedHits: omitted };
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
async function recordSearchSavings(
  stdout: string,
  cwd: string,
  stats: StatsManager,
  ctx: ExtensionContext,
  onProgress?: (current: number, total: number) => void,
): Promise<void> {
  const headerPattern = /^([A-Za-z]:)?\/?.+?:\d+-\d+\s+\[score/;
  const seenFiles = new Set<string>();
  const rawPaths: string[] = [];

  for (const line of stdout.split("\n")) {
    const match = line.match(headerPattern);
    if (!match) continue;

    const rawPath = match[0].split(":")[0];
    if (seenFiles.has(rawPath)) continue;

    seenFiles.add(rawPath);
    rawPaths.push(rawPath);
  }

  let originalBytes = 0;
  const total = rawPaths.length;

  for (let i = 0; i < total; i++) {
    const rawPath = rawPaths[i];
    const resolved = resolveExistingFilePath(cwd, rawPath);
    if (!resolved) continue;

    try {
      const fileStat = await stat(resolved);
      originalBytes += fileStat.size;
    } catch {
      // Ignore files that disappear between listing and stat.
    }
    onProgress?.(i + 1, total);
  }

  const outputBytes = Buffer.byteLength(stdout, "utf-8");
  const savedBytes = Math.max(0, originalBytes - outputBytes);

  if (savedBytes > 0 && rawPaths.length > 0) {
    const representative = rawPaths[0];
    if (representative) {
      stats.addReadSavings(representative, originalBytes, outputBytes);
      ctx.ui.notify(`ast-bro search: saved ~${formatBytesHuman(savedBytes)} of context`, "info");
    }
  }
}
