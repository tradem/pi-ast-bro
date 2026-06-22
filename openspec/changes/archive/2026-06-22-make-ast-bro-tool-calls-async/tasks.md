## 1. Async subprocess wrapper + availability cache

- [x] 1.1 In `src/utils.ts`, add `runAstBroAsync(args, { cwd, signal, timeoutMs })` returning `Promise<{ status: number|null, stdout: string, stderr: string }>`. Uses `child_process.spawn("ast-bro", args, ...)` with argument arrays (no shell), accumulates stdout/stderr from `data` events, resolves on `close`, captures `'error'` events without throwing.
- [x] 1.2 In `runAstBroAsync`, attach `signal.addEventListener("abort", () => child.kill())` when a signal is passed; resolve with `status: null` and an abort marker on kill.
- [x] 1.3 Replace `spawnSync` inside `getAstBroInfo()` with `runAstBroAsync` (`--version`) and an async `which` equivalent; cache the resolved `AstBroInfo` in a module-level variable so availability is computed at most once per session.
- [x] 1.4 Update `isAstBroAvailable()` to a cached synchronous check against the cached info (first call lazily computes); expose an async warm-up if needed by `execute()` paths.

## 2. Migrate `utils.ts` ast-bro runners to async

- [x] 2.1 Convert `runAstBro`, `runAstBroSearch`, `runAstBroTrace`, `runAstBroSurface` to async wrappers returning `Promise<{ status, stdout, stderr }>` via `runAstBroAsync`. Preserve argument-array construction exactly.
- [x] 2.2 Add `runAstBroContext` (in `src/astContextPilot.ts`) and `runAstBroGraph` (in `src/astGraphPilot.ts`) as async via `runAstBroAsync`.
- [x] 2.3 Preserve existing timeouts (60s for context/graph/trace; existing values for search/surface/map) and pass them through to `runAstBroAsync`.

## 3. Migrate tool `execute()` bodies to async + abort propagation

- [x] 3.1 `src/astContextPilot.ts`: `analyze_ast_context` `execute()` awaits `runAstBroContext` and passes the `AbortSignal` through; preserve return shape and error ordering.
- [x] 3.2 `src/astGraphPilot.ts`: same for `analyze_ast_graph`.
- [x] 3.3 `src/astNavigationTools.ts`: same for `analyze_ast_trace` and `analyze_ast_surface`.
- [x] 3.4 `src/astBroTools.ts`: same for `analyze_ast_impact` and `find_implementations`.
- [x] 3.5 `src/tools.ts`: same for `analyze_ast_map` and `analyze_ast_search`; preserve exact return shape.
- [x] 3.6 In every tool, preserve graceful-degradation: wrap spawned execution so that errors/aborts/timeouts return `{ content: [...], isError: true, details: {...} }` rather than throwing out of `execute()`.

## 4. Async augmentation + read-once-per-call buffer cache

- [x] 4.1 In `src/astBroTools.ts`, introduce a per-call `Map<string, string>` keyed by resolved path; `injectSnippet` reads through the cache (using `fs.promises.readFile`).
- [x] 4.2 Convert `augmentArray`, `augmentResult`, `injectSnippet` to async; preserve the existing `seenFiles: Set<string>` plumbing (now augmented with the buffer map) and `originalBytes` / `filesRead` accounting.
- [x] 4.3 In `src/tools.ts` `recordSearchSavings`, replace `statSync` loop with `fs.promises.stat`; preserve the byte-summing and representative-path logic.
- [x] 4.4 In `src/tools.ts` `analyze_ast_map`, replace the savings-measurement `readFileSync` with `fs.promises.readFile`; preserve the original-vs-output byte comparison and the `stats.addReadSavings` call ordering.

## 5. Preserve savings-recording invariant

- [x] 5.1 Audit every tool's `execute()`: assert that `stats.addReadSavings(...)` (or the relevant sibling) is called exactly once per call that yields savings, AFTER the final output is computed (augmented/measured) and BEFORE `execute()` returns.
- [x] 5.2 Confirm `src/statsManager.ts` is not modified: interface, schema, `scheduleSave`/`loadStats`/`persist`/`flushSync` unchanged.
- [x] 5.3 Confirm `src/interceptors.ts` `recordInterceptionSavings` is not modified: read-interceptor savings path unchanged.

## 6. Tests (mock migration + new invariants)

- [x] 6.1 Migrate all `vi.mock('node:child_process')` sites from `spawnSync` to `spawn`; provide a fake that accepts an args array and emits `data`/`close` events with controllable stdout/stderr/status.
- [x] 6.2 Preserve existing argument-array assertions (e.g. `["map", "target_file"]`, `["context", "--json", "--compact", "--budget", "4000", target, path]`).
- [x] 6.3 Add a 50ms-consecutive-block test: drive a mocked slow `ast-bro` and assert a fake timer fires within ~50ms during the call (event-loop yield proof).
- [x] 6.4 Add an abort test: `controller.abort()` after invoking `execute()`; assert the spawned child is killed and `execute()` returns `isError: true` within ~1s.
- [x] 6.5 Add a read-once test for `analyze_ast_impact`: mocked JSON with multiple hits in the same path; assert `fs.readFile` is called at most once per unique resolved path.
- [x] 6.6 Add a savings-invariant test: assert `stats.addReadSavings` is called exactly once (and with non-negative `savedBytes`) per `analyze_ast_map`/`analyze_ast_search`/`analyze_ast_impact` call that yields savings.
- [x] 6.7 Add a graceful-degradation test for the timeout/error path: spawned child emits `'error'`; assert `execute()` returns an error result and does not throw.
- [x] 6.8 Run `openspec validate make-ast-bro-tool-calls-async --strict` and fix any issues.
