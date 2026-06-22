## Why

After `make-ast-bro-tool-calls-async` ships, the event loop yields during `ast-bro` invocations and async augmentation, so the pi TUI spinner keeps animating. But "spinner animating" only signals "something is happening" — it does not tell the user *what* phase the tool is in. A user watching a multi-second `analyze_ast_impact` call sees a spinning cursor with no information about whether `ast-bro` is still running, augmentation has begun, or how far through the augmentation loop the tool is.

pi's SDK provides exactly the right hook: `execute()` receives an `onUpdate: AgentToolUpdateCallback<TDetails>` parameter that tools can call to publish partial results. Our extension currently types this parameter as `_onUpdate: unknown` and ignores it in every tool. The `onUpdate` flow has been verified end-to-end: it emits a `tool_execution_update` event that the pi TUI consumes to render a partial tool result, it is scoped to the current `execute()` invocation, and crucially **`partialResult` is never inserted into the LLM context** — only the final `execute()` return value reaches the model. So progress messages are a pure UX affordance with zero impact on LLM behavior.

The pi built-in `bash` tool is the canonical reference: it throttles updates with a 100ms default, accumulates output before each emission, and sends an initial empty `{ content: [], details: undefined }` to mark execution start.

## What Changes

- **Phase-based status updates.** Each tool's `execute()` SHALL call `onUpdate` at well-defined phase transitions with a status string and a structured `details` payload: `{ phase, current?, total? }`.
- **Standard phase set.**
  - `starting` — immediately before spawning `ast-bro` (every tool emits this).
  - `querying` — while the `ast-bro` subprocess is in flight (emitted after `starting` for tools with augmentation, or as the sole phase for tools without). NOTE: this phase is emitted once, NOT as a recurring heartbeat during the spawn — per design.md Decision #2, between-phase updates are sufficient for now.
  - `augmenting` — after `ast-bro` closes, during snippet/measurement augmentation. `current`/`total` track progress through the batch. The final emission with `current === total` indicates completion (no separate `finalizing` phase).
- **`details` schema.** `details: { phase: string, current?: number, total?: number }` — small, structured, machine-readable for future TUI affordances even if today only `content[0].text` is rendered.
- **Throttling.** A bash-style `setTimeout`-based scheduler SHALL coalesce rapid `onUpdate` calls so the TUI is not flooded with render requests. A new persisted setting `progressUpdateThrottleMs` (default `100`, matching pi's `BASH_UPDATE_THROTTLE_MS`) controls the minimum interval between emitted updates within a single `execute()` invocation.
- **Type correction.** `_onUpdate: unknown` is replaced with `onUpdate: AgentToolUpdateCallback<TDetails> | undefined` in every tool's `execute()` signature, aligning with the SDK contract.
- **Non-interference with `ctx.ui.notify`.** Existing `ctx.ui.notify(...)` calls (e.g. in `recordSearchSavings`) SHALL remain unchanged — toast notifications and tool-progress partial results are two separate UX channels and continue to coexist.

### Capabilities

#### New Capability
- `ast-tool-progress` — the cross-cutting progress mechanism: phase enum, `details` schema, the `progressUpdateThrottleMs` setting, the throttle scheduler, and the invariant that `partialResult` SHALL NOT enter the LLM context.

#### Modified Capabilities
- `ast-context-pilot` — `analyze_ast_context` emits `starting` then `querying` phases.
- `ast-graph-pilot` — `analyze_ast_graph` emits `starting` then `querying` phases.
- `ast-navigation-tools` — `analyze_ast_trace` and `analyze_ast_surface` emit `starting` then `querying` phases.
- `ast-refactoring` — `analyze_ast_impact` and `find_implementations` emit `starting`, `querying`, then `augmenting` with `current`/`total`.
- `ast-search-summary` — `analyze_ast_search` emits `starting`, `querying`, then `augmenting` with `current`/`total` across hit-files.

## Impact

- **Code**: `src/config.ts` (new `progressUpdateThrottleMs` setting + default), `src/tui.ts` (`/ast` controls for the new setting), `src/utils.ts` (new throttle scheduler helper, probably `scheduleProgressUpdate` mirroring bash's pattern), `src/astContextPilot.ts`, `src/astGraphPilot.ts`, `src/astNavigationTools.ts`, `src/astBroTools.ts`, `src/tools.ts` (instrument each `execute()` with phase emissions; fix `_onUpdate: unknown` → `onUpdate: AgentToolUpdateCallback<...> | undefined`).
- **Behavior**: New UX affordance only — the TUI displays partial status text during multi-second tool calls. LLM context is unchanged (verifiable invariant: no `tool_execution_update` `partialResult` is inserted into the LLM message stream). Tool return shapes, error handling, and graceful degradation are unchanged.
- **Dependencies**: No new npm packages. Uses `setTimeout`/`clearTimeout` from Node built-ins (no new deps).
- **Risk**:
  - **Update flooding if throttle is misconfigured** — mitigated by the bash-style scheduler and the 100ms default that matches pi's own empirical choice.
  - **Phases classified incorrectly** — most tools only have `starting` + `querying`; only `analyze_ast_impact`/`analyze_ast_search`/`analyze_ast_map` have augmentation phases. Risk of an `augmenting` emission in a tool that doesn't actually augment — mitigated by per-tool phase set in spec deltas.
  - **User sets throttle very high** (e.g. 5000ms) on a fast tool — could suppress the lone `starting`→`querying` transition. Acceptable: the spinner still animates (Spec 1) so the tool is visibly active; only the *textual* phase is suppressed. Documented as expected behavior.
