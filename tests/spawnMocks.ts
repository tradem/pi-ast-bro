import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { vi } from "vitest";

export type MockSpawnChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function createMockSpawnChildInternal(): MockSpawnChild {
  const child = new EventEmitter() as MockSpawnChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  // Emulate Node's behaviour where killing the child eventually emits 'close'.
  child.kill = vi.fn().mockImplementation(() => {
    child.emit("close", null);
  });
  return child;
}

/**
 * Create a fake `ChildProcess` returned from a mocked `spawn`.
 *
 * The returned object is intentionally a minimal EventEmitter subset that
 * satisfies the mocked `spawn` return type at runtime; tests cast it to
 * `ChildProcess` for type-checking purposes.
 */
export function createMockSpawnChild(): ChildProcess {
  return createMockSpawnChildInternal() as unknown as ChildProcess;
}

/**
 * Create a fake `ChildProcess` returned from a mocked `spawn` that emits the
 * supplied stdout/stderr data and `close` event on the next tick.
 */
export function emitSpawnResponse(
  status: number | null,
  stdout: string,
  stderr: string,
): ChildProcess {
  const child = createMockSpawnChildInternal();
  process.nextTick(() => {
    if (stdout.length > 0) {
      child.stdout.emit("data", Buffer.from(stdout, "utf-8"));
    }
    if (stderr.length > 0) {
      child.stderr.emit("data", Buffer.from(stderr, "utf-8"));
    }
    child.emit("close", status);
  });
  return child as unknown as ChildProcess;
}

/**
 * Convenience helper for emitting an async `spawn` error event.
 */
export function emitSpawnError(err: Error): ChildProcess {
  const child = createMockSpawnChildInternal();
  process.nextTick(() => {
    child.emit("error", err);
  });
  return child as unknown as ChildProcess;
}

/**
 * Create a slow `spawn` child that does not close until `controller.kill()` is
 * invoked externally. Useful for abort tests.
 */
export function createHoldSpawnChild(): ChildProcess & {
  controller: { kill: () => void };
} {
  const child = createMockSpawnChildInternal();
  let killed = false;

  const kill = () => {
    if (killed) return;
    killed = true;
    child.emit("close", null);
  };

  // Intercept external kill calls so the child stays alive until the test
  // triggers abort.
  child.kill = vi.fn().mockImplementation(kill);

  return Object.assign(child, { controller: { kill } }) as unknown as ChildProcess & {
    controller: { kill: () => void };
  };
}
