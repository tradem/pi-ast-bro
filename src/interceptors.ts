import {
  isEditToolResult,
  isReadToolResult,
  isToolCallEventType,
  isWriteToolResult,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { SettingsManager } from "./config.js";
import { isSessionSeedActive } from "./sessionSeedState.js";
import type { StatsManager } from "./statsManager.js";
import {
  getFileLineCount,
  isAstBroAvailable,
  isPathSafe,
  isSupportedExtension,
  resolveExistingFilePath,
  resolveRepoRoot,
  runAstBroAsync,
  runAstBroCyclesAsync,
  runAstBroIndexRefresh,
} from "./utils.js";

interface ViewFileInput {
  path: string;
  offset?: number;
  limit?: number;
  [key: string]: unknown;
}

const MAP_BYPASS_REMINDER =
  "\n\n[pi-ast-bro: AST structure summary shown to save tokens. If you need the full raw source, call `read` again with both `limit` and `offset` set explicitly.]";

const SQUEEZE_BYPASS_REMINDER =
  "\n\n[pi-ast-bro: compressed log/text shown to save tokens. If you need the full raw source, call `read` again with both `limit` and `offset` set explicitly.]";

/**
 * Local augmentation for `ctx.overrideResult()`.
 *
 * Newer pi runtimes may expose this method, allowing the interceptor to skip
 * the original read entirely. When it is missing, we gracefully fall back to
 * replacing the result in the `tool_result` phase.
 */
interface OverrideContext extends ExtensionContext {
  overrideResult?: (result: { content: Array<{ type: "text"; text: string }> }) => void;
}

interface PendingRead {
  resolved: string;
  mode: "map" | "squeeze";
}

type InterceptionMode = "map" | "squeeze";

function getInterceptionMode(
  config: Awaited<ReturnType<SettingsManager["load"]>>,
  resolved: string,
): InterceptionMode | null {
  if (isSupportedExtension(resolved, config.supportedExtensions)) return "map";

  if (config.enableLogSqueeze) {
    const ext = extname(resolved).toLowerCase();
    if (ext === ".log" || ext === ".txt") return "squeeze";
  }

  return null;
}

function shouldInterceptRead(
  config: Awaited<ReturnType<SettingsManager["load"]>>,
  cwd: string,
  input: { path: string; offset?: number; limit?: number },
): PendingRead | null {
  if (!config.enabled) return null;

  const filePath = input.path;
  if (!isPathSafe(filePath)) return null;

  const resolved = resolveExistingFilePath(cwd, filePath);
  if (!resolved) return null;

  // Bypass mechanism: if the agent asks for a specific window, serve raw bytes.
  if (input.offset !== undefined || input.limit !== undefined) return null;

  const lineCount = getFileLineCount(resolved);
  if (lineCount <= config.fileSizeThresholdLines) return null;

  const mode = getInterceptionMode(config, resolved);
  if (!mode) return null;

  return { resolved, mode };
}

function astOutputWithReminder(astResult: { stdout: string }, mode: InterceptionMode): string {
  const reminder = mode === "squeeze" ? SQUEEZE_BYPASS_REMINDER : MAP_BYPASS_REMINDER;
  return astResult.stdout + reminder;
}

function collectTextContent(content: Array<{ type: string; text?: string }>): string {
  return content.map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : "")).join("");
}

function recordInterceptionSavings(
  stats: StatsManager,
  mode: InterceptionMode,
  resolved: string,
  originalBytes: number,
  outputBytes: number,
  cwd: string,
): void {
  if (mode === "squeeze") {
    stats.addSqueezeSavings(resolved, originalBytes, outputBytes);
  } else {
    stats.addReadSavings(resolved, originalBytes, outputBytes);
  }

  // Attribute any positive savings to the active session seed for ROI tracking.
  const saved = Math.max(0, originalBytes - outputBytes);
  if (saved > 0 && isSessionSeedActive(cwd)) {
    stats.recordSessionSeedSavings(saved);
  }
}

/**
 * Intercept `read` tool calls for large supported files and replace the result
 * with a token-budgeted AST context summary from `ast-bro`.
 */
