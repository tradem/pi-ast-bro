import { Type, type Static } from "typebox";
import { readFileSync, statSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { formatBytesHuman, type StatsManager } from "./statsManager.js";
import { isAstBroAvailable, isPathSafe, resolveExistingFilePath } from "./utils.js";

/**
 * TypeBox schemas for the two AST refactoring tools.
 *
 * `ast-bro impact` / `ast-bro implements` operate on a *symbol*. The optional
 * `file` path scopes ambiguous symbols, e.g. `src/lib.rs:make_ctx`.
 */
export const AnalyzeAstImpactSchema = Type.Object({
  symbol: Type.String({ description: "Symbol to analyze, e.g. make_ctx or Player.take_damage" }),
  file: Type.Optional(Type.String({ description: "Optional file path to scope the symbol" })),
});

export const FindImplementationsSchema = Type.Object({
  symbol: Type.String({ description: "Symbol of the interface, trait, or base class, e.g. Command" }),
  file: Type.Optional(Type.String({ description: "Optional file path to scope the symbol" })),
});

export type AnalyzeAstImpactParams = Static<typeof AnalyzeAstImpactSchema>;
export type FindImplementationsParams = Static<typeof FindImplementationsSchema>;

type AstRefactorCommand = "impact" | "implements";

const MAX_RESULTS = 50;
const SNIPPET_CONTEXT_LINES = 2;

interface AstMatch extends Record<string, unknown> {
  file?: string;
  path?: string;
  line: number;
  exact_snippet?: string;
}

function getMatchFile(match: AstMatch): string | null {
  return match.file || match.path || null;
}

function isValidMatch(value: unknown): value is AstMatch {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as AstMatch;
  if (typeof candidate.line !== "number" || Number.isNaN(candidate.line) || candidate.line < 1) {
    return false;
  }
  const file = getMatchFile(candidate);
  return typeof file === "string" && file.length > 0;
}

/**
 * Extract 1-based line plus surrounding context from a resolved file.
 */
function extractSnippet(filePath: string, line: number): string | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const index = line - 1;
    if (index < 0 || index >= lines.length) return null;

    const start = Math.max(0, index - SNIPPET_CONTEXT_LINES);
    const end = Math.min(lines.length, index + SNIPPET_CONTEXT_LINES + 1);
    return lines.slice(start, end).join("\n");
  } catch {
    return null;
  }
}

function getFileSizeBytes(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function parseJsonOutput(stdout: string): unknown | null {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return null;
  }
}

interface SnippetMetrics {
  originalBytes: number;
  filesRead: number;
}

function injectSnippet(match: AstMatch, cwd: string, seenFiles: Set<string>): SnippetMetrics {
  const rawPath = getMatchFile(match)!;
  const resolved = resolveExistingFilePath(cwd, rawPath);

  if (!resolved) return { originalBytes: 0, filesRead: 0 };

  const snippet = extractSnippet(resolved, match.line);
  if (!snippet) return { originalBytes: 0, filesRead: 0 };

  match.exact_snippet = snippet;

  if (seenFiles.has(resolved)) return { originalBytes: 0, filesRead: 0 };
  seenFiles.add(resolved);
  return { originalBytes: getFileSizeBytes(resolved), filesRead: 1 };
}

interface AugmentArrayResult {
  results: unknown[];
  attention_required?: string;
  originalBytes: number;
  filesRead: number;
  hadTruncation: boolean;
}

interface AugmentResult {
  payload: unknown;
  originalBytes: number;
  filesRead: number;
  hadTruncation: boolean;
}

