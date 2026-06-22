## MODIFIED Requirements

### Requirement: Session seed degrades gracefully
If `ast-bro digest` is unavailable or errors, the session SHALL start normally with no seed and no crash.

The `generateSessionSeed` function SHALL use an async `runAstBroDigestAsync` wrapper that calls `runAstBroAsync(["digest", ...])` instead of the synchronous `spawnSync` variant, so the `session_start` handler does not block the Node.js event loop during digest computation.

#### Scenario: Digest fails at session start
- **WHEN** the seed is enabled but `ast-bro digest` errors or is missing
- **THEN** the session starts without a seed and the failure is logged, not raised

#### Scenario: Digest runs without blocking the event loop
- **WHEN** `enableSessionSeed` is on and a session starts
- **THEN** `generateSessionSeed` calls `runAstBroDigestAsync` which uses async `spawn` (not `spawnSync`)
- **AND** the `session_start` handler `await`s the result, releasing the event loop during digest computation
- **AND** other concurrent session-start work (TUI init, other plugins) is not delayed

### Requirement: Session seed is budget-limited
When enabled, the injected digest SHALL be bounded by a configurable `sessionSeedBudget`; if the digest exceeds the budget it SHALL be trimmed and annotated as partial.

#### Scenario: Digest exceeds the budget
- **WHEN** the seed is enabled and `ast-bro digest` output exceeds `sessionSeedBudget`
- **THEN** the injected content is trimmed to the budget and annotated as a partial map (e.g. "seeded partial map: N of M files")

### Requirement: Session seed is scope-limited
The seed SHALL honor a `sessionSeedScope` setting (e.g. `cwd` vs. `root`) so that large monorepos can seed only the current working directory rather than the whole repository.

#### Scenario: Monorepo seeds only cwd
- **WHEN** `sessionSeedScope` is `cwd` in a large monorepo
- **THEN** the digest covers only the current working directory, not the entire repo root