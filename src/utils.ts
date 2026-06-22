import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-coding-agent";

export interface AstBroInfo {
  available: boolean;
  path?: string;
  version?: string;
}

interface RunAstBroAsyncOptions {
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type ToolPhase = "starting" | "querying" | "augmenting";

export interface ProgressDetails {
  phase: ToolPhase;
  current?: number;
  total?: number;
}

export function progressPayload(
  phase: ToolPhase,
  statusText: string,
  current?: number,
  total?: number,
): AgentToolResult<ProgressDetails> {
  return {
    content: [{ type: "text", text: statusText }],
    details:
      current === undefined || total === undefined ? { phase } : { phase, current, total },
  };
}

export interface ProgressThrottle {
  progress(payload: AgentToolResult<ProgressDetails>): void;
  flush(): void;
}

/**
 * Create a bash-style throttled progress emitter.
 *
 * If `onUpdate` is undefined the returned helper is a no-op (no timers, no
 * allocations). Otherwise repeated `progress()` calls within `throttleMs`
 * coalesce: only the latest payload is held and emitted when the window
 * expires. `flush()` forces any held payload out immediately and should be
 * called just before `execute()` returns.
 */
export function createProgressThrottle(
  throttleMs: number,
  onUpdate: AgentToolUpdateCallback<ProgressDetails> | undefined,
): ProgressThrottle {
  if (!onUpdate) {
    return {
      progress: () => undefined,
      flush: () => undefined,
    };
  }

  let effectiveThrottleMs = typeof throttleMs === "number" && !Number.isNaN(throttleMs) ? throttleMs : 100;
  if (effectiveThrottleMs < 0) {
    effectiveThrottleMs = 0;
  }

  let lastEmissionAt = -Infinity;
  let held: AgentToolResult<ProgressDetails> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const emit = () => {
    if (held) {
      onUpdate(held);
      held = undefined;
      lastEmissionAt = Date.now();
    }
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const progress = (payload: AgentToolResult<ProgressDetails>) => {
    held = payload;
    const elapsed = Date.now() - lastEmissionAt;

    if (elapsed >= effectiveThrottleMs) {
      emit();
      return;
    }

    if (!timer) {
      timer = setTimeout(() => {
        timer = undefined;
        emit();
      }, Math.max(0, effectiveThrottleMs - elapsed));
    }
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (held) {
      onUpdate(held);
      held = undefined;
      lastEmissionAt = Date.now();
    }
  };

  return { progress, flush };
}

let cachedAstBroInfo: AstBroInfo | undefined;
let astBroInfoComputation: Promise<AstBroInfo> | undefined;

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
 * Run `ast-bro` asynchronously with argument arrays (no shell).
 *
 * Buffers stdout/stderr from `data` events and resolves on `close`.
 * Errors on the child process are captured and returned with `status: null`.
 * If an `AbortSignal` is provided, the child is killed when it fires and the
 * Promise resolves shortly after.
 */
export function runAstBroAsync(
  args: string[],
  options: RunAstBroAsyncOptions = {},
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("ast-bro", args, {
      cwd: options.cwd,
      stdio: "pipe",
      timeout: options.timeoutMs ?? 30_000,
    });

    let stdout = "";
    let stderr = "";
    let aborted = false;

    const onStdout = (data: Buffer) => {
      stdout += data.toString("utf-8");
    };
    const onStderr = (data: Buffer) => {
      stderr += data.toString("utf-8");
    };

    child.stdout?.on("data", onStdout);
    child.stderr?.on("data", onStderr);

    const cleanup = () => {
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.off("error", onError);
      child.off("close", onClose);
      if (options.signal) {
        options.signal.removeEventListener("abort", onAbort);
      }
    };

    const onError = (err: Error) => {
      cleanup();
      resolve({ status: null, stdout, stderr: stderr || err.message });
    };

    const onClose = (code: number | null) => {
      cleanup();
      if (aborted || options.signal?.aborted) {
        resolve({ status: null, stdout, stderr: stderr || "ast-bro command aborted." });
        return;
      }
      resolve({ status: code, stdout, stderr });
    };

    child.on("error", onError);
    child.on("close", onClose);

    const onAbort = () => {
      aborted = true;
      child.kill();
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

function computeAstBroInfoSync(): AstBroInfo {
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
 * Discover whether `ast-bro` is available and, if so, its resolved path and
 * version.
 *
 * Uses `runAstBroAsync` with argument arrays to prevent shell injection.
 * The result is cached for the lifetime of the session.
 */
export async function getAstBroInfo(): Promise<AstBroInfo> {
  if (cachedAstBroInfo) {
    return cachedAstBroInfo;
  }

  if (astBroInfoComputation) {
    return astBroInfoComputation;
  }

  astBroInfoComputation = (async (): Promise<AstBroInfo> => {
    let version: string | undefined;
    let available = false;

    try {
      const versionResult = await runAstBroAsync(["--version"], { timeoutMs: 10_000 });
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

    const info: AstBroInfo = { available, version, path };
    cachedAstBroInfo = info;
    return info;
  })();

  return astBroInfoComputation;
}

/**
 * Clear the cached ast-bro availability information.
 *
 * Exposed so the extension can re-check after installing the binary mid-session.
 */
export function clearAstBroInfoCache(): void {
  cachedAstBroInfo = undefined;
  astBroInfoComputation = undefined;
}

/**
 * Check whether the `ast-bro` binary is on the user's PATH.
 *
 * Performs a cached synchronous check. On the first call within a session the
 * cache is populated synchronously so that callers (including the read/write
 * interceptors) are not forced into an async context.
 */
export function isAstBroAvailable(): boolean {
  if (!cachedAstBroInfo) {
    cachedAstBroInfo = computeAstBroInfoSync();
  }
  return cachedAstBroInfo.available;
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
 * ast-bro is invoked via spawn with an argument array, so injection is
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
 *
 * Kept synchronous for the read/squeeze interceptor fast path.
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
 *
 * Kept synchronous for the squeeze interceptor fast path.
 */
export function runAstBroSqueeze(
  filePath: string,
): { status: number | null; stdout: string; stderr: string } | null {
  return runAstBro("squeeze", filePath);
}

/**
 * Run `ast-bro index --stats` to inspect the index state.
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
 *
 * Kept synchronous for the edit-interceptor cycle check.
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
export async function runAstBroTrace(
  from: string,
  to: string,
  repoPath?: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ status: number | null; stdout: string; stderr: string } | null> {
  if (!isSymbolSafe(from) || !isSymbolSafe(to)) return null;

  const args = ["trace", from, to];
  if (repoPath) args.push(repoPath);

  try {
    return await runAstBroAsync(args, {
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? 60_000,
    });
  } catch {
    return null;
  }
}

/**
 * Run `ast-bro surface [PATH]`.
 */
export async function runAstBroSurface(
  dirPath: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ status: number | null; stdout: string; stderr: string } | null> {
  if (!isPathSafe(dirPath)) return null;

  try {
    return await runAstBroAsync(["surface", dirPath], {
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? 60_000,
    });
  } catch {
    return null;
  }
}

/**
 * Run `ast-bro digest [PATHS]...` with an optional repo path.
 *
 * Kept synchronous for the session-seed path.
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
export async function runAstBroSearch(
  query: string,
  options?: { topK?: number; signal?: AbortSignal; timeoutMs?: number },
): Promise<{ status: number | null; stdout: string; stderr: string } | null> {
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
    return await runAstBroAsync(args, {
      signal: options?.signal,
      timeoutMs: options?.timeoutMs ?? 30_000,
    });
  } catch {
    return null;
  }
}
