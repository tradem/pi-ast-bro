#!/usr/bin/env node
#!/usr/bin/env node
/**
 * Compute a semver-compatible pre-release version from the current git HEAD
 * and write it to package.json and package-lock.json.
 *
 * Intended for CI / build-time use. The source package.json stays at a stable
 * base version; this script stamps the running artifacts with the exact commit
 * SHA so the TUI can display it.
 *
 * Format: 0.1.0-alpha.0+<short-sha>
 *
 * Run manually:
 *   node scripts/update-version.js
 *
 * Or via npm:
 *   npm run version:alpha
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_VERSION = "0.1.0-alpha.0";

function runGit(args) {
  return execSync(`git ${args}`, {
    cwd: ROOT,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "ignore"],
  }).trim();
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, data) {
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

function main() {
  const shortSha = runGit("rev-parse --short HEAD");
  const version = `${BASE_VERSION}+${shortSha}`;

  const packageJsonPath = join(ROOT, "package.json");
  const packageJson = readJson(packageJsonPath);
  packageJson.version = version;
  writeJson(packageJsonPath, packageJson);

  const lockPath = join(ROOT, "package-lock.json");
  try {
    const lock = readJson(lockPath);
    lock.version = version;
    if (lock.packages && lock.packages[""]) {
      lock.packages[""].version = version;
    }
    writeJson(lockPath, lock);
  } catch {
    // package-lock.json missing or unreadable; skip silently.
  }

  console.log(version);
}

main();
