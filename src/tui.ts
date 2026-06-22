import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList } from "@earendil-works/pi-tui";
import type { Settings, SettingsManager } from "./config.js";
import { formatBytesHuman, formatTokens, relativePath, type StatsManager } from "./statsManager.js";
import { getAstBroInfo, getExtensionVersion, satisfiesSemver } from "./utils.js";
import { SUPPORTED_AST_BRO_RANGE } from "./constants.js";

interface NumberPreset {
  value: number;
  label: string;
}

const CONTEXT_BUDGET_PRESETS: NumberPreset[] = [
  { value: 1000, label: "1000 — compact context" },
  { value: 2000, label: "2000 — lean context" },
  { value: 4000, label: "4000 — standard context" },
  { value: 8000, label: "8000 — detailed context" },
  { value: 16000, label: "16000 — deep context" },
];

const GRAPH_MAX_EDGES_PRESETS: NumberPreset[] = [
  { value: 100, label: "100 — minimal graph" },
  { value: 250, label: "250 — small graph" },
  { value: 500, label: "500 — balanced graph" },
  { value: 1000, label: "1000 — large graph" },
  { value: 2500, label: "2500 — very large graph" },
];

const SEARCH_SNIPPET_BUDGET_PRESETS: NumberPreset[] = [
  { value: 2000, label: "2000 — quick search" },
  { value: 4000, label: "4000 — standard search" },
  { value: 8000, label: "8000 — detailed search" },
  { value: 16000, label: "16000 — deep search" },
  { value: 32000, label: "32000 — exhaustive search" },
];

