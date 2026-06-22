import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Settings } from "./config.js";
import { SettingsManager } from "./config.js";
import { registerAstContextTool } from "./astContextPilot.js";
import { registerAstGraphTool } from "./astGraphPilot.js";
import {
  registerEditInterceptor,
  registerReadInterceptor,
  registerViewFileInterceptor,
} from "./interceptors.js";
import { registerNavigationTools } from "./astNavigationTools.js";
import { StatsManager } from "./statsManager.js";
import { clearSessionSeed, getSessionSeed, isSessionSeedActive, setSessionSeed } from "./sessionSeedState.js";
import { registerAstCommand, registerAstGainCommand } from "./tui.js";
import { registerRefactoringTools } from "./astBroTools.js";
import { registerAstTools } from "./tools.js";
import { clearAstBroInfoCache, getAstBroInfo, isAstBroAvailable, resolveRepoRoot, runAstBroDigestAsync, satisfiesSemver } from "./utils.js";
import { SUPPORTED_AST_BRO_RANGE, SUPPORTED_PI_RANGE } from "./constants.js";

const SESSION_SEED_CUSTOM_TYPE = "ast-bro-session-seed";

function trimToBudget(stdout: string, budgetTokens: number): string {
  const budgetBytes = budgetTokens * 4;
  if (Buffer.byteLength(stdout, "utf-8") <= budgetBytes) return stdout;

  let trimmed = stdout;
  while (Buffer.byteLength(trimmed, "utf-8") > budgetBytes && trimmed.includes("\n")) {
    trimmed = trimmed.slice(0, trimmed.lastIndexOf("\n"));
  }
  if (Buffer.byteLength(trimmed, "utf-8") > budgetBytes) {
    trimmed = trimmed.slice(0, budgetBytes);
  }

  return `${trimmed}\n\n[pi-ast-bro: session seed trimmed to ~${budgetTokens} token budget — partial repo map]`;
}

async function generateSessionSeed(
  ctx: ExtensionContext,
  config: Settings,
): Promise<{ output: string; cost: number } | null> {
  if (!isAstBroAvailable()) return null;

  const seedRoot = config.sessionSeedScope === "cwd" ? ctx.cwd : resolveRepoRoot(ctx.cwd);
  const result = await runAstBroDigestAsync([seedRoot], { signal: ctx.signal, timeoutMs: 60_000 });
  if (!result || result.status !== 0 || result.stdout.length === 0) return null;

  const output = trimToBudget(result.stdout, config.sessionSeedBudget);
  const cost = Buffer.byteLength(output, "utf-8");
  return { output, cost };
}

async function maybePrepareSessionSeed(
  ctx: ExtensionContext,
  config: Settings,
  stats: StatsManager,
): Promise<void> {
  if (!config.enableSessionSeed) return;

  try {
    const seed = await generateSessionSeed(ctx, config);
    if (!seed) return;

    stats.recordSessionSeedCost(seed.cost);
    setSessionSeed(ctx.cwd, seed.output);
  } catch {
    // Graceful no-seed fallback: keep the session running normally.
  }
}

function seedAlreadyInjected(ctx: ExtensionContext): boolean {
  try {
    const entries = ctx.sessionManager.getEntries() as Array<{ type: string; customType?: string }>;
    return entries.some(
      (entry) => entry.type === "custom_message" && entry.customType === SESSION_SEED_CUSTOM_TYPE,
    );
  } catch {
    // If the session manager is unavailable, avoid duplicate injection defensively.
    return true;
  }
}

/**
 * pi-ast-bro Extension
 *
 * Integrates the `ast-bro` Rust CLI into pi to provide:
 *  - Token-saving AST context summaries on large file reads
 *  - Compressed log/text squeeze interception for large `.log`/`.txt` files
 *  - Pre-flight syntax and import-cycle checks on edit/write tool results
 *  - Lifecycle-driven search-index freshness management
 *  - Optional session-start repo-map seeding
 *  - Dedicated LLM tools for impact analysis, AST mapping, tracing, and surface inspection
 *  - Interactive `/ast` and `/ast-gain` dashboards
 *  - Persistent `/ast-gain` statistics
 */
export default function piAstBroExtension(pi: ExtensionAPI): void {
  try {
    initializeExtension(pi);
  } catch (err) {
    console.error(
      `pi-ast-bro: failed to initialize extension (${(err as Error).message}). Extension disabled.`,
    );
  }
}