function augmentArray(items: unknown[], cwd: string): AugmentArrayResult {
  const seenFiles = new Set<string>();
  let originalBytes = 0;
  let filesRead = 0;
  let hadTruncation = false;
  const augmented: unknown[] = [];

  for (let i = 0; i < Math.min(items.length, MAX_RESULTS); i++) {
    const item = items[i];

    if (isValidMatch(item)) {
      const metrics = injectSnippet(item, cwd, seenFiles);
      originalBytes += metrics.originalBytes;
      filesRead += metrics.filesRead;
      augmented.push(item as Record<string, unknown>);
      continue;
    }

    if (Array.isArray(item)) {
      const nested = augmentArray(item, cwd);
      augmented.push(nested.results);
      originalBytes += nested.originalBytes;
      filesRead += nested.filesRead;
      if (nested.hadTruncation) hadTruncation = true;
      continue;
    }

    if (typeof item === "object" && item !== null) {
      const nested = augmentResult(item, cwd);
      augmented.push(nested.payload);
      originalBytes += nested.originalBytes;
      filesRead += nested.filesRead;
      if (nested.hadTruncation) hadTruncation = true;
      continue;
    }

    augmented.push(item);
  }

  const result: AugmentArrayResult = {
    results: augmented,
    originalBytes,
    filesRead,
    hadTruncation,
  };

  if (items.length > MAX_RESULTS) {
    result.attention_required = `Truncated. ${items.length - MAX_RESULTS} additional elements omitted.`;
    result.hadTruncation = true;
  }

  return result;
}

/**
 * Recursively walk the CLI JSON output. For every array of objects that
 * contains `file`+`line` pairs, resolve the source file and attach an
 * `exact_snippet`.
 *
 * Arrays are hard-limited to {@link MAX_RESULTS} entries. When an array is
 * truncated a sibling `*_attention_required` key is added.
 */
function augmentResult(parsed: unknown, cwd: string): AugmentResult {
  if (Array.isArray(parsed)) {
    const aug = augmentArray(parsed, cwd);
    const payload: Record<string, unknown> = { results: aug.results };
    if (aug.attention_required) payload.attention_required = aug.attention_required;
    return {
      payload,
      originalBytes: aug.originalBytes,
      filesRead: aug.filesRead,
      hadTruncation: aug.hadTruncation,
    };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { payload: parsed, originalBytes: 0, filesRead: 0, hadTruncation: false };
  }

  const result: Record<string, unknown> = {};
  let originalBytes = 0;
  let filesRead = 0;
  let hadTruncation = false;

  for (const [key, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) {
      const aug = augmentArray(value, cwd);
      result[key] = aug.results;
      originalBytes += aug.originalBytes;
      filesRead += aug.filesRead;
      if (aug.attention_required) {
        result[`${key}_attention_required`] = aug.attention_required;
        hadTruncation = true;
      }
    } else if (typeof value === "object" && value !== null) {
      const nested = augmentResult(value, cwd);
      result[key] = nested.payload;
      originalBytes += nested.originalBytes;
      filesRead += nested.filesRead;
      if (nested.hadTruncation) hadTruncation = true;
    } else {
      result[key] = value;
    }
  }

  return { payload: result, originalBytes, filesRead, hadTruncation };
}

/**
 * Symbols are passed as a single spawn argument, so shell metacharacters are
 * already harmless. We still reject obvious injection patterns and control
 * characters, but keep type parameters like `Command<T>` intact.
 */
