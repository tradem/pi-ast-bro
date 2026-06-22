import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Type, type Static } from "typebox";
import { CONFIG_DIR_NAME } from "@earendil-works/pi-coding-agent";

/**
 * Persistent settings for pi-ast-bro.
 *
 * Stored at `.pi/plugins/ast-bro/settings.json` under the project root.
 * (CONFIG_DIR_NAME is used instead of hardcoding `.pi`.)
 */
export const SettingsSchema = Type.Object(
  {
    enabled: Type.Boolean({ default: true }),
    supportedExtensions: Type.Array(Type.String(), {
      default: [
        ".rs",
        ".cs",
        ".cpp",
        ".cc",
        ".cxx",
        ".hpp",
        ".hh",
        ".py",
        ".pyi",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".java",
        ".kt",
        ".kts",
        ".scala",
        ".sc",
        ".go",
        ".php",
        ".rb",
        ".sql",
        ".ddl",
        ".dml",
        ".md",
        ".markdown",
        ".mdx",
        ".mdown",
      ],
    }),
    fileSizeThresholdLines: Type.Number({
      default: 500,
      minimum: 1,
    }),
    enablePreFlightSyntaxChecks: Type.Boolean({ default: true }),
    graphMaxEdges: Type.Number({
      default: 500,
      minimum: 1,
    }),
    contextDefaultBudget: Type.Number({
      default: 4000,
      minimum: 500,
    }),
    enableLogSqueeze: Type.Boolean({ default: false }),
    enableIndexRefresh: Type.Boolean({ default: false }),
    enableSessionSeed: Type.Boolean({ default: false }),
    sessionSeedBudget: Type.Number({
      default: 4000,
      minimum: 500,
    }),
    sessionSeedScope: Type.Union([Type.Literal("cwd"), Type.Literal("root")], {
      default: "root",
    }),
    enableCyclePreflight: Type.Boolean({ default: false }),
    searchSnippetBudget: Type.Number({
      default: 8000,
      minimum: 500,
    }),
    progressUpdateThrottleMs: Type.Number({
      default: 100,
      minimum: 0,
    }),
  },
  { additionalProperties: false },
);

export type Settings = Static<typeof SettingsSchema>;

export class SettingsManager {
  private cache = new Map<string, Settings>();

  getDefaults(): Settings {
    return {
      enabled: true,
      supportedExtensions: [
        ".rs",
        ".cs",
        ".cpp",
        ".cc",
        ".cxx",
        ".hpp",
        ".hh",
        ".py",
        ".pyi",
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".java",
        ".kt",
        ".kts",
        ".scala",
        ".sc",
        ".go",
        ".php",
        ".rb",
        ".sql",
        ".ddl",
        ".dml",
        ".md",
        ".markdown",
        ".mdx",
        ".mdown",
      ],
      fileSizeThresholdLines: 500,
      enablePreFlightSyntaxChecks: true,
      graphMaxEdges: 500,
      contextDefaultBudget: 4000,
      enableLogSqueeze: false,
      enableIndexRefresh: false,
      enableSessionSeed: false,
      sessionSeedBudget: 4000,
      sessionSeedScope: "root",
      enableCyclePreflight: false,
      searchSnippetBudget: 8000,
      progressUpdateThrottleMs: 100,
    };
  }

  private settingsPath(cwd: string): string {
    return join(cwd, CONFIG_DIR_NAME, "plugins", "ast-bro", "settings.json");
  }

  async load(cwd: string): Promise<Settings> {
    const cached = this.cache.get(cwd);
    if (cached) return cached;

    const path = this.settingsPath(cwd);
    let settings = this.getDefaults();

    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, "utf-8");
        const parsed: unknown = JSON.parse(raw);
        settings = this.mergeDefaults(parsed);
      } catch {
        // If the file is corrupt, fall back to defaults and overwrite on next save.
      }
    }

    this.cache.set(cwd, settings);
    return settings;
  }

  async save(cwd: string, settings: Settings): Promise<void> {
    const path = this.settingsPath(cwd);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(settings, null, 2));
    this.cache.set(cwd, settings);
  }

  private mergeDefaults(parsed: unknown): Settings {
    const defaults = this.getDefaults();
    if (!parsed || typeof parsed !== "object") return defaults;
    const p = parsed as Partial<Settings>;

    return {
      enabled: typeof p.enabled === "boolean" ? p.enabled : defaults.enabled,
      supportedExtensions: Array.isArray(p.supportedExtensions)
        ? (p.supportedExtensions.filter((x) => typeof x === "string") as string[])
        : defaults.supportedExtensions,
      fileSizeThresholdLines:
        typeof p.fileSizeThresholdLines === "number" && p.fileSizeThresholdLines >= 1
          ? p.fileSizeThresholdLines
          : defaults.fileSizeThresholdLines,
      enablePreFlightSyntaxChecks:
        typeof p.enablePreFlightSyntaxChecks === "boolean"
          ? p.enablePreFlightSyntaxChecks
          : defaults.enablePreFlightSyntaxChecks,
      graphMaxEdges:
        typeof p.graphMaxEdges === "number" && p.graphMaxEdges >= 1
          ? p.graphMaxEdges
          : defaults.graphMaxEdges,
      contextDefaultBudget:
        typeof p.contextDefaultBudget === "number" && p.contextDefaultBudget >= 500
          ? p.contextDefaultBudget
          : defaults.contextDefaultBudget,
      enableLogSqueeze: typeof p.enableLogSqueeze === "boolean" ? p.enableLogSqueeze : defaults.enableLogSqueeze,
      enableIndexRefresh: typeof p.enableIndexRefresh === "boolean" ? p.enableIndexRefresh : defaults.enableIndexRefresh,
      enableSessionSeed: typeof p.enableSessionSeed === "boolean" ? p.enableSessionSeed : defaults.enableSessionSeed,
      sessionSeedBudget:
        typeof p.sessionSeedBudget === "number" && p.sessionSeedBudget >= 500
          ? p.sessionSeedBudget
          : defaults.sessionSeedBudget,
      sessionSeedScope: p.sessionSeedScope === "cwd" || p.sessionSeedScope === "root" ? p.sessionSeedScope : defaults.sessionSeedScope,
      enableCyclePreflight:
        typeof p.enableCyclePreflight === "boolean" ? p.enableCyclePreflight : defaults.enableCyclePreflight,
      searchSnippetBudget:
        typeof p.searchSnippetBudget === "number" && p.searchSnippetBudget >= 500
          ? p.searchSnippetBudget
          : defaults.searchSnippetBudget,
      progressUpdateThrottleMs:
        typeof p.progressUpdateThrottleMs === "number" && p.progressUpdateThrottleMs >= 0
          ? p.progressUpdateThrottleMs
          : defaults.progressUpdateThrottleMs,
    };
  }
}
