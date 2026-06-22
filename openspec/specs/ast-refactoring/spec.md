# ast-refactoring Specification

## Purpose
Expose ast-bro impact and implementation queries as Pi tools that return exact-match source snippets, enabling safe, whitespace-accurate cross-file refactoring workflows.

## Requirements

### Requirement: Tool Registration
The extension SHALL register two new AI tools with the pi-coding-agent: `analyze_ast_impact` and `find_implementations`.

#### Scenario: Agent requests cross-file impact of a symbol
- **WHEN** the agent executes `analyze_ast_impact` with a valid symbol
- **THEN** the tool runs `ast-bro impact` and returns an exact JSON payload of callers & tests.

### Requirement: Exact Source Excerpts
Both tools SHALL inject a new `exact_snippet` property into the JSON array nodes representing matches.

#### Scenario: Tool fetching source lines for edit safety
- **WHEN** the CLI returns a match at line 42
- **THEN** the Node wrapper reads the target file, extracts line 42 (along with N context lines), and populates the `exact_snippet` string in the response.

### Requirement: Result Limit Fail-over
If a query yields more than 50 callers/implementations, the system SHALL truncate the results and insert an `attention_required` flag into the JSON.

#### Scenario: Querying heavily used framework core
- **WHEN** a symbol returns 300 callers
- **THEN** the output JSON terminates after 50 elements and includes the message `"attention_required": "Truncated. 250 additional elements omitted."`

### Requirement: Refactoring Skill Exposure
A new `ast-bro-refactor` markdown skill SHALL be exposed to the agent.

#### Scenario: Providing workflows silently
- **WHEN** the pi agent initializes
- **THEN** the extension answers the `resources_discover` hook with the path to the bundled SKILL.md.

### Requirement: Gamification Stats
The execution wrapper SHALL measure token/byte savings and report them to the agent UI context.

#### Scenario: Calculating saved bytes
- **WHEN** returning a 2KB JSON for 5 files that sum to 100KB
- **THEN** the tool calculates and reports 98KB in estimated context savings.

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
