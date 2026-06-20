# ast-session-seed Specification

## Purpose
TBD

## Requirements

### Requirement: Session seed is opt-in and default-off
On `session_start`, the extension MAY inject an `ast-bro digest` repo map, but ONLY when the `enableSessionSeed` setting is explicitly enabled. The default SHALL be off so the token-frugality promise stays unconditional.

#### Scenario: Default session has no seed
- **WHEN** a session starts and `enableSessionSeed` is at its default
- **THEN** no digest is injected into the context

#### Scenario: User enables the seed
- **WHEN** `enableSessionSeed` is on and a session starts
- **THEN** the extension injects an `ast-bro digest` repo map into the session context

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

### Requirement: Session seed tracks its own ROI
The extension SHALL record the seed's token/byte cost and attribute later avoided reads in the same session, surfacing a cost-vs-savings ROI in `/ast-gain`.

#### Scenario: Seed cost and savings are recorded
- **WHEN** a seeded session injects a digest and later avoids whole-file reads
- **THEN** `/ast-gain` shows the seed's injection cost and the attributed savings so the net ROI is visible

### Requirement: Session seed degrades gracefully
If `ast-bro digest` is unavailable or errors, the session SHALL start normally with no seed and no crash.

#### Scenario: Digest fails at session start
- **WHEN** the seed is enabled but `ast-bro digest` errors or is missing
- **THEN** the session starts without a seed and the failure is logged, not raised
