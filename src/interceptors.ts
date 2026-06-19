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
import type { SettingsManager } from "./config.js";
import type { StatsManager } from "./statsManager.js";
import {
  getFileLineCount,
  isAstBroAvailable,
  isPathSafe,
  isSupportedExtension,
  resolveExistingFilePath,
  runAstBro,
} from "./utils.js";

interface ViewFileInput {
  path: string;
  offset?: number;
  limit?: number;
  [key: string]: unknown;
}

const BYPASS_REMINDER =
  "\n\n[pi-ast-bro: AST structure summary shown to save tokens. If you need the full raw source, call `read` again with both `limit` and `offset` set explicitly.]";

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
}

function shouldInterceptRead(
  config: Awaited<ReturnType<SettingsManager["load"]>>,
  cwd: string,
  input: { path: string; offset?: number; limit?: number },
): { resolved: string } | null {
  if (!config.enabled) return null;

  const filePath = input.path;
  if (!isPathSafe(filePath)) return null;

  const resolved = resolveExistingFilePath(cwd, filePath);
  if (!resolved) return null;

  if (!isSupportedExtension(resolved, config.supportedExtensions)) return null;

  // Bypass mechanism: if the agent asks for a specific window, serve raw bytes.
  if (input.offset !== undefined || input.limit !== undefined) return null;

  const lineCount = getFileLineCount(resolved);
  if (lineCount <= config.fileSizeThresholdLines) return null;

  return { resolved };
}

function astOutputWithReminder(astResult: { stdout: string }): string {
  return astResult.stdout + BYPASS_REMINDER;
}

function collectTextContent(content: Array<{ type: string; text?: string }>): string {
  return content.map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : "")).join("");
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
      const astResult = runAstBro("map", decision.resolved);
      if (!astResult || astResult.status !== 0 || astResult.stdout.length === 0) return;

      try {
        const original = readFileSync(decision.resolved, "utf-8");
        const output = astOutputWithReminder(astResult);
        stats.addReadSavings(
          decision.resolved,
          Buffer.byteLength(original, "utf-8"),
          Buffer.byteLength(output, "utf-8"),
        );
      } catch {
        // Best-effort telemetry: if the original cannot be measured, still serve AST output.
      }

      overrideCtx.overrideResult({
        content: [{ type: "text", text: astOutputWithReminder(astResult) }],
      });
      return;
    }

    // Fallback path: remember this read so we can rewrite its result later.
    pendingReads.set(event.toolCallId, { resolved: decision.resolved });
  });

  pi.on("tool_result", async (event, _ctx) => {
    if (!isReadToolResult(event)) return;
    const pending = pendingReads.get(event.toolCallId);
    if (!pending) return;
    pendingReads.delete(event.toolCallId);

    const astResult = runAstBro("map", pending.resolved);
    if (!astResult || astResult.status !== 0 || astResult.stdout.length === 0) return;

    const output = astOutputWithReminder(astResult);
    const original = collectTextContent(event.content);
    stats.addReadSavings(
      pending.resolved,
      Buffer.byteLength(original, "utf-8"),
      Buffer.byteLength(output, "utf-8"),
    );

    return {
      content: [{ type: "text", text: output }],
    };
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
      const astResult = runAstBro("map", decision.resolved);
      if (!astResult || astResult.status !== 0 || astResult.stdout.length === 0) return;

      try {
        const original = readFileSync(decision.resolved, "utf-8");
        const output = astOutputWithReminder(astResult);
        stats.addReadSavings(
          decision.resolved,
          Buffer.byteLength(original, "utf-8"),
          Buffer.byteLength(output, "utf-8"),
        );
      } catch {
        // Best-effort telemetry.
      }

      overrideCtx.overrideResult({
        content: [{ type: "text", text: astOutputWithReminder(astResult) }],
      });
      return;
    }

    pendingReads.set(event.toolCallId, { resolved: decision.resolved });
  });

  pi.on("tool_result", async (event, _ctx) => {
    // view_file is a custom tool, so the standard isReadToolResult guard would
    // not match it. We therefore inspect the generic tool result shape.
    if (event.toolName !== "view_file") return;

    const pending = pendingReads.get(event.toolCallId);
    if (!pending) return;
    pendingReads.delete(event.toolCallId);

    const astResult = runAstBro("map", pending.resolved);
    if (!astResult || astResult.status !== 0 || astResult.stdout.length === 0) return;

    const output = astOutputWithReminder(astResult);
    const original = collectTextContent(event.content);
    stats.addReadSavings(
      pending.resolved,
      Buffer.byteLength(original, "utf-8"),
      Buffer.byteLength(output, "utf-8"),
    );

    return {
      content: [{ type: "text", text: output }],
    };
  });
}

/**
 * Intercept `edit` and `write` tool results and run a silent AST parse on the
 * modified file. When `ast-bro map` reports a parse error, the tool result is
 * mutated to `isError: true` so the agent can fix the syntax immediately.
 */
export function registerEditInterceptor(pi: ExtensionAPI, settings: SettingsManager, stats: StatsManager): void {
  pi.on("tool_result", async (event, ctx) => {
    if (!isEditToolResult(event) && !isWriteToolResult(event)) return;

    const config = await settings.load(ctx.cwd);
    if (!config.enabled || !config.enablePreFlightSyntaxChecks) return;
    if (!isAstBroAvailable()) return;

    const filePath = (event as ToolResultEvent).input.path as string;
    if (typeof filePath !== "string" || !isPathSafe(filePath)) return;

    const resolved = resolveExistingFilePath(ctx.cwd, filePath);
    if (!resolved) return;
    if (!isSupportedExtension(resolved, config.supportedExtensions)) return;

    const astResult = runAstBro("map", resolved);
    if (!astResult || astResult.status === 0) return;

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
  });
}
