import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AstBroInfo {
  available: boolean;
  path?: string;
  version?: string;
}

/**
 * Extract the first semver-looking substring from a version output line.
 *
 * Handles outputs such as "ast-bro 3.0.0" or "v3.0.0" by stripping a leading
 * label and returning "3.0.0".
 */
function extractSemver(versionOutput: string): string | undefined {
  const match = versionOutput.match(/(\d+\.\d+(?:\.\d+)?)/);
  return match?.[1];
}

/**
 * Discover whether `ast-bro` is available and, if so, its resolved path and
 * version.
 *
 * Uses spawnSync with argument arrays to prevent shell injection.
 */
export function getAstBroInfo(): AstBroInfo {
  let version: string | undefined;
  let available = false;

  try {
    const versionResult = spawnSync("ast-bro", ["--version"], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 10_000,
    });
    if (versionResult.status === 0 && versionResult.stdout) {
      available = true;
      const raw = versionResult.stdout.trim().split("\n")[0] ?? "";
      version = extractSemver(raw);
    }
  } catch {
    return { available: false };
  }

  let path: string | undefined;
  try {
    const whichResult = spawnSync("which", ["ast-bro"], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 10_000,
    });
    if (whichResult.status === 0 && whichResult.stdout) {
      path = whichResult.stdout.trim().split("\n")[0];
    }
  } catch {
    // `which` may be unavailable; fall back to just knowing availability/version.
  }

  return { available, version, path };
}

/**
 * Check whether the `ast-bro` binary is on the user's PATH.
 */
export function isAstBroAvailable(): boolean {
  return getAstBroInfo().available;
}

/** Return true if the file extension is in the configured supported list. */
export function isSupportedExtension(filePath: string, supported: string[]): boolean {
  return supported.includes(extname(filePath));
}

/**
 * Resolve a possibly-relative file path against the cwd and verify it exists.
 *
 * Returns `null` if the file does not exist or the path is unsafe.
 */
export function resolveExistingFilePath(cwd: string, filePath: string): string | null {
  if (!isPathSafe(filePath)) return null;

  const resolved = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  if (!existsSync(resolved)) return null;
  return resolved;
}

/**
 * Resolve the repository root for the given working directory.
 *
 * Falls back to `cwd` when git is unavailable or the directory is not inside a
 * git repository.
 */
export function resolveRepoRoot(cwd: string): string {
  try {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 5_000,
    });
    if (result.status === 0 && result.stdout) {
      const root = result.stdout.trim().split("\n")[0];
      if (root) return root;
    }
  } catch {
    // Not a git repository or git is unavailable.
  }
  return cwd;
}

