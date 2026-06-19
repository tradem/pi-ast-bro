import { Type, type Static } from "typebox";
import { readFileSync, statSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatBytesHuman, type StatsManager } from "./statsManager.js";
import { isAstBroAvailable, isPathSafe, resolveExistingFilePath, runAstBro } from "./utils.js";

/**
 * TypeBox schemas for the two AST refactoring tools.
 */
export const AnalyzeAstImpactSchema = Type.Object({
  path: Type.String({ description: "Path to the file or symbol to analyze" }),
});

export const FindImplementationsSchema = Type.Object({
  path: Type.String({ description: "Path to the interface or base class" }),
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

interface AugmentResult {
  payload: unknown;
  originalBytes: number;
  filesRead: number;
}

/**
 * For each match object that contains a valid file path and line number, resolve
 * the file against the agent's cwd, read the surrounding source block, and
 * attach it as `exact_snippet`.
 *
 * Results are hard-limited to {@link MAX_RESULTS}. If the input contains more
 * matches a top-level `attention_required` flag is added and the output is
 * wrapped in `{ results, attention_required }` to keep the JSON schema stable.
 */
function augmentResult(parsed: unknown, cwd: string): AugmentResult {
  if (!Array.isArray(parsed)) {
    return { payload: parsed, originalBytes: 0, filesRead: 0 };
  }

  const seenFiles = new Set<string>();
  let originalBytes = 0;
  const augmented: Array<Record<string, unknown>> = [];

  for (let i = 0; i < Math.min(parsed.length, MAX_RESULTS); i++) {
    const item = parsed[i];
    const match = isValidMatch(item) ? item : null;
    if (!match) {
      augmented.push(item as Record<string, unknown>);
      continue;
    }

    const rawPath = getMatchFile(match)!;
    const resolved = resolveExistingFilePath(cwd, rawPath);

    if (resolved) {
      const snippet = extractSnippet(resolved, match.line);
      if (snippet) {
        (match as Record<string, unknown>).exact_snippet = snippet;
        if (!seenFiles.has(resolved)) {
          seenFiles.add(resolved);
          originalBytes += getFileSizeBytes(resolved);
        }
      }
    }

    augmented.push(match as Record<string, unknown>);
  }

  const payload: Record<string, unknown> = { results: augmented };
  if (parsed.length > MAX_RESULTS) {
    payload.attention_required = `Truncated. ${parsed.length - MAX_RESULTS} additional elements omitted.`;
  }

  return { payload, originalBytes, filesRead: seenFiles.size };
}

export async function executeAstBroRefactorTool(
  subcommand: AstRefactorCommand,
  target: string,
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

  if (!isPathSafe(target)) {
    return {
      content: [{ type: "text", text: "Invalid or unsafe file path." }],
      isError: true,
      details: { exitCode: null },
    };
  }

  const result = runAstBro(subcommand, target);
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
  if (parsed === null || !Array.isArray(parsed)) {
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
    description:
      "Cross-file impact analysis: traces callers, callees, and reverse-deps. Returns JSON with exact source snippets for safe edits.",
    parameters: AnalyzeAstImpactSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeAstBroRefactorTool("impact", params.path, ctx, stats);
    },
  });

  pi.registerTool({
    name: "find_implementations",
    label: "Find Implementations",
    description:
      "Find interface implementations and derived classes. Returns JSON with exact source snippets for safe edits.",
    parameters: FindImplementationsSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return executeAstBroRefactorTool("implements", params.path, ctx, stats);
    },
  });
}
