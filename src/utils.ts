import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";

export interface AstBroInfo {
  available: boolean;
  path?: string;
  version?: string;
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
      version = versionResult.stdout.trim().split("\n")[0];
    }
  } catch {
    return { available: false };
  }

  // Try to resolve the absolute path via `which`. This is best-effort: some
  // minimal containers may not ship `which`, but the binary can still be usable.
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
    // `which` is not available; we still report the binary as usable.
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

  // Reject common shell metacharacters and control characters.
  const dangerous = /[;|&$`<>\r\n]/;
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
  subcommand: "context" | "map" | "impact" | "implements" | "search",
  filePath: string,
): { status: number | null; stdout: string; stderr: string } | null {
  if (!isPathSafe(filePath)) return null;

  try {
    const result = spawnSync("ast-bro", [subcommand, filePath], {
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
 * Run `ast-bro search` with a free-text query.
 *
 * Commands that take a query instead of a path use this helper.
 */
export function runAstBroSearch(query: string): { status: number | null; stdout: string; stderr: string } | null {
  if (typeof query !== "string" || query.length === 0) return null;
  // Reject query strings that attempt shell injection even though spawnSync
  // uses an argument array.
  const dangerous = /[;|&$`<>\r\n\0]/;
  if (dangerous.test(query)) return null;

  try {
    const result = spawnSync("ast-bro", ["search", query], {
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
