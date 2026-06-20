/**
 * Lightweight in-memory state to track which sessions have received an
 * `ast-bro digest` seed. Used by interceptors to attribute avoided reads back
 * to the seed for ROI reporting.
 */
const activeSeeds = new Map<string, string>();

export function setSessionSeed(cwd: string, digest: string): void {
  activeSeeds.set(cwd, digest);
}

export function getSessionSeed(cwd: string): string | undefined {
  return activeSeeds.get(cwd);
}

export function clearSessionSeed(cwd: string): void {
  activeSeeds.delete(cwd);
}

export function isSessionSeedActive(cwd: string): boolean {
  return activeSeeds.has(cwd);
}
