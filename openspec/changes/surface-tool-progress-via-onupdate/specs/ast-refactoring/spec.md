## MODIFIED Requirements

### Requirement: `analyze_ast_impact` and `find_implementations` emit `starting`, `querying`, and `augmenting` progress phases
Both tools SHALL call `onUpdate` with a `starting` phase payload before invoking `ast-bro`, a `querying` phase payload once the subprocess is in flight, and one or more `augmenting` phase payloads after the subprocess closes (carrying `current`/`total` to track augmentation progress through the match array). The final `augmenting` emission SHALL carry `current === total`.

#### Scenario: User sees all three phases during a multi-result impact query
- **WHEN** the agent calls `analyze_ast_impact` against a symbol with 12 callers
- **THEN** the TUI successively shows "starting ast-bro impact…", then "querying ast-bro impact…", then at least one "augmenting snippet N/12…" text (replacing the prior on each update)
- **AND** the last `augmenting` emission before `execute()` returns carries `{ current: 12, total: 12 }`

#### Scenario: Single-match query still emits augmenting
- **WHEN** `analyze_ast_impact` returns 1 match
- **THEN** the tool emits `starting`, `querying`, then exactly one `augmenting` payload with `{ current: 1, total: 1 }`
- **AND** `flush()` ensures this final payload is delivered

### Requirement: Throttle coalesces rapid augmenting emissions without losing the final phase
Both tools SHALL use the `progressUpdateThrottleMs` scheduler (default 100ms); intermediate `augmenting` payloads emitted faster than the throttle window SHALL be coalesced, with only the latest held payload emitted on timer fire. The `flush()` call before `execute()` returns SHALL ensure the final `current === total` payload is always delivered.

#### Scenario: 50 rapid augmenting emissions with default throttle
- **WHEN** `analyze_ast_impact` augments 50 matches rapidly and the test mocks `progressUpdateThrottleMs=1000`
- **THEN** most intermediate `augmenting` emissions are coalesced
- **AND** `flush()` delivers a final payload with `current === 50` before the tool returns
