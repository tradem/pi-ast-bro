# ast-navigation-tools Specification

## Purpose
TBD

## Requirements

### Requirement: analyze_ast_trace tool
The extension SHALL register `analyze_ast_trace`, wrapping `ast-bro trace <FROM> <TO>`, returning the shortest static call path between two symbols, bounded by an output budget.

#### Scenario: Agent traces a call path
- **WHEN** the agent calls `analyze_ast_trace` with two valid symbols
- **THEN** the tool runs `ast-bro trace` and returns the shortest call path, trimmed to the configured budget when oversized

#### Scenario: No path exists
- **WHEN** `ast-bro trace` finds no path between the symbols
- **THEN** the tool returns the no-path fallback without error

### Requirement: analyze_ast_surface tool
The extension SHALL register `analyze_ast_surface`, wrapping `ast-bro surface <dir>`, returning the package's actually-published API.

#### Scenario: Agent inspects the published API
- **WHEN** the agent calls `analyze_ast_surface` on a directory
- **THEN** the tool runs `ast-bro surface` and returns the resolved public API

### Requirement: Navigation tools validate inputs and degrade gracefully
Both tools SHALL validate symbol/path inputs (rejecting unsafe values) and fall back without crashing when `ast-bro` is unavailable or errors.

#### Scenario: ast-bro unavailable
- **WHEN** `ast-bro` is missing or errors for a navigation tool
- **THEN** the tool returns an error result and does not crash the agent

### Requirement: Redundant and unsafe commands are deliberately not wrapped
The extension SHALL NOT register tools for `callers`/`callees` (covered by `analyze_ast_impact`), `show` (covered by `analyze_ast_context`/`analyze_ast_map`), `deps`/`reverse-deps` (covered coarsely by `analyze_ast_graph`), or `run` (mutates files and bypasses pre-flight). The rationale SHALL be documented.

#### Scenario: Reviewer checks why a command is missing
- **WHEN** a contributor looks for a `callers` or `run` tool
- **THEN** the documentation explains the exclusion (tool-confusion/coverage for `callers`, mutation/security risk for `run`)
