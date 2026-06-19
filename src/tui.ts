import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import type { Settings, SettingsManager } from "./config.js";
import { formatBytesHuman, formatTokens, relativePath, type StatsManager } from "./statsManager.js";
import { getAstBroInfo } from "./utils.js";

/**
 * Register the `/ast` interactive command.
 *
 * The dashboard displays session stats (estimated bytes saved, pre-flight
 * errors caught) and lets the user toggle core settings.
 */
export function registerAstCommand(pi: ExtensionAPI, settings: SettingsManager, stats: StatsManager): void {
  pi.registerCommand("ast", {
    description: "Open the pi-ast-bro dashboard",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) {
        ctx.ui.notify("The /ast dashboard requires interactive TUI mode.", "warning");
        return;
      }

      const initialSettings = await settings.load(ctx.cwd);
      const mutableSettings: Settings = { ...initialSettings };

      await ctx.ui.custom<undefined>((tui, theme, _keybindings, done) => {
        const container = new Container();

        const astBroInfo = getAstBroInfo();
        const statusColor = astBroInfo.available ? "success" : "error";
        const statusText = astBroInfo.available ? "available" : "not found";
        const versionLine = astBroInfo.version ? `  Version           : ${astBroInfo.version}` : "";
        const pathLine = astBroInfo.path
          ? `  Resolved path     : ${astBroInfo.path}`
          : "  Resolved path     : (not resolved – `which` may be unavailable)";

        const headerRenderer = {
          render(_width: number): string[] {
            const summary = stats.getSessionSummary();
            const bytesSavedFormatted = formatBytesHuman(summary.bytesSaved);
            const lines = [theme.fg("accent", "pi-ast-bro Dashboard"), ""];
            lines.push(`  ast-bro status    : ${theme.fg(statusColor, statusText)}`);
            if (versionLine) lines.push(versionLine);
            lines.push(pathLine);
            lines.push(
              "",
              `  Reads intercepted : ${summary.readsIntercepted}`,
              `  Estimated saved   : ${bytesSavedFormatted}`,
              `  Pre-flight errors : ${summary.preFlightErrorsCaught}`,
              "",
            );
            return lines;
          },
          invalidate() {},
        };
        container.addChild(headerRenderer);

        const toggleItems: SettingItem[] = [
          {
            id: "enabled",
            label: "Enable AST interceptors",
            currentValue: mutableSettings.enabled ? "on" : "off",
            values: ["on", "off"],
          },
          {
            id: "preFlightChecks",
            label: "Pre-flight syntax checks",
            currentValue: mutableSettings.enablePreFlightSyntaxChecks ? "on" : "off",
            values: ["on", "off"],
          },
          {
            id: "threshold",
            label: "File size threshold (lines)",
            currentValue: String(mutableSettings.fileSizeThresholdLines),
            values: ["100", "200", "300", "500", "1000"],
          },
        ];

        const settingsList = new SettingsList(
          toggleItems,
          Math.min(toggleItems.length + 2, 10),
          getSettingsListTheme(),
          async (id, newValue) => {
            switch (id) {
              case "enabled":
                mutableSettings.enabled = newValue === "on";
                break;
              case "preFlightChecks":
                mutableSettings.enablePreFlightSyntaxChecks = newValue === "on";
                break;
              case "threshold":
                mutableSettings.fileSizeThresholdLines = Number.parseInt(newValue, 10);
                break;
            }
            await settings.save(ctx.cwd, mutableSettings);
            tui.requestRender();
          },
          () => {
            done(undefined);
          },
        );

        container.addChild(settingsList);

        return {
          render(width: number): string[] {
            return container.render(width);
          },
          invalidate(): void {
            container.invalidate();
          },
          handleInput(data: string): void {
            settingsList.handleInput(data);
            tui.requestRender();
          },
        };
      }, { overlay: true });
    },
  });
}

/**
 * Register the `/ast-gain` interactive command.
 *
 * Displays persistent lifetime stats and the recent history of intercepted
 * reads and caught syntax errors in a retro high-score style dashboard.
 */
export function registerAstGainCommand(pi: ExtensionAPI, manager: StatsManager): void {
  pi.registerCommand("ast-gain", {
    description: "Show persistent ast-bro gain statistics",
    handler: async (_args, ctx) => {
      if (ctx.mode !== "tui" || !ctx.hasUI) {
        ctx.ui.notify("The /ast-gain dashboard requires interactive TUI mode.", "warning");
        return;
      }

      await manager.flush();
      const summary = await manager.getLifetimeSummary();

      await ctx.ui.custom<undefined>((tui, theme, _keybindings, done) => {
        const container = new Container();

        const headerRenderer = {
          render(_width: number): string[] {
            const tokensSaved = formatTokens(summary.totalBytesSaved);
            const bytesSavedFormatted = formatBytesHuman(summary.totalBytesSaved);
            const lines = [
              theme.fg("accent", "AST-BRO GAIN HIGHSCORES"),
              "",
              `  Lifetime Savings:   ~${tokensSaved} Tokens  (${bytesSavedFormatted})`,
              `  Intercepts:         ${summary.totalReadsIntercepted} large files skipped`,
              `  Saved from errors:  ${summary.totalPreFlightErrorsCaught} syntax errors caught`,
              "",
              "  Recent Activity (Last 100 actions):",
              "",
            ];

            if (summary.history.length === 0) {
              lines.push("  No recent activity.");
            } else {
              for (const entry of summary.history.slice().reverse()) {
                const time = entry.timestamp.slice(11, 19);
                const rel = relativePath(ctx.cwd, entry.path);
                if (entry.type === "read") {
                  const savedTokens = formatTokens(entry.bytesSaved ?? 0);
                  lines.push(`  [${time}] read(${rel})  -> Saved ~${savedTokens} Tokens`);
                } else {
                  lines.push(`  [${time}] edit(${rel})  -> ${entry.message ?? "Prevented SyntaxError"}`);
                }
              }
            }

            return lines;
          },
          invalidate() {},
        };
        container.addChild(headerRenderer);

        return {
          render(width: number): string[] {
            return container.render(width);
          },
          invalidate(): void {
            container.invalidate();
          },
          handleInput(_data: string): void {
            done(undefined);
          },
        };
      }, { overlay: true });
    },
  });
}
