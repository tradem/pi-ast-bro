## MODIFIED Requirements

### Requirement: Optional import-cycle pre-flight after edits
The extension SHALL optionally run `ast-bro cycles` as part of the post-edit pre-flight, governed by an `enableCyclePreflight` setting (default off), surfacing newly detected import cycles similar to the syntax pre-flight gate.

The cycle check SHALL use an async wrapper (`runAstBroCyclesAsync`) that calls `runAstBroAsync(["cycles", ...])` instead of the synchronous `spawnSync` variant, so the `tool_result` handler does not block the event loop during cycle detection.

#### Scenario: Edit introduces an import cycle
- **WHEN** `enableCyclePreflight` is on and an `edit`/`write` introduces a new import cycle detected by `ast-bro cycles`
- **THEN** the extension annotates the tool result to flag the cycle
- **AND** the cycle check does not block other `tool_result` handlers from processing

#### Scenario: Cycle pre-flight disabled
- **WHEN** `enableCyclePreflight` is off
- **THEN** no cycle check runs after edits

#### Scenario: Cycle pre-flight runs asynchronously
- **WHEN** `enableCyclePreflight` is on and an edit completes
- **THEN** the `tool_result` handler calls `runAstBroCyclesAsync` (async `spawn`, not `spawnSync`)
- **AND** the handler `await`s the result, releasing the event loop during the check
- **AND** the edit result annotation (if any) is attached after the await

### Requirement: Cycle pre-flight degrades gracefully
The cycle check SHALL be best-effort and MUST NOT crash the agent or block the edit result when `ast-bro cycles` errors or is unavailable.

#### Scenario: Cycle check fails
- **WHEN** `ast-bro cycles` errors or is missing
- **THEN** the edit result is returned unchanged and the failure is logged, not raised