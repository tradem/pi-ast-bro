# ast-graph-pilot Specification

## Purpose
Compact file/module dependency graph retrieval for architecture and coupling questions.

## Requirements

### Requirement: Extension registers an `analyze_ast_graph` tool
The extension SHALL register a new LLM-facing tool named `analyze_ast_graph` that wraps the `ast-bro graph` command.

#### Scenario: Agent lists available tools
- **WHEN** the pi agent requests the tool catalog
- **THEN** `analyze_ast_graph` appears with a description that states it returns a compact file/module dependency graph for architecture questions

### Requirement: `analyze_ast_graph` accepts a path parameter
The tool SHALL accept an optional `path` parameter defaulting to the current working directory.

#### Scenario: Agent requests a graph for a crate
- **WHEN** the agent calls `analyze_ast_graph` with `path: "backend/crates/core"`
- **THEN** the tool invokes `ast-bro graph --json --compact --hide-external backend/crates/core`

#### Scenario: Agent omits the path
- **WHEN** the agent calls `analyze_ast_graph` with no `path`
- **THEN** the tool invokes `ast-bro graph --json --compact --hide-external` against the agent's current working directory

### Requirement: `analyze_ast_graph` returns a compact dependency graph
The tool SHALL return the JSON produced by `ast-bro graph` and mark the result as an error if `ast-bro` exits non-zero.

#### Scenario: Graph command succeeds
- **WHEN** `ast-bro graph` exits with status 0
- **THEN** the tool returns the stdout JSON and `isError: false`

#### Scenario: Graph command fails
- **WHEN** `ast-bro graph` exits with status non-zero
- **THEN** the tool returns the stderr or stdout text and `isError: true`

### Requirement: `analyze_ast_graph` truncates output to a configurable maximum
The tool SHALL respect the `graphMaxEdges` setting; if the graph JSON contains more edges, the tool SHALL truncate the edge list and annotate the result with `truncated` and `total_edges`.

#### Scenario: Graph exceeds configured edge limit
- **WHEN** `ast-bro graph` returns 1200 edges and `graphMaxEdges` is set to 500
- **THEN** the tool returns only the first 500 edges, sets `truncated: true`, and includes `total_edges: 1200`

#### Scenario: Graph is within configured edge limit
- **WHEN** `ast-bro graph` returns 250 edges and `graphMaxEdges` is set to 500
- **THEN** the tool returns all 250 edges and sets `truncated: false`

### Requirement: `analyze_ast_graph` validates the path before spawning
The tool SHALL reject unsafe paths and fall back to a clean error response.

#### Scenario: Path contains shell metacharacters
- **WHEN** the agent passes a `path` containing `;` or `|`
- **THEN** the tool returns a validation error without invoking `ast-bro`

#### Scenario: ast-bro binary is missing
- **WHEN** `ast-bro` is not on PATH
- **THEN** the tool returns an informative error and does not crash the extension

### Requirement: `analyze_ast_graph` emits `starting` and `querying` progress phases
The tool SHALL call `onUpdate` with `{ content: [{ type: "text", text: "starting ast-bro graph…" }], details: { phase: "starting" } }` immediately before invoking `ast-bro` and `{ content: [{ type: "text", text: "querying ast-bro graph…" }], details: { phase: "querying" } }` once the subprocess is in flight. It SHALL NOT emit an `augmenting` phase.

#### Scenario: User sees phase transitions during a slow graph query
- **WHEN** the agent calls `analyze_ast_graph` against a large crate
- **THEN** the TUI shows "starting ast-bro graph…" then "querying ast-bro graph…" (replacing the prior text)
- **AND** no `augmenting` emission occurs
