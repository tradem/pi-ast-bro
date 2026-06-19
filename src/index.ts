import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SettingsManager } from "./config.js";
import { registerAstContextTool } from "./astContextPilot.js";
import { registerAstGraphTool } from "./astGraphPilot.js";
import {
  registerEditInterceptor,
  registerReadInterceptor,
  registerViewFileInterceptor,
} from "./interceptors.js";
import { StatsManager } from "./statsManager.js";
import { registerAstCommand, registerAstGainCommand } from "./tui.js";
import { registerRefactoringTools } from "./astBroTools.js";
import { registerAstTools } from "./tools.js";
import { getAstBroInfo, satisfiesSemver } from "./utils.js";

const SUPPORTED_PI_RANGE = "^0.79.8";
const SUPPORTED_AST_BRO_RANGE = ">=0.1.0"; // Adjust when ast-bro API requirements are known.

/**
 * Check whether the running pi-coding-agent version satisfies the supported
 * caret range. For 0.x versions a caret range is strict on the minor version,
 * so ^0.79.8 accepts >= 0.79.8 and < 0.80.0.
 */
function isPiVersionSupported(version: string): boolean {
  return satisfiesSemver(version, SUPPORTED_PI_RANGE);
}

/**
 * pi-ast-bro Extension
 *
 * Integrates the `ast-bro` Rust CLI into pi to provide:
 *  - Token-saving AST context summaries on large file reads
 *  - Pre-flight syntax checks on edit/write tool results
 *  - Dedicated LLM tools for impact analysis, AST mapping, and semantic search
 *  - An interactive `/ast` dashboard
 *  - Persistent `/ast-gain` statistics
 */
export default function piAstBroExtension(pi: ExtensionAPI): void {
  const settings = new SettingsManager();
  const stats = new StatsManager("");

  // Register explicit agent tools and the interactive dashboards first so they
  // are available regardless of whether the binary is installed.
  registerRefactoringTools(pi, stats);
  registerAstTools(pi, stats);
  registerAstContextTool(pi, settings);
  registerAstGraphTool(pi, settings);
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

  pi.on("session_start", async (_event, ctx) => {
    if (!isPiVersionSupported(VERSION)) {
      const message = `pi-ast-bro: incompatible pi-coding-agent version (${VERSION}). Expected ${SUPPORTED_PI_RANGE}. Extension disabled.`;
      try {
        ctx.ui.notify(message, "error");
      } catch {
        // UI may differ in incompatible versions; ignore notification failures.
      }
      try {
        const config = await settings.load(ctx.cwd);
        config.enabled = false;
        await settings.save(ctx.cwd, config);
      } catch {
        // Ignore settings errors in incompatible environments.
      }
      return;
    }

    stats.setCwd(ctx.cwd);
    const config = await settings.load(ctx.cwd);
    if (!config.enabled) return;

    const astBroInfo = getAstBroInfo();
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
