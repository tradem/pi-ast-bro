## MODIFIED Requirements

### Requirement: `analyze_ast_graph` emits `starting` and `querying` progress phases
The tool SHALL call `onUpdate` with `{ content: [{ type: "text", text: "starting ast-bro graph…" }], details: { phase: "starting" } }` immediately before invoking `ast-bro` and `{ content: [{ type: "text", text: "querying ast-bro graph…" }], details: { phase: "querying" } }` once the subprocess is in flight. It SHALL NOT emit an `augmenting` phase.

#### Scenario: User sees phase transitions during a slow graph query
- **WHEN** the agent calls `analyze_ast_graph` against a large crate
- **THEN** the TUI shows "starting ast-bro graph…" then "querying ast-bro graph…" (replacing the prior text)
- **AND** no `augmenting` emission occurs
