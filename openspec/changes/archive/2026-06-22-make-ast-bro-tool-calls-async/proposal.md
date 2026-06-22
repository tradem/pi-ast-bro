## Why

Today every pi-ast-bro LLM tool `execute()` body runs **synchronously on the Node.js event loop** via `spawnSync` (and, for `analyze_ast_impact` / `analyze_ast_search`, additional `readFileSync`/`statSync` loops for snippet augmentation and savings measurement). When a tool call takes more than a few hundred milliseconds — common for `analyze_ast_context`, `analyze_ast_search`, and `analyze_ast_impact` on non-trivial repos — the pi TUI freezes: the progress spinner stops animating and the "tool in use" announcement is deferred until `execute()` returns. The same blocking occurs for every tool, but is only *visible* in the slow three.

The freeze is not a UI bug in pi — it is a direct consequence of the extension blocking the event loop. No `await` yield point exists between the start of `execute()` and its return, so pi cannot paint a frame.

A secondary inefficiency amplifies the blocking: `isAstBroAvailable()` spawns two subprocesses (`ast-bro --version`, `which ast-bro`) **on every tool call** because availability is not cached across a session.

## What Changes

- **Async subprocess execution.** Replace `spawnSync` with `child_process.spawn` wrapped as a Promise across all LLM-facing tool `execute()` paths and the shared `utils.ts` runners (`runAstBro`, `runAstBroSearch`, `runAstBroTrace`, `runAstBroSurface`, `runAstBroContext`, `runAstBroGraph`, `getAstBroInfo`).
- **Async file reads for augmentation & measurement.** Replace `readFileSync`/`statSync` loops inside `analyze_ast_impact`'s `augmentResult`/`augmentArray`/`injectSnippet`, `analyze_ast_search`'s `recordSearchSavings`, and `analyze_ast_map`'s savings-measurement read with `fs.promises.readFile`/`fs.promises.stat`.
- **Session availability cache.** Cache `getAstBroInfo()` for the lifetime of the session (or a conservative TTL) so the two availability subprocesses spawn at most once, not twice per tool call.
- **AbortSignal propagation.** Pass the `AbortSignal` (currently ignored by every `execute()`) through to the spawned subprocess and `child.kill()` it on abort; return an error result instead of hanging to completion.
- **Read-once-per-call buffer cache.** During augmentation and savings measurement within a single `execute()` invocation, each unique file path SHALL be read at most once; subsequent reads in the same call use a cached buffer.
- **Test migration.** Update all unit tests that mock `node:child_process` via `spawnSync` to mock the async `spawn` form, preserving argument-array assertions and adding assertions for abort + read-once invariants.

### Capabilities

#### Modified Capabilities
- `ast-context-pilot` — `analyze_ast_context` `execute()` becomes async; gains abort propagation; availability cached.
- `ast-graph-pilot` — same for `analyze_ast_graph`.
- `ast-navigation-tools` — same for `analyze_ast_trace` and `analyze_ast_surface`.
- `ast-refactoring` — same for `analyze_ast_impact` and `find_implementations`; augmentation file reads become async and read-once-per-call.
- `ast-search-summary` — `analyze_ast_search` measurement reads become async and read-once-per-call. (`analyze_ast_map`, registered in the same file but not separately specced, follows the same pattern.)

#### Non-Modified (explicitly preserved)
- `ast-gain-tracking` — The `StatsManager` interface, `stats.json` schema, debounce/flush mechanism, `/ast-gain` dashboard, and `recordInterceptionSavings` in `src/interceptors.ts` are explicitly OUT of scope. Savings SHALL continue to be recorded via the same synchronous `stats.addReadSavings(...)` / siblings, called after the final tool output is computed and before `execute()` returns. Savings measurement remains a best-effort approximation; going async may widen the concurrency window but introduces no new accuracy requirements. Documented in `design.md`.

## Impact

- **Code**: `src/utils.ts` (spawn-as-promise wrapper, availability cache), `src/astContextPilot.ts`, `src/astGraphPilot.ts`, `src/astNavigationTools.ts`, `src/astBroTools.ts` (`augmentResult` family + `execute` bodies), `src/tools.ts` (`recordSearchSavings`, `analyze_ast_map` measurement), `src/index.ts` (cache lifecycle). `src/statsManager.ts` and `src/interceptors.ts` are NOT modified.
- **Behavior**: Tool result shapes (`content`, `isError`, `details`) are unchanged. New behavior: aborted tool calls return an error result instead of running to completion; the event loop yields during subprocess execution and async file reads. No new tool parameters exposed to the LLM.
- **Dependencies**: No new npm packages. Still only the `ast-bro` CLI via `child_process.spawn` with argument arrays (injection-safe, no shell).
- **Risk**:
  - **Widened savings-measurement race** — between `ast-bro` writing its match list and the extension reading those files for augmentation/sizing, an `edit` tool may mutate the file, producing an augmented snippet and a measured size from different file states. Mitigated by the read-once-per-call cache (single read per file per call) and by the existing "approximate" documentation of savings. No new accuracy guarantee.
  - **Test rewrite surface** — every `spawnSync`-based test mock must be re-tooled for the async `spawn` event model. Acceptable cost; required by the change.
  - **Abort semantics change** — long-running `ast-bro` calls can now actually be interrupted, which is a behavior change (previously the signal was ignored). Documented; aligned with user expectations.