function parsePresetLabel(label: string): number {
  const match = label.match(/^(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function formatPreset(presets: NumberPreset[], value: number): string {
  const preset = presets.find((p) => p.value === value);
  return preset ? preset.label : `${value} — custom`;
}

function presetValues(presets: NumberPreset[], currentValue: number): string[] {
  const labels = presets.map((p) => p.label);
  const currentLabel = formatPreset(presets, currentValue);
  if (!labels.includes(currentLabel)) {
    labels.push(currentLabel);
  }
  return labels;
}

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

      await ctx.ui.custom<undefined>(async (tui, theme, _keybindings, done) => {
        const container = new Container();

        const astBroInfo = await getAstBroInfo();
        const extensionVersion = getExtensionVersion();
        const statusColor = astBroInfo.available ? "success" : "error";
        const statusText = astBroInfo.available ? "available" : "not found";
        const extensionVersionLine = `  Extension version : ${extensionVersion}`;
        const expectedAstBroLine = `  Expected ast-bro  : ${SUPPORTED_AST_BRO_RANGE}`;
        const astBroVersionSupported =
          astBroInfo.version !== undefined && satisfiesSemver(astBroInfo.version, SUPPORTED_AST_BRO_RANGE);
        const versionLine = astBroInfo.version ? `  ast-bro version   : ${astBroInfo.version}` : "";
        const pathLine = astBroInfo.path
          ? `  Resolved path     : ${astBroInfo.path}`
          : "  Resolved path     : (not resolved – `which` may be unavailable)";

        const headerRenderer = {
          render(_width: number): string[] {
            const summary = stats.getSessionSummary();
            const bytesSavedFormatted = formatBytesHuman(summary.bytesSaved);
            const lines = [theme.fg("accent", "pi-ast-bro Dashboard"), ""];
            lines.push(extensionVersionLine);
            lines.push(`  ast-bro status    : ${theme.fg(statusColor, statusText)}`);
            lines.push(expectedAstBroLine);
            if (versionLine) {
              lines.push(
                astBroVersionSupported ? versionLine : theme.fg("error", versionLine),
              );
            }
            lines.push(pathLine);
            const squeezeSavedFormatted = formatBytesHuman(summary.squeezeBytesSaved);
            lines.push(
              "",
              `  Reads intercepted : ${summary.readsIntercepted}`,
              `  Estimated saved   : ${bytesSavedFormatted}`,
              `  Squeeze saved     : ${squeezeSavedFormatted}`,
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
            id: "logSqueeze",
            label: "Squeeze large .log/.txt files",
            currentValue: mutableSettings.enableLogSqueeze ? "on" : "off",
            values: ["on", "off"],
          },
          {
            id: "indexRefresh",
            label: "Mark search index stale after edits",
            currentValue: mutableSettings.enableIndexRefresh ? "on" : "off",
            values: ["on", "off"],
          },
          {
            id: "sessionSeed",
            label: "Seed session with repo digest",
            currentValue: mutableSettings.enableSessionSeed ? "on" : "off",
            values: ["on", "off"],
          },
          {
            id: "sessionSeedBudget",
            label: "Session seed budget (tokens)",
            currentValue: formatPreset(CONTEXT_BUDGET_PRESETS, mutableSettings.sessionSeedBudget),
            values: presetValues(CONTEXT_BUDGET_PRESETS, mutableSettings.sessionSeedBudget),
          },
          {
            id: "sessionSeedScope",
            label: "Session seed scope",
            currentValue: mutableSettings.sessionSeedScope,
            values: ["root", "cwd"],
          },
          {
            id: "cyclePreflight",
            label: "Post-edit import-cycle check",
            currentValue: mutableSettings.enableCyclePreflight ? "on" : "off",
            values: ["on", "off"],
          },
          {
            id: "threshold",
            label: "File size threshold (lines)",
            currentValue: String(mutableSettings.fileSizeThresholdLines),
            values: ["100", "200", "300", "500", "1000"],
          },
          {
            id: "contextDefaultBudget",
            label: "Context budget (tokens)",
            currentValue: formatPreset(CONTEXT_BUDGET_PRESETS, mutableSettings.contextDefaultBudget),
            values: presetValues(CONTEXT_BUDGET_PRESETS, mutableSettings.contextDefaultBudget),
          },
          {
            id: "graphMaxEdges",
            label: "Graph edge limit",
            currentValue: formatPreset(GRAPH_MAX_EDGES_PRESETS, mutableSettings.graphMaxEdges),
            values: presetValues(GRAPH_MAX_EDGES_PRESETS, mutableSettings.graphMaxEdges),
          },
          {
            id: "searchSnippetBudget",
            label: "Search snippet budget (tokens)",
            currentValue: formatPreset(SEARCH_SNIPPET_BUDGET_PRESETS, mutableSettings.searchSnippetBudget),
            values: presetValues(SEARCH_SNIPPET_BUDGET_PRESETS, mutableSettings.searchSnippetBudget),
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
              case "logSqueeze":
                mutableSettings.enableLogSqueeze = newValue === "on";
                break;
              case "indexRefresh":
                mutableSettings.enableIndexRefresh = newValue === "on";
                break;
              case "sessionSeed":
                mutableSettings.enableSessionSeed = newValue === "on";
                break;
              case "sessionSeedBudget":
                mutableSettings.sessionSeedBudget = parsePresetLabel(newValue);
                break;
              case "sessionSeedScope":
                mutableSettings.sessionSeedScope = newValue === "cwd" ? "cwd" : "root";
                break;
              case "cyclePreflight":
                mutableSettings.enableCyclePreflight = newValue === "on";
                break;
              case "threshold":
                mutableSettings.fileSizeThresholdLines = Number.parseInt(newValue, 10);
                break;
              case "contextDefaultBudget":
                mutableSettings.contextDefaultBudget = parsePresetLabel(newValue);
                break;
              case "graphMaxEdges":
                mutableSettings.graphMaxEdges = parsePresetLabel(newValue);
                break;
              case "searchSnippetBudget":
                mutableSettings.searchSnippetBudget = parsePresetLabel(newValue);
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
            const squeezeTokensSaved = formatTokens(summary.totalSqueezeBytesSaved);
            const squeezeBytesSavedFormatted = formatBytesHuman(summary.totalSqueezeBytesSaved);
            const seedCostFormatted = formatBytesHuman(summary.totalSessionSeedCost);
            const seedSavingsFormatted = formatBytesHuman(summary.totalSessionSeedSavings);
            const seedRoi = summary.totalSessionSeedCost > 0
              ? ((summary.totalSessionSeedSavings - summary.totalSessionSeedCost) / summary.totalSessionSeedCost * 100).toFixed(0)
              : "0";

            const lines = [
              theme.fg("accent", "AST-BRO GAIN HIGHSCORES"),
              "",
              `  Lifetime Savings:     ~${tokensSaved} Tokens  (${bytesSavedFormatted})`,
              `  Intercepts:           ${summary.totalReadsIntercepted} large files skipped`,
              `  Log/text squeeze:     ~${squeezeTokensSaved} Tokens  (${squeezeBytesSavedFormatted})`,
              `  Saved from errors:    ${summary.totalPreFlightErrorsCaught} syntax errors caught`,
              `  Session seed cost:    ${seedCostFormatted}`,
              `  Session seed savings: ${seedSavingsFormatted}`,
              `  Session seed ROI:     ${seedRoi}%`,
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
                } else if (entry.type === "squeeze") {
                  const savedTokens = formatTokens(entry.bytesSaved ?? 0);
                  lines.push(`  [${time}] squeeze(${rel})  -> Saved ~${savedTokens} Tokens`);
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
