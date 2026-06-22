## 1. New setting `progressUpdateThrottleMs`

- [x] 1.1 In `src/config.ts`, add `progressUpdateThrottleMs` (TypeBox schema: `Type.Number({ minimum: 0, default: 100 })`).
- [x] 1.2 Default value 100 (matches pi's `BASH_UPDATE_THROTTLE_MS`). Validate min 0.
- [x] 1.3 Surface in `src/tui.ts` (`/ast`) with explanatory label.
- [x] 1.4 Update settings tables in `README.md` and `docs/architecture.md`.

## 2. Throttle scheduler helper

- [x] 2.1 In `src/utils.ts`, add `createProgressThrottle(throttleMs: number, onUpdate: AgentToolUpdateCallback | undefined)`: returns `{ progress(partialResult) | undefined; flush() }`.
- [x] 2.2 Behaviour: if `onUpdate` is undefined, the helper is a no-op (no allocations, no timers). If elapsed since last emit < `throttleMs`, hold payload and set/update a `setTimeout`. On timer fire or next call past window, emit held payload.
- [x] 2.3 `flush()` emits any held payload immediately and clears the timer — call before `execute()` returns (after the final phase) to ensure the last phase label is not suppressed.
- [x] 2.4 Per-invocation scope: the throttle is created fresh per `execute()` call; no invalidation across calls (SDK ignores post-settle calls).

## 3. Phase enum + `details` schema

- [x] 3.1 In `src/utils.ts` (or a small `src/progress.ts`), define `ToolPhase = "starting" | "querying" | "augmenting"` and helper `progressPayload(phase, statusText, current?, total?)` returning `{ content: [{type:"text", text}], details: { phase, current?, total? } }`.
- [x] 3.2 Standard phase status text templates per phase (e.g. "starting ast-bro <subcommand>…", "querying ast-bro <subcommand>…", "augmenting snippet N/M…").

## 4. Instrument each `execute()` with phase emissions + type fix

- [x] 4.1 `src/astContextPilot.ts` (`analyze_ast_context`): rename `_onUpdate` → `onUpdate`; type `AgentToolUpdateCallback<...> | undefined`. Emit `starting` before spawn (in the non-augmenting phase set, only `starting` + `querying`).
- [x] 4.2 `src/astGraphPilot.ts` (`analyze_ast_graph`): same `starting` → `querying` phase set.
- [x] 4.3 `src/astNavigationTools.ts` (`analyze_ast_trace`, `analyze_ast_surface`): same `starting` → `querying` phase set.
- [x] 4.4 `src/astBroTools.ts` (`analyze_ast_impact`, `find_implementations`): `starting` → `querying` → `augmenting` with `current`/`total` per batch where augmentation occurs.
- [x] 4.5 `src/tools.ts` (`analyze_ast_map`): `starting` → `querying` → `augmenting` (the savings-measurement read counts as the augmenting phase; emit `current`/`total` based on the single file).
- [x] 4.6 `src/tools.ts` (`analyze_ast_search`): `starting` → `querying` → `augmenting` with `current`/`total` tracking hit-files processed in `recordSearchSavings`.
- [x] 4.7 In every tool, call `throttle.flush()` before `execute()` returns to guarantee the final phase label is emitted.
- [x] 4.8 In every tool, do NOT call `onUpdate` after `execute()` returns (per SDK contract, calls after settle are ignored; respect this for hygiene).

## 5. Preserve non-interference invariants

- [x] 5.1 Audit: `ctx.ui.notify(...)` calls (e.g. in `recordSearchSavings`) remain unchanged — toast notifications are a separate channel from `onUpdate` progress.
- [x] 5.2 Audit: no `partialResult` ever enters the LLM context — this is an invariant property of pi's design; document as a non-functional requirement in `ast-tool-progress` spec (new capability) and verify via code review that no code path attempts to "yield to LLM" via onUpdate.
- [x] 5.3 Audit: tool return shapes (`content`, `isError`, `details`) are unchanged by Spec 2 — phase emissions go ONLY through `onUpdate`, never through the return value.

## 6. Tests

- [x] 6.1 Add a mock `onUpdate` callback (accumulator array of received payloads) to every existing tool-execute test.
- [x] 6.2 Assert each tool emits the expected phase sequence:
   - `analyze_ast_context` / `analyze_ast_graph` / `analyze_ast_trace` / `analyze_ast_surface`: `["starting", "querying"]`.
   - `analyze_ast_impact` / `find_implementations` / `analyze_ast_map` / `analyze_ast_search`: `["starting", "querying", "augmenting"]` (with at least one `augmenting` emission carrying `current === total` as the completion marker).
- [x] 6.3 Throttle test: drive a tool whose augmentation emits `current=1..5` rapidly (mocked) with `progressUpdateThrottleMs=1000`; assert only the final `current===5` (or initial emit, depending on elapsed time in the test) reaches `onUpdate`, and `flush()` emits the held tail.
- [x] 6.4 Throttle=undefined (no onUpdate): assert no timers are scheduled, no errors thrown, tool still returns its result.
- [x] 6.5 `partialResult` invariant test (defense-in-depth): a test that runs `analyze_ast_impact` execute() with a mocked `onUpdate` and a mocked LLM-context-builder; assert the builder never receives any `onUpdate` payload (only the final `return` value). This may be a unit test against pi's runner or a documented manual verification if pi's internals aren't easily mockable.
- [x] 6.6 Type signature test / typecheck: `tsc --noEmit` passes with `onUpdate: AgentToolUpdateCallback<...> | undefined` in signatures.
- [x] 6.7 `ctx.ui.notify` coexistence test: assert `recordSearchSavings` still calls `ctx.ui.notify` exactly as before Spec 2.
- [x] 6.8 Run `openspec validate surface-tool-progress-via-onupdate --strict` and fix any issues.
