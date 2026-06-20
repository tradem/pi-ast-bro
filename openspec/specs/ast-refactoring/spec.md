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
