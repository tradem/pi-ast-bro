## MODIFIED Requirements

### Requirement: `analyze_ast_search` emits `starting`, `querying`, and `augmenting` progress phases
The tool SHALL call `onUpdate` with a `starting` phase payload before invoking `ast-bro search`, a `querying` phase payload once the subprocess is in flight, and one or more `augmenting` phase payloads after the subprocess closes (carrying `current`/`total` to track progress through the distinct hit-files processed in savings measurement). The final `augmenting` emission SHALL carry `current === total`.

#### Scenario: User sees all three phases during a multi-result search
- **WHEN** the agent calls `analyze_ast_search` and the result references 12 distinct hit-files
- **THEN** the TUI successively shows "starting ast-bro search…", then "querying ast-bro search…", then at least one "augmenting N/12…" text (replacing the prior on each update)
- **AND** the last `augmenting` emission carries `{ current: 12, total: 12 }`

### Requirement: Throttle coalesces rapid augmenting emissions without losing the final phase
The tool SHALL use the `progressUpdateThrottleMs` scheduler (default 100ms); intermediate `augmenting` payloads emitted faster than the throttle window SHALL be coalesced. The `flush()` call before `execute()` returns SHALL ensure the final `current === total` payload is always delivered.

#### Scenario: Many rapid augmenting emissions with default throttle
- **WHEN** `analyze_ast_search` references 30 distinct hit-files and the test mocks `progressUpdateThrottleMs=1000`
- **THEN** intermediate `augmenting` emissions are coalesced
- **AND** `flush()` delivers a final payload with `current === 30` before the tool returns

### Requirement: `ctx.ui.notify` coexists with `onUpdate` progress
The existing `ctx.ui.notify("ast-bro search: saved ~… of context", "info")` call in savings measurement SHALL continue to fire unchanged. `onUpdate` phase emissions are a separate channel and do not replace it.

#### Scenario: Search yields both a toast and progress updates
- **WHEN** `analyze_ast_search` returns successfully with savings
- **THEN** `ctx.ui.notify` is called exactly once with the savings summary
- **AND** at least one `onUpdate` payload with `phase: "augmenting"` is emitted
