## Context

Every pi-ast-bro LLM tool's `execute()` is declared `async` but its body is fully synchronous: `spawnSync` for the `ast-bro` invocation, plus `readFileSync`/`statSync` loops in the augmentation/savings paths of `analyze_ast_impact`, `analyze_ast_search`, and `analyze_ast_map`. Because Node runs the entire tick without yielding, the pi TUI's render timer cannot fire, the progress spinner freezes, and the "tool in use" announcement is deferred until `execute()` returns. The freeze is only *visible* in tools whose runtime exceeds a few hundred milliseconds (`analyze_ast_context`, `analyze_ast_search`, `analyze_ast_impact`); the others block too but finish before the user notices.

A secondary amplifier: `isAstBroAvailable()` calls `getAstBroInfo()`, which spawns two subprocesses (`ast-bro --version`, `which ast-bro`) on **every** tool invocation — no caching. That is 2× blocking spawns per call before the real command even starts.

## Goals / Non-Goals

**Goals:**
- Eliminate the event-loop freeze across all 8 registered tools. Verify with a testable proxy: no `execute()` blocks the event loop for more than 50ms consecutively.
- Make `AbortSignal` meaningful: an aborted tool call kills the subprocess and returns an error result within ~1s.
- Cache ast-bro availability per session so the two availability subprocesses spawn at most once.
- Preserve the exact tool-result return shapes and the graceful-degradation contract (AGENTS.md §4).
- Preserve the `ast-gain-tracking` feature unchanged: same `StatsManager` API, same `stats.json` schema, same recording timing (after final output, before `execute()` returns).

**Non-Goals:**
- Streaming subprocess stdout through to the LLM mid-call. We buffer stdout and `await` the Promise form; we do not build a streaming pipeline. That is a larger redesign and belongs to the separate `surface-tool-progress-via-onupdate` change.
- Wiring `onUpdate` progress messages — also deferred to the separate `surface-tool-progress-via-onupdate` change.
- Index-existence caching. Index invalidation in a coding agent is unsolved (files mutate every `edit`/`write`); a stale index-existence cache could be actively harmful. Out of scope.
- Changing any tool's parameter schema or any UI text in skills/prompts.

## Decisions

1. **Buffer-then-await, not stream.** A small wrapper `runAstBroAsync(args, { cwd, signal, timeoutMs })` returns `Promise<{ status, stdout, stderr }>`, accumulating `data` events on stdout/stderr and resolving on `close`. Rationale: today's code holds the entire stdout in memory anyway; going async should change *when* we yield, not *how* we consume the output. Streaming would invite a much larger redesign and risk the exact-return-shape invariant.
2. **Availability cache, session-scoped.** `getAstBroInfo()` memoizes its result in a module-level variable; invalidation is unnecessary within a session (the binary does not appear/disappear mid-session in practice). Conservative: a long TTL (e.g. 5 min) could be added later if desired, but session scope is sufficient and simpler. Rationale: the availability check is on the hot path of every tool call; caching eliminates 2× blocking spawns per call.
3. **AbortSignal propagated to child.** The wrapper attaches `signal.addEventListener("abort", () => child.kill())` and rejects/resolves with an abort error result when killed. Rationale: pi already passes an `AbortSignal` to `execute()` (currently ignored); honoring it lets users interrupt genuinely long `ast-bro context` runs (60s timeout) and aligns with pi's expected contract.
4. **Read-once-per-call buffer cache (REQUIRED).** During augmentation and savings measurement in a single `execute()` invocation, each unique resolved file path is read at most once; subsequent reads use a cached `Buffer`/`string` keyed by resolved path. Rationale: without this, `analyze_ast_impact`'s `augmentResult` (which may call `injectSnippet` up to 50× + nested) can issue redundant reads of the same file and, worse, read different contents if the file is mutated mid-call (realistic in a coding agent). The existing `seenFiles: Set<string>` plumbing in `astBroTools.ts` extends naturally to a `Map<string, string>`.
5. **Savings recording stays synchronous and in-order.** `stats.addReadSavings(...)` (and siblings) remain sync calls; they are invoked *after* the final tool output is computed and *before* `execute()` returns. This preserves today's exact recording ordering and the `ast-gain-tracking` contract without any schema or API change. The I/O *used to measure* savings (the `readFileSync`/`statSync` for sizing) becomes async; the recording itself stays sync because it's already an in-memory counter bump with deferred persistence (`scheduleSave()` via `setTimeout`).
6. **Scope boundary enforced.** `src/statsManager.ts` and `src/interceptors.ts` are NOT modified. The read interceptor's own savings path (`recordInterceptionSavings`) and the `StatsManager` interface/schema/persistence are untouched. This isolates the freeze fix from the savings feature.

## Risks / Trade-offs

- **Widened savings-measurement race.** Between `ast-bro` writing its match list (synchronous subprocess output) and the extension reading those files for snippet augmentation *and* sizing, an `edit` tool may mutate the file. Without the read-once cache, the augmented snippet and the measured size could come from different file states, producing historically-inconsistent savings. Mitigated by Decision #4. Existing docstrings already label savings as approximate ("approximate tokens", "estimate byte savings"); no new accuracy guarantee is created.
- **Test rewrite surface.** Today's unit tests mock `node:child_process` via `spawnSync` and assert argument arrays on the sync return. Moving to `spawn` requires re-mocking against the event model (emit `data`/`close` events) and asserting argument arrays at spawn time. This is required, non-trivial, and tracked as an explicit task.
- **Abort is a behavior change.** Previously, signaling abort on a tool call was a no-op for our tools (the signal was ignored and the subprocess ran to completion up to its 60s timeout). After this change, abort kills the subprocess. This is aligned with user expectations but is technically a behavior change; documented in the proposal.
- **Process error accounting.** Today a spawned-but-immediately-failing `ast-bro` (e.g. binary present but panics) returns a non-zero `status` that the existing graceful-degradation path handles. The async wrapper must preserve this: it must resolve with `status: null` and captured stderr on an `'error'` event, and must not let an exception escape `execute()`.
