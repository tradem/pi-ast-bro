import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import { getAstBroInfo } from "./utils";
import type { Settings, SettingsManager } from "./config";
import type { SessionStats } from "./state";

/**
 * Register the `/ast` interactive command.
 *
 * The dashboard displays session stats (estimated bytes saved, pre-flight
 * errors caught) and lets the user toggle core settings.
 */
export function registerAstCommand(pi: ExtensionAPI, settings: SettingsManager, stats: SessionStats): void {
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
        const pathLine = astBroInfo.path ? `  Resolved path     : ${astBroInfo.path}` : "  Resolved path     : (not resolved – `which` may be unavailable)";

        const headerRenderer = {
          render(_width: number): string[] {
            const summary = stats.getSummary();
            const bytesSavedFormatted = formatBytes(summary.bytesSaved);
            const lines = [
              theme.fg("accent", "pi-ast-bro Dashboard"),
              "",
              `  ast-bro status    : ${theme.fg(statusColor, statusText)}`,
            ];
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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log10(bytes) / 3);
  const clamped = Math.min(i, units.length - 1);
  const value = bytes / Math.pow(1000, clamped);
  return `${value.toFixed(clamped === 0 ? 0 : 1)} ${units[clamped]}`;
}
