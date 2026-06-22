## MODIFIED Requirements

### Requirement: `analyze_ast_context` emits `starting` and `querying` progress phases
The tool SHALL call `onUpdate` with `{ content: [{ type: "text", text: "starting ast-bro context…" }], details: { phase: "starting" } }` immediately before invoking `ast-bro` and `{ content: [{ type: "text", text: "querying ast-bro context…" }], details: { phase: "querying" } }` once the subprocess is in flight. It SHALL NOT emit an `augmenting` phase.

#### Scenario: User sees phase transitions during a slow context query
- **WHEN** the agent calls `analyze_ast_context` against a slow repository
- **THEN** the TUI shows "starting ast-bro context…" then "querying ast-bro context…" (replacing the prior text)
- **AND** no `augmenting` emission occurs

#### Scenario: flush() delivers final phase before return
- **WHEN** the `querying` phase is emitted within the throttle window of `execute()` returning
- **THEN** `flush()` forces the `querying` payload to reach the TUI before the tool returns
