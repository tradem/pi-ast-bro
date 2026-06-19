# ast-search-summary Specification

## Purpose
Optional compact summary output for `analyze_ast_search` that groups matches by file and line range for faster navigation.

## Requirements

### Requirement: `analyze_ast_search` supports a summary mode parameter
The existing `analyze_ast_search` tool SHALL accept an optional `mode` parameter with values `"snippets"` or `"summary"`, defaulting to `"snippets"`.

#### Scenario: Agent calls search without mode
- **WHEN** the agent calls `analyze_ast_search(query: "character_id")`
- **THEN** the tool returns raw snippets exactly as before this change

#### Scenario: Agent explicitly requests snippets
- **WHEN** the agent calls `analyze_ast_search(query: "character_id", mode: "snippets")`
- **THEN** the tool returns raw snippets exactly as before this change

#### Scenario: Agent requests summary
- **WHEN** the agent calls `analyze_ast_search(query: "character_id", mode: "summary")`
- **THEN** the tool returns a grouped result instead of raw snippets

### Requirement: Summary mode emits a compact grouped map
In summary mode, the tool SHALL parse the header lines of the `ast-bro search` output and emit a JSON object grouped by file with hit counts and line ranges.

#### Scenario: Search finds hits in multiple files
- **WHEN** `analyze_ast_search(query: "character_id", mode: "summary")` returns results from three files
- **THEN** the output contains `total_hits`, `files`, and for each file a `hit_count` and ordered list of `ranges` such as `["42-55", "160-190"]`

#### Scenario: Search finds multiple hits in the same file
- **WHEN** `ast-bro search` returns three hits inside the same file
- **THEN** the grouped entry for that file has `hit_count: 3` and three line ranges

### Requirement: Summary mode falls back to raw output on parse failure
If the tool cannot parse the `ast-bro search` headers, it SHALL return the raw stdout rather than failing silently.

#### Scenario: Unexpected output format
- **WHEN** `ast-bro search` returns output that does not match the expected header pattern
- **THEN** the tool returns the original stdout and `isError: false` when the exit code is 0

### Requirement: Summary mode preserves error handling
In summary mode, the tool SHALL still report `isError: true` when `ast-bro search` exits with a non-zero status.

#### Scenario: ast-bro search fails
- **WHEN** `ast-bro search` exits with status non-zero in summary mode
- **THEN** the tool returns the stderr or stdout text and `isError: true`
