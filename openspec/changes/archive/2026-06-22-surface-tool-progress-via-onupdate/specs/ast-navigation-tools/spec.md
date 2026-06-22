## MODIFIED Requirements

### Requirement: Navigation tools emit `starting` and `querying` progress phases
Both `analyze_ast_trace` and `analyze_ast_surface` SHALL call `onUpdate` with a `starting` phase payload before invoking `ast-bro` and a `querying` phase payload once the subprocess is in flight. Neither tool SHALL emit an `augmenting` phase.

#### Scenario: User sees phase transitions during a slow trace
- **WHEN** the agent calls `analyze_ast_trace` and the BFS search takes multiple seconds
- **THEN** the TUI shows "starting ast-bro trace…" then "querying ast-bro trace…" (replacing the prior text)
- **AND** no `augmenting` emission occurs

#### Scenario: User sees phase transitions during surface
- **WHEN** the agent calls `analyze_ast_surface` on a large directory
- **THEN** the TUI shows "starting ast-bro surface…" then "querying ast-bro surface…" (replacing the prior text)
- **AND** no `augmenting` emission occurs