export function registerReadInterceptor(pi: ExtensionAPI, settings: SettingsManager, stats: StatsManager): void {
  const pendingReads = new Map<string, PendingRead>();

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("read", event)) return;

    const config = await settings.load(ctx.cwd);
    const decision = shouldInterceptRead(config, ctx.cwd, event.input);
    if (!decision) return;

    const overrideCtx = ctx as OverrideContext;

    // Fast path: if the runtime supports overriding the result before the tool
    // runs, use it. This avoids reading the full file into memory at all.
    if (typeof overrideCtx.overrideResult === "function") {
      try {
        const astResult =
          decision.mode === "squeeze"
            ? await runAstBroAsync(["squeeze", decision.resolved], { signal: ctx.signal, timeoutMs: 30_000 })
            : await runAstBroAsync(["map", decision.resolved], { signal: ctx.signal, timeoutMs: 30_000 });
        if (!astResult || astResult.status !== 0 || astResult.stdout.length === 0) return;

        try {
          const original = readFileSync(decision.resolved, "utf-8");
          const output = astOutputWithReminder(astResult, decision.mode);
          recordInterceptionSavings(
            stats,
            decision.mode,
            decision.resolved,
            Buffer.byteLength(original, "utf-8"),
            Buffer.byteLength(output, "utf-8"),
            ctx.cwd,
          );
        } catch {
          // Best-effort telemetry: if the original cannot be measured, still serve AST output.
        }

        overrideCtx.overrideResult({
          content: [{ type: "text", text: astOutputWithReminder(astResult, decision.mode) }],
        });
      } catch {
        // Best-effort: if ast-bro fails, let the original read proceed unchanged.
      }
      return;
    }

    // Fallback path: remember this read so we can rewrite its result later.
    pendingReads.set(event.toolCallId, decision);
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!isReadToolResult(event)) return;
    const pending = pendingReads.get(event.toolCallId);
    if (!pending) return;
    pendingReads.delete(event.toolCallId);

    try {
      const astResult =
        pending.mode === "squeeze"
          ? await runAstBroAsync(["squeeze", pending.resolved], { signal: ctx.signal, timeoutMs: 30_000 })
          : await runAstBroAsync(["map", pending.resolved], { signal: ctx.signal, timeoutMs: 30_000 });
      if (!astResult || astResult.status !== 0 || astResult.stdout.length === 0) return;

      const output = astOutputWithReminder(astResult, pending.mode);
      const original = collectTextContent(event.content);
      recordInterceptionSavings(
        stats,
        pending.mode,
        pending.resolved,
        Buffer.byteLength(original, "utf-8"),
        Buffer.byteLength(output, "utf-8"),
        ctx.cwd,
      );

      return {
        content: [{ type: "text", text: output }],
      };
    } catch {
      // Best-effort: if ast-bro fails, return the original tool result unchanged.
      return;
    }
  });
}

/**
 * Mirror of the read interceptor for any custom `view_file` tool that may be
 * registered by other extensions.
 */
export function registerViewFileInterceptor(pi: ExtensionAPI, settings: SettingsManager, stats: StatsManager): void {
  const pendingReads = new Map<string, PendingRead>();

  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType<"view_file", ViewFileInput>("view_file", event)) return;

    const config = await settings.load(ctx.cwd);
    const decision = shouldInterceptRead(config, ctx.cwd, event.input);
    if (!decision) return;

    const overrideCtx = ctx as OverrideContext;

    if (typeof overrideCtx.overrideResult === "function") {
      try {
        const astResult =
          decision.mode === "squeeze"
            ? await runAstBroAsync(["squeeze", decision.resolved], { signal: ctx.signal, timeoutMs: 30_000 })
            : await runAstBroAsync(["map", decision.resolved], { signal: ctx.signal, timeoutMs: 30_000 });
        if (!astResult || astResult.status !== 0 || astResult.stdout.length === 0) return;

        try {
          const original = readFileSync(decision.resolved, "utf-8");
          const output = astOutputWithReminder(astResult, decision.mode);
          recordInterceptionSavings(
            stats,
            decision.mode,
            decision.resolved,
            Buffer.byteLength(original, "utf-8"),
            Buffer.byteLength(output, "utf-8"),
            ctx.cwd,
          );
        } catch {
          // Best-effort telemetry.
        }

        overrideCtx.overrideResult({
          content: [{ type: "text", text: astOutputWithReminder(astResult, decision.mode) }],
        });
      } catch {
        // Best-effort: if ast-bro fails, let the original view_file proceed unchanged.
      }
      return;
    }

    pendingReads.set(event.toolCallId, decision);
  });

  pi.on("tool_result", async (event, ctx) => {
    // view_file is a custom tool, so the standard isReadToolResult guard would
    // not match it. We therefore inspect the generic tool result shape.
    if (event.toolName !== "view_file") return;

    const pending = pendingReads.get(event.toolCallId);
    if (!pending) return;
    pendingReads.delete(event.toolCallId);

    try {
      const astResult =
        pending.mode === "squeeze"
          ? await runAstBroAsync(["squeeze", pending.resolved], { signal: ctx.signal, timeoutMs: 30_000 })
          : await runAstBroAsync(["map", pending.resolved], { signal: ctx.signal, timeoutMs: 30_000 });
      if (!astResult || astResult.status !== 0 || astResult.stdout.length === 0) return;

      const output = astOutputWithReminder(astResult, pending.mode);
      const original = collectTextContent(event.content);
      recordInterceptionSavings(
        stats,
        pending.mode,
        pending.resolved,
        Buffer.byteLength(original, "utf-8"),
        Buffer.byteLength(output, "utf-8"),
        ctx.cwd,
      );

      return {
        content: [{ type: "text", text: output }],
      };
    } catch {
      // Best-effort: if ast-bro fails, return the original tool result unchanged.
      return;
    }
  });
}

