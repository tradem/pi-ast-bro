## MODIFIED Requirements

### Requirement: Tools emit phase-based progress via `onUpdate`
Every tool that runs `ast-bro` via `child_process.spawn` SHALL call the `onUpdate` callback received in `execute()` at well-defined phase transitions, passing a payload of the form `{ content: [{ type: "text", text: <human-readable status> }], details: { phase, current?, total? } }`.

Every tool `execute()` function SHALL wrap its body in `try { ... } catch (err) { ... } finally { throttle.flush() }`. The `catch` block SHALL:
1. Call `throttle.flush()` to deliver the last held progress payload
2. Return `{ content: [{ type: "text", text: "Internal error: <message>" }], isError: true, details: { exitCode: null } }`
3. NOT re-throw or reject the Promise

#### Scenario: User observes phase during a long tool call
- **WHEN** the agent calls `analyze_ast_impact` and the call takes multiple seconds
- **THEN** the pi TUI tool rendering shows at least the phases "starting" then "querying" then "augmenting" as text during the call
- **AND** the displayed text is replaced (not appended) on each update

#### Scenario: Unexpected exception during tool execution
- **WHEN** an unexpected exception is thrown inside the `try` block of any tool's `execute()` function
- **THEN** the `catch` block catches the exception, calls `throttle.flush()`, and returns `{ isError: true, content: [{ text: "Internal error: ..." }] }`
- **AND** the Promise does not reject
- **AND** the LLM sees a clear error message instead of no output

### Requirement: Standard phase set
The extension SHALL use a standard phase enum: `"starting"` (emitted before invoking `ast-bro`), `"querying"` (emitted once the subprocess is in flight; the latest phase for tools without augmentation), and `"augmenting"` (emitted by tools that augment or measure post-subprocess, with `current`/`total` tracking progress). The final `augmenting` emission SHALL carry `current === total` as the augmentation-completion marker — there is no separate "finalizing" phase.

#### Scenario: Augmenting tool signals completion via current===total
- **WHEN** `analyze_ast_impact` has finished augmenting all matches
- **THEN** the last `onUpdate` call before `execute()` returns carries `{ phase: "augmenting", current: N, total: N }` for some N > 0

#### Scenario: Non-augmenting tool emits only starting and querying
- **WHEN** `analyze_ast_context` runs to completion
- **THEN** the emitted phases are exactly `["starting", "querying"]` in that order
- **AND** no `"augmenting"` emission occurs

### Requirement: Throttle is flushed before `execute()` returns
Each `execute()` invocation SHALL call `flush()` on its progress throttle immediately before returning, both in the success path (`finally` block) and in the error path (`catch` block). This ensures the last emitted phase label is not suppressed by the throttle window.

#### Scenario: Final phase is always delivered in success
- **WHEN** the last phase emission occurs less than `progressUpdateThrottleMs` before `execute()` returns
- **THEN** `flush()` forces the held payload to be emitted
- **AND** the TUI shows the final phase label

#### Scenario: Final phase is delivered even on error
- **WHEN** an exception occurs after the last progress emission but before `execute()` returns
- **THEN** the `catch` block calls `throttle.flush()` before returning the error result
- **AND** the TUI shows the last held phase label