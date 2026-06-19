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
      default: [".rs", ".cs", ".ts", ".tsx", ".py", ".dart"],
    }),
    fileSizeThresholdLines: Type.Number({
      default: 500,
      minimum: 1,
    }),
    enablePreFlightSyntaxChecks: Type.Boolean({ default: true }),
  },
  { additionalProperties: false },
);

export type Settings = Static<typeof SettingsSchema>;

export class SettingsManager {
  private cache = new Map<string, Settings>();

  getDefaults(): Settings {
    return {
      enabled: true,
      supportedExtensions: [".rs", ".cs", ".ts", ".tsx", ".py", ".dart"],
      fileSizeThresholdLines: 500,
      enablePreFlightSyntaxChecks: true,
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
    };
  }
}