function parseCycles(stdout: string): string[][] {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string[] => Array.isArray(item) && item.every((p) => typeof p === "string"));
    }
  } catch {
    // Fall back to no cycles on parse failure.
  }
  return [];
}

function fingerprintCycle(cycle: string[]): string {
  return JSON.stringify([...cycle].sort());
}

function formatCycleWarning(cycles: string[][], editedFile: string): string {
  const relativeCycles = cycles.map((cycle) =>
    cycle.map((file) => (file === editedFile ? `**${file}**` : file)).join(" -> "),
  );
  return [
    "",
    "[AST pre-flight cycle check]",
    `Detected ${cycles.length} new import cycle(s) involving the edited file:`,
    ...relativeCycles.map((line) => `  ${line}`),
    "",
  ].join("\n");
}

/**
 * Intercept `edit` and `write` tool results and run a silent AST parse on the
 * modified file. When `ast-bro map` reports a parse error, the tool result is
 * mutated to `isError: true` so the agent can fix the syntax immediately.
 *
 * Additionally handles best-effort index refresh and optional import-cycle
 * pre-flight checks.
 */
export function registerEditInterceptor(pi: ExtensionAPI, settings: SettingsManager, stats: StatsManager): void {
  const seenCyclesByCwd = new Map<string, Set<string>>();

  pi.on("tool_result", async (event, ctx) => {
    if (!isEditToolResult(event) && !isWriteToolResult(event)) return;

    const config = await settings.load(ctx.cwd);
    if (!config.enabled) return;

    const filePath = (event as ToolResultEvent).input.path as string;
    if (typeof filePath !== "string" || !isPathSafe(filePath)) return;

    const resolved = resolveExistingFilePath(ctx.cwd, filePath);
    if (!resolved) return;

    const isSupported = isSupportedExtension(resolved, config.supportedExtensions);
    const eventError = (event as ToolResultEvent).isError === true;

    // Pre-flight syntax check.
    if (config.enablePreFlightSyntaxChecks && isSupported && isAstBroAvailable()) {
      const astResult = await runAstBroAsync(["map", resolved], { signal: ctx.signal, timeoutMs: 30_000 });
      if (astResult && astResult.status !== 0) {
        const diagnostic = astResult.stderr || astResult.stdout || "ast-bro reported a syntax error.";
        stats.recordPreFlightError(resolved, diagnostic);

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `[AST pre-flight syntax check failed]\n${diagnostic}\n\nPlease correct your edit syntactically before proceeding.`,
            },
          ],
        };
      }
    }

    const repoPath = resolveRepoRoot(ctx.cwd);

    // Best-effort index refresh (fire-and-forget, never blocks).
    if (config.enableIndexRefresh && !eventError) {
      runAstBroIndexRefresh(repoPath);
    }

    // Optional import-cycle pre-flight check (best-effort, never blocks result).
    let cycleAnnotation: string | undefined;
    if (config.enableCyclePreflight && !eventError && isSupported) {
      const cyclesResult = await runAstBroCyclesAsync(repoPath, { signal: ctx.signal, timeoutMs: 60_000 });
      if (cyclesResult && cyclesResult.status === 0) {
        const currentCycles = parseCycles(cyclesResult.stdout);
        const fingerprints = currentCycles.map(fingerprintCycle);
        const seen = seenCyclesByCwd.get(ctx.cwd) ?? new Set<string>();

        const newCycles = currentCycles.filter((cycle, index) => {
          const fp = fingerprints[index];
          if (!fp || seen.has(fp)) return false;
          seen.add(fp);
          return cycle.includes(resolved);
        });

        if (seenCyclesByCwd.has(ctx.cwd)) {
          // Only report cycles as "newly detected" after the baseline is established.
          if (newCycles.length > 0) {
            cycleAnnotation = formatCycleWarning(newCycles, resolved);
          }
        } else {
          // First check in this session: record all current cycles as the baseline.
          for (const fp of fingerprints) {
            if (fp) seen.add(fp);
          }
        }

        seenCyclesByCwd.set(ctx.cwd, seen);
      }
    }

    if (cycleAnnotation) {
      const existingText = collectTextContent(event.content);
      return {
        content: [
          {
            type: "text",
            text: existingText + cycleAnnotation,
          },
        ],
      };
    }
  });
}