/** Count the lines in a file. Returns 0 on any error. */
export function getFileLineCount(filePath: string): number {
  try {
    const content = readFileSync(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

/**
 * Reject paths that contain shell metacharacters or other dangerous content.
 *
 * ast-bro is invoked via spawnSync with an argument array, so injection is
 * already impossible. This guard adds defense-in-depth and makes unsafe paths
 * fail fast with a clear fallback to the normal read/edit flow.
 */
export function isPathSafe(filePath: string): boolean {
  if (typeof filePath !== "string") return false;
  if (filePath.length === 0) return false;
  if (filePath.includes("\0")) return false;

  const dangerous = /[;|&$`<>\u000D\u000A]/;
  if (dangerous.test(filePath)) return false;

  return true;
}

/**
 * Run `ast-bro` with the provided subcommand and target path.
 *
 * Wrapped in try/catch so any crash (missing binary, panic, hang) returns
 * `null` and the caller can fall back to default behavior.
 */
export function runAstBro(
  subcommand: "context" | "map" | "impact" | "implements" | "search" | "squeeze" | "cycles" | "index",
  filePath: string,
): { status: number | null; stdout: string; stderr: string } | null {
  if (!isPathSafe(filePath)) return null;

  const args: string[] = [subcommand];
  if (subcommand === "index") {
    args.push("--stats");
  }
  args.push(filePath);

  try {
    const result = spawnSync("ast-bro", args, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Run `ast-bro squeeze` on a log/text file.
 */
export function runAstBroSqueeze(
  filePath: string,
): { status: number | null; stdout: string; stderr: string } | null {
  return runAstBro("squeeze", filePath);
}

/**
 * Run `ast-bro index --stats` to inspect the index state.
 *
 * This is used to verify that an index exists before marking it stale.
 */
export function runAstBroIndexStats(
  repoPath: string,
): { status: number | null; stdout: string; stderr: string } | null {
  if (!isPathSafe(repoPath)) return null;
  try {
    const result = spawnSync("ast-bro", ["index", "--stats", "--json", repoPath], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Run `ast-bro index` to refresh the per-repo search index.
 *
 * Spawned without waiting; the result is logged but never surfaced to the agent.
 */
export function runAstBroIndexRefresh(repoPath: string): void {
  if (!isPathSafe(repoPath)) return;
  try {
    spawn("ast-bro", ["index", repoPath], {
      stdio: "ignore",
      detached: true,
    }).unref();
  } catch {
    // Best-effort refresh; never block or crash.
  }
}

function isSymbolSafe(symbol: string): boolean {
  if (typeof symbol !== "string" || symbol.length === 0) return false;
  if (symbol.includes("\0")) return false;
  const dangerous = /[;|&$`\r\n]/;
  return !dangerous.test(symbol);
}

/**
 * Run `ast-bro cycles --json [PATH]`.
 */
export function runAstBroCycles(
  repoPath: string,
): { status: number | null; stdout: string; stderr: string } | null {
  if (!isPathSafe(repoPath)) return null;
  try {
    const result = spawnSync("ast-bro", ["cycles", "--json", repoPath], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Run `ast-bro trace <FROM> <TO> [PATH]`.
 */
export function runAstBroTrace(
  from: string,
  to: string,
  repoPath?: string,
): { status: number | null; stdout: string; stderr: string } | null {
  if (!isSymbolSafe(from) || !isSymbolSafe(to)) return null;

  const args = ["trace", from, to];
  if (repoPath) args.push(repoPath);

  try {
    const result = spawnSync("ast-bro", args, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Run `ast-bro surface [PATH]`.
 */
export function runAstBroSurface(
  dirPath: string,
): { status: number | null; stdout: string; stderr: string } | null {
  if (!isPathSafe(dirPath)) return null;

  try {
    const result = spawnSync("ast-bro", ["surface", dirPath], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch {
    return null;
  }
}

/**
 * Run `ast-bro digest [PATHS]...` with an optional repo path.
 */
export function runAstBroDigest(
  paths: string[],
): { status: number | null; stdout: string; stderr: string } | null {
  if (!Array.isArray(paths) || paths.length === 0) return null;
  if (paths.some((p) => !isPathSafe(p))) return null;

  try {
    const result = spawnSync("ast-bro", ["digest", ...paths], {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch {
    return null;
  }
}

function getGitShortSha(): string | null {
  try {
    const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
    const result = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 5_000,
    });
    if (result.status === 0 && result.stdout) {
      const sha = result.stdout.trim().split("\n")[0];
      return sha ?? null;
    }
  } catch {
    // Not a git repository or git is unavailable.
  }
  return null;
}

/**
 * Minimal semver-range checker.
 *
 * Supports `^`, `>=`, `>`, `<=`, `<`, `=` and exact ranges. Build metadata is
 * ignored. This avoids pulling in the full `semver` package for the few checks
 * performed by the extension.
 */
export function satisfiesSemver(version: string, range: string): boolean {
  const cleanVersion = version.replace(/\+.*/, "");
  const [vMajorStr, vMinorStr, vPatchStr = "0"] = cleanVersion.split(".");
  const vMajor = Number.parseInt(vMajorStr, 10);
  const vMinor = Number.parseInt(vMinorStr, 10);
  const vPatch = Number.parseInt(vPatchStr, 10);
  if ([vMajor, vMinor, vPatch].some(Number.isNaN)) return false;

  const numeric = (major: number, minor: number, patch: number) => major * 1_000_000 + minor * 1_000 + patch;

  if (range.startsWith("^")) {
    const base = range.slice(1);
    const [rMajorStr, rMinorStr, rPatchStr = "0"] = base.split(".");
    const rMajor = Number.parseInt(rMajorStr, 10);
    const rMinor = Number.parseInt(rMinorStr, 10);
    const rPatch = Number.parseInt(rPatchStr, 10);
    if ([rMajor, rMinor, rPatch].some(Number.isNaN)) return false;
    if (vMajor !== rMajor) return false;
    if (vMajor === 0) {
      if (vMinor !== rMinor) return false;
      if (vPatch < rPatch) return false;
      return true;
    }
    if (vMinor < rMinor) return false;
    if (vMinor === rMinor && vPatch < rPatch) return false;
    return true;
  }

  const opMatch = range.match(/^(>=|>|<=|<|=)?\s*(.+)$/);
  if (!opMatch) return false;
  const op = opMatch[1] || "=";
  const base = opMatch[2];
  const [rMajorStr, rMinorStr, rPatchStr = "0"] = base.split(".");
  const rMajor = Number.parseInt(rMajorStr, 10);
  const rMinor = Number.parseInt(rMinorStr, 10);
  const rPatch = Number.parseInt(rPatchStr, 10);
  if ([rMajor, rMinor, rPatch].some(Number.isNaN)) return false;

  const vValue = numeric(vMajor, vMinor, vPatch);
  const rValue = numeric(rMajor, rMinor, rPatch);

  switch (op) {
    case ">=":
      return vValue >= rValue;
    case ">":
      return vValue > rValue;
    case "<=":
      return vValue <= rValue;
    case "<":
      return vValue < rValue;
    case "=":
      return vValue === rValue;
    default:
      return false;
  }
}

/**
 * Read the extension version from package.json.
 *
 * In a development checkout the current git short SHA is appended as build
 * metadata (e.g. `0.1.0-alpha.0+64f048b`). If package.json already contains
 * build metadata (e.g. from a CI build step), it is returned as-is.
 *
 * Falls back to "unknown" when package.json cannot be read, so the TUI never
 * crashes because of a missing or malformed manifest.
 */
export function getExtensionVersion(): string {
  try {
    const packagePath = join(dirname(fileURLToPath(import.meta.url)), "../package.json");
    const manifest = JSON.parse(readFileSync(packagePath, "utf-8")) as { version?: string };
    const baseVersion = manifest.version ?? "unknown";
    if (baseVersion === "unknown" || baseVersion.includes("+")) return baseVersion;
    const sha = getGitShortSha();
    return sha ? `${baseVersion}+${sha}` : baseVersion;
  } catch {
    return "unknown";
  }
}

/**
 * Run `ast-bro search` with a free-text query.
 *
 * Commands that take a query instead of a path use this helper.
 */
export function runAstBroSearch(
  query: string,
  options?: { topK?: number },
): { status: number | null; stdout: string; stderr: string } | null {
  if (typeof query !== "string" || query.length === 0) return null;

  const dangerous = /[;|&$`<>\u000D\u000A\u0000]/;
  if (dangerous.test(query)) return null;

  const topK = options?.topK;
  const args = ["search"];
  if (typeof topK === "number" && topK > 0) {
    args.push("--top-k", String(topK));
  }
  args.push(query);

  try {
    const result = spawnSync("ast-bro", args, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30_000,
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch {
    return null;
  }
}
