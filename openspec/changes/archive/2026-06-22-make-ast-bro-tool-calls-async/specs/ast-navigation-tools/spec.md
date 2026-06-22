## MODIFIED Requirements

### Requirement: Navigation tools execute asynchronously and yield the event loop
Both `analyze_ast_trace` and `analyze_ast_surface` SHALL run `ast-bro` via `child_process.spawn` (not `spawnSync`), returning a Promise that resolves when the subprocess closes. The Node.js event loop SHALL yield during subprocess execution so the pi host can render progress.

#### Scenario: Trace query does not freeze the TUI
- **WHEN** the agent calls `analyze_ast_trace` against a repository where the BFS search takes multiple seconds
- **THEN** the pi TUI spinner continues to animate throughout the call
- **AND** no consecutive synchronous block in `execute()` exceeds 50ms

### Requirement: Navigation tools propagate the AbortSignal to the subprocess
Both tools SHALL pass the `AbortSignal` received in `execute()` to the spawned `ast-bro` process; on abort the subprocess SHALL be killed and the tool SHALL return an error result within ~1s instead of running to completion.

#### Scenario: User aborts a trace query
- **WHEN** the `AbortSignal` is triggered while `ast-bro trace` is running
- **THEN** the spawned process is killed
- **AND** `execute()` returns `{ content: [...], isError: true, details: { exitCode: null } }` within ~1 second

### Requirement: Navigation tools cache ast-bro availability per session
Both tools SHALL NOT spawn `ast-bro --version` or `which ast-bro` on every invocation. Availability SHALL be computed at most once per session and cached.

#### Scenario: Availability check runs once per session
- **WHEN** the agent calls `analyze_ast_trace` or `analyze_ast_surface` multiple times in a session
- **THEN** the `ast-bro --version` and `which ast-bro` subprocesses spawn at most once across the session