function initializeExtension(pi: ExtensionAPI): void {
  const settings = new SettingsManager();
  const stats = new StatsManager("");

  // Register explicit agent tools and the interactive dashboards first so they
  // are available regardless of whether the binary is installed.
  registerRefactoringTools(pi, stats, settings);
  registerAstTools(pi, stats, settings);
  registerAstContextTool(pi, settings);
  registerAstGraphTool(pi, settings);
  registerNavigationTools(pi, settings);
  registerAstCommand(pi, settings, stats);

  const extensionDir = dirname(fileURLToPath(import.meta.url));
  pi.on("resources_discover", () => {
    return {
      skillPaths: [
        join(extensionDir, "../skills/ast-bro-refactor/SKILL.md"),
        join(extensionDir, "../skills/ast-bro-architecture/SKILL.md"),
      ],
    };
  });
  registerAstGainCommand(pi, stats);
  registerReadInterceptor(pi, settings, stats);
  registerViewFileInterceptor(pi, settings, stats);
  registerEditInterceptor(pi, settings, stats);

  process.on("exit", () => {
    stats.flushSync();
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    clearSessionSeed(ctx.cwd);
  });

  pi.on("before_agent_start", async (_event, ctx) => {
    if (!isSessionSeedActive(ctx.cwd)) return;
    if (seedAlreadyInjected(ctx)) return;

    const seed = getSessionSeed(ctx.cwd);
    if (!seed) return;

    return {
      message: {
        customType: SESSION_SEED_CUSTOM_TYPE,
        content: seed,
        display: false,
        details: { source: "ast-bro digest" },
      },
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!satisfiesSemver(VERSION, SUPPORTED_PI_RANGE)) {
      try {
        ctx.ui.notify(
          `pi-ast-bro: pi-coding-agent ${VERSION} is outside the tested range (${SUPPORTED_PI_RANGE}). Some features may not work as expected.`,
          "warning",
        );
      } catch {
        // Notification may fail in very new pi versions; the extension still tries to load.
      }
    }

    stats.setCwd(ctx.cwd);
    const config = await settings.load(ctx.cwd);
    if (!config.enabled) return;

    const astBroInfo = await getAstBroInfo();
    if (astBroInfo.available && astBroInfo.version && !satisfiesSemver(astBroInfo.version, SUPPORTED_AST_BRO_RANGE)) {
      const message = `pi-ast-bro: installed ast-bro (${astBroInfo.version}) is not supported. Expected ${SUPPORTED_AST_BRO_RANGE}. Extension disabled.`;
      try {
        ctx.ui.notify(message, "error");
      } catch {
        // UI may differ in incompatible versions; ignore notification failures.
      }
      config.enabled = false;
      await settings.save(ctx.cwd, config);
      return;
    }

    if (astBroInfo.available) {
      await maybePrepareSessionSeed(ctx, config, stats);
      ctx.ui.notify("pi-ast-bro: ast-bro detected", "info");
      return;
    }

    if (!ctx.hasUI || ctx.mode !== "tui") {
      ctx.ui.notify(
        "pi-ast-bro: ast-bro not found in PATH. Interceptors will remain disabled until it is installed.",
        "warning",
      );
      config.enabled = false;
      await settings.save(ctx.cwd, config);
      return;
    }

    const ok = await ctx.ui.confirm(
      "ast-bro not found",
      "The ast-bro binary is not in PATH. Would you like to install it?",
    );

    if (!ok) {
      ctx.ui.notify("pi-ast-bro: user declined installation. Disabling extension.", "info");
      config.enabled = false;
      await settings.save(ctx.cwd, config);
      return;
    }

    try {
      const installResult = spawnSync("ast-bro", ["install"], {
        encoding: "utf-8",
        stdio: "pipe",
        timeout: 120_000,
      });

      if (installResult.status !== 0) {
        const detail = installResult.stderr || installResult.stdout || "unknown error";
        ctx.ui.notify(`pi-ast-bro: ast-bro installation failed (${detail})`, "error");
        config.enabled = false;
        await settings.save(ctx.cwd, config);
        return;
      }

      await maybePrepareSessionSeed(ctx, config, stats);
      clearAstBroInfoCache();
      ctx.ui.notify("pi-ast-bro: ast-bro installed successfully", "info");
    } catch (err) {
      ctx.ui.notify(
        `pi-ast-bro: ast-bro installation crashed (${(err as Error).message})`,
        "error",
      );
      config.enabled = false;
      await settings.save(ctx.cwd, config);
    }
  });
}
