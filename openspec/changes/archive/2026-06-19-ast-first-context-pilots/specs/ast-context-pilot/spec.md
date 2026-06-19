## ADDED Requirements

### Requirement: Extension registers an `analyze_ast_context` tool
The extension SHALL register a new LLM-facing tool named `analyze_ast_context` that wraps the `ast-bro context` command.

#### Scenario: Agent lists available tools
- **WHEN** the pi agent requests the tool catalog
- **THEN** `analyze_ast_context` appears with a description that states it is the preferred first tool for understanding a symbol or file

### Requirement: `analyze_ast_context` accepts path, target, and budget parameters
The tool SHALL accept a required `path` parameter, an optional `target` symbol parameter, and an optional `budget` parameter.

#### Scenario: Agent requests context for a symbol
- **WHEN** the agent calls `analyze_ast_context` with `path: "backend/crates/core"` and `target: "CostumeAggregate"`
- **THEN** the tool invokes `ast-bro context --json --compact --budget <budget> CostumeAggregate backend/crates/core`

#### Scenario: Agent requests context for a file without a target
- **WHEN** the agent calls `analyze_ast_context` with `path: "src/costume/aggregate.rs"` and no `target`
- **THEN** the tool invokes `ast-bro context --json --compact --budget <budget> src/costume/aggregate.rs`

### Requirement: `analyze_ast_context` uses a configurable default budget
The tool SHALL use the `contextDefaultBudget` setting as the default `budget` value when the agent does not provide one, while still allowing a per-call override.

#### Scenario: Agent omits budget
- **WHEN** the agent calls `analyze_ast_context` without a `budget` parameter
- **THEN** the tool invokes `ast-bro context` with the budget equal to the `contextDefaultBudget` setting

#### Scenario: Agent overrides budget
- **WHEN** the agent calls `analyze_ast_context` with `budget: 8000`
- **THEN** the tool invokes `ast-bro context` with `--budget 8000` regardless of the `contextDefaultBudget` setting

### Requirement: `analyze_ast_context` returns compact JSON output
The tool SHALL return the JSON produced by `ast-bro context`, including the token usage report, and mark the result as an error if `ast-bro` exits non-zero.

#### Scenario: Context command succeeds
- **WHEN** `ast-bro context` exits with status 0
- **THEN** the tool returns the stdout JSON and `isError: false`

#### Scenario: Context command fails
- **WHEN** `ast-bro context` exits with status non-zero
- **THEN** the tool returns the stderr or stdout text and `isError: true`

### Requirement: `analyze_ast_context` validates arguments before spawning
The tool SHALL reject unsafe or empty `path` or `target` values and fall back to a clean error response.

#### Scenario: Path contains shell metacharacters
- **WHEN** the agent passes a `path` containing `;` or `|`
- **THEN** the tool returns a validation error without invoking `ast-bro`

#### Scenario: ast-bro binary is missing
- **WHEN** `ast-bro` is not on PATH
- **THEN** the tool returns an informative error and does not crash the extension