function isSymbolSafe(symbol: string): boolean {
  if (typeof symbol !== "string" || symbol.length === 0) return false;
  if (symbol.includes("\0")) return false;
  const dangerous = /[;|&$`\r\n]/;
  return !dangerous.test(symbol);
}

/**
 * `impact` accepts `file:symbol` as a single positional target.
 * `implements` accepts `symbol` plus optional search paths as extra args.
 */
function buildImpactTarget(symbol: string, file?: string): string {
  if (!isSymbolSafe(symbol)) return "";
  if (file && !isPathSafe(file)) return "";
  return file ? `${file}:${symbol}` : symbol;
}

/**
 * Run an `ast-bro` refactoring subcommand with JSON output enabled.
 */
function runAstBroRefactor(
  subcommand: AstRefactorCommand,
  target: string,
  searchPath?: string,
): { status: number | null; stdout: string; stderr: string } | null {
  const args = [subcommand, "--json", target];
  if (searchPath) args.push(searchPath);

  try {
    const result = spawnSync("ast-bro", args, {
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

export async function executeAstBroRefactorTool(
  subcommand: AstRefactorCommand,
  symbol: string,
  file: string | undefined,
  ctx: ExtensionContext,
  stats?: StatsManager,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError: boolean; details: { exitCode: number | null } }> {
  if (!isAstBroAvailable()) {
    return {
      content: [{ type: "text", text: "ast-bro is not installed or not on PATH." }],
      isError: true,
      details: { exitCode: null },
    };
  }

  if (!isSymbolSafe(symbol)) {
    return {
      content: [{ type: "text", text: "Invalid or empty symbol." }],
      isError: true,
      details: { exitCode: null },
    };
  }

  if (file && !isPathSafe(file)) {
    return {
      content: [{ type: "text", text: "Invalid or unsafe file path." }],
      isError: true,
      details: { exitCode: null },
    };
  }

  const target = subcommand === "impact" ? buildImpactTarget(symbol, file) : symbol;
  if (!target) {
    return {
      content: [{ type: "text", text: "Invalid or unsafe symbol/file path." }],
      isError: true,
      details: { exitCode: null },
    };
  }

  const result = runAstBroRefactor(subcommand, target, subcommand === "implements" ? file : undefined);
  if (!result) {
    return {
      content: [{ type: "text", text: `Failed to run ast-bro ${subcommand}.` }],
      isError: true,
      details: { exitCode: null },
    };
  }

  if (result.status !== 0) {
    return {
      content: [{ type: "text", text: result.stdout || result.stderr || `ast-bro ${subcommand} failed.` }],
      isError: true,
      details: { exitCode: result.status },
    };
  }

  const stdout = result.stdout ?? "";
  const parsed = parseJsonOutput(stdout);

  // If the CLI did not emit JSON, fall back to the raw text output so existing
  // behaviour and non-JSON CLI versions keep working.
  if (parsed === null) {
    return {
      content: [{ type: "text", text: stdout || result.stderr }],
      isError: false,
      details: { exitCode: result.status },
    };
  }

  const augmented = augmentResult(parsed, ctx.cwd);
  const outputText = JSON.stringify(augmented.payload, null, 2);
  const outputBytes = Buffer.byteLength(outputText, "utf-8");
  const savedBytes = Math.max(0, augmented.originalBytes - outputBytes);

  if (savedBytes > 0 && augmented.filesRead > 0) {
    stats?.addReadSavings(target, augmented.originalBytes, outputBytes);
    ctx.ui.notify(
      `ast-bro ${subcommand}: saved ~${formatBytesHuman(savedBytes)} of context using exact snippets`,
      "info",
    );
  }

  return {
    content: [{ type: "text", text: outputText }],
    isError: false,
    details: { exitCode: result.status },
  };
}

/**
 * Register the AST refactoring tools used for safe, snippet-backed edits.
 */
export function registerRefactoringTools(pi: ExtensionAPI, stats: StatsManager): void {
  pi.registerTool({
    name: "analyze_ast_impact",
    label: "AST Impact",
    promptSnippet: "analyze_ast_impact(symbol, file?) — AST-accurate caller/callee/impact analysis with exact snippets",
    description:
      "Cross-file impact analysis: traces callers, callees, and reverse-deps for a symbol. Returns JSON with exact source snippets for safe edits. Pass the symbol name and optionally a file path to disambiguate. For trait methods like to_string use a type-qualified symbol (e.g. ProjectId.to_string) or fall back to analyze_ast_search.",
    promptGuidelines: [
      "Use this tool when the user asks for callers, callees, or impact of a symbol.",
      "Prefer it over bash/rg/grep for AST-accurate caller analysis.",
      "Pass the bare symbol name and, if ambiguous, the file path that defines it.",
      "If the symbol is a trait method and ambiguous, use analyze_ast_search or qualify it with a concrete type.",
    ],
    parameters: AnalyzeAstImpactSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeAstBroRefactorTool("impact", params.symbol, params.file, ctx, stats);
    },
  });

  pi.registerTool({
    name: "find_implementations",
    label: "Find Implementations",
    promptSnippet: "find_implementations(symbol, file?) — find trait/interface/base-class implementations with exact snippets",
    description:
      "Find interface implementations, trait implementations, and derived classes for a symbol. Returns JSON with exact source snippets for safe edits.",
    promptGuidelines: [
      "Use this tool when the user asks for implementations of a trait, interface, or base class.",
      "Prefer it over bash/rg/grep for AST-accurate implementation discovery.",
    ],
    parameters: FindImplementationsSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeAstBroRefactorTool("implements", params.symbol, params.file, ctx, stats);
    },
  });
}
