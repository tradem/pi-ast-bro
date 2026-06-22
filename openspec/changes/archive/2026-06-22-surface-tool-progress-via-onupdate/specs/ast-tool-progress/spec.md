## ADDED Requirements

### Requirement: Tools emit phase-based progress via `onUpdate`
Every tool that runs `ast-bro` via `child_process.spawn` SHALL call the `onUpdate` callback received in `execute()` at well-defined phase transitions, passing a payload of the form `{ content: [{ type: "text", text: <human-readable status> }], details: { phase, current?, total? } }`.

#### Scenario: User observes phase during a long tool call
- **WHEN** the agent calls `analyze_ast_impact` and the call takes multiple seconds
- **THEN** the pi TUI tool rendering shows at least the phases "starting" then "querying" then "augmenting" as text during the call
- **AND** the displayed text is replaced (not appended) on each update

### Requirement: Standard phase set
The extension SHALL use a standard phase enum: `"starting"` (emitted before invoking `ast-bro`), `"querying"` (emitted once the subprocess is in flight; the latest phase for tools without augmentation), and `"augmenting"` (emitted by tools that augment or measure post-subprocess, with `current`/`total` tracking progress). The final `augmenting` emission SHALL carry `current === total` as the augmentation-completion marker — there is no separate "finalizing" phase.

#### Scenario: Augmenting tool signals completion via current===total
- **WHEN** `analyze_ast_impact` has finished augmenting all matches
- **THEN** the last `onUpdate` call before `execute()` returns carries `{ phase: "augmenting", current: N, total: N }` for some N > 0

#### Scenario: Non-augmenting tool emits only starting and querying
- **WHEN** `analyze_ast_context` runs to completion
- **THEN** the emitted phases are exactly `["starting", "querying"]` in that order
- **AND** no `"augmenting"` emission occurs

### Requirement: `progressUpdateThrottleMs` setting
The extension SHALL expose `progressUpdateThrottleMs` (number, minimum 0, default 100) as a persisted setting surfaced in the `/ast` dashboard. The throttle coalesces rapid `onUpdate` calls within the same `execute()` invocation: if the time since the last emitted update is less than `progressUpdateThrottleMs`, the latest payload is held and emitted via a `setTimeout`; otherwise it is emitted immediately.

#### Scenario: Default throttle matches pi's bash tool
- **WHEN** the setting has not been customized
- **THEN** the effective throttle is 100ms

#### Scenario: User tunes the throttle
- **WHEN** the user sets `progressUpdateThrottleMs` to 0 in `/ast`
- **THEN** no throttling occurs and every phase emission reaches the TUI immediately

#### Scenario: Fast tool run with default throttle
- **WHEN** all phases of a fast tool execute within 100ms
- **THEN** the throttle suppresses intermediate phases and only the final held payload is emitted (or none beyond `flush()`)
- **AND** no exception is raised

### Requirement: Throttle is flushed before `execute()` returns
Each `execute()` invocation SHALL call `flush()` on its progress throttle immediately before returning, so that the last emitted phase label is not suppressed by the throttle window.

#### Scenario: Final phase is always delivered
- **WHEN** the last phase emission occurs less than `progressUpdateThrottleMs` before `execute()` returns
- **THEN** `flush()` forces the held payload to be emitted
- **AND** the TUI shows the final phase label

### Requirement: `onUpdate` parameter is correctly typed
The `execute()` signature of every instrumented tool SHALL declare `onUpdate: AgentToolUpdateCallback<TDetails> | undefined` (matching the SDK contract), not `unknown` or `_onUpdate`.

#### Scenario: TypeScript typecheck passes
- **WHEN** `tsc --noEmit` is run
- **THEN** no type errors arise from the `onUpdate` parameter in any tool's `execute()` signature

### Requirement: `partialResult` SHALL NOT enter the LLM context
The `onUpdate` payload (a "partial result") SHALL NOT be inserted into the LLM context message stream. Only the final value returned from `execute()` is inserted into the tool_result message that the LLM sees. This is an invariant property of pi's runner design.

#### Scenario: LLM does not see intermediate phase text
- **WHEN** a tool emits `"augmenting snippet 3/12…"` via `onUpdate` mid-call
- **THEN** the LLM message history does not contain that text
- **AND** the LLM only receives the final `execute()` return value when the tool completes

### Requirement: `ctx.ui.notify` remains a separate channel
Toast notifications emitted via `ctx.ui.notify(...)` SHALL continue to function unchanged alongside `onUpdate` progress emissions. The two channels are independent; one SHALL NOT replace or block the other.

#### Scenario: Search savings toast still fires
- **WHEN** `analyze_ast_search` runs and yields savings
- **THEN** `ctx.ui.notify("ast-bro search: saved ~… of context", "info")` is still called exactly as before this change
- **AND** the `onUpdate` phase emissions are also delivered
