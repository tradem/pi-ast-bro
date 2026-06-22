## MODIFIED Requirements

### Requirement: `analyze_ast_graph` executes asynchronously and yields the event loop
The tool's `execute()` SHALL run `ast-bro graph` via `child_process.spawn` (not `spawnSync`), returning a Promise that resolves when the subprocess closes. The Node.js event loop SHALL yield during subprocess execution so the pi host can render progress.

#### Scenario: Large graph query does not freeze the TUI
- **WHEN** the agent calls `analyze_ast_graph` against a crate where `ast-bro graph` takes multiple seconds
- **THEN** the pi TUI spinner continues to animate throughout the call
- **AND** no consecutive synchronous block in `execute()` exceeds 50ms

### Requirement: `analyze_ast_graph` propagates the AbortSignal to the subprocess
The tool SHALL pass the `AbortSignal` received in `execute()` to the spawned `ast-bro` process; on abort the subprocess SHALL be killed and the tool SHALL return an error result within ~1s instead of running to completion.

#### Scenario: User aborts a graph query
- **WHEN** the `AbortSignal` is triggered while `ast-bro graph` is running
- **THEN** the spawned process is killed
- **AND** `execute()` returns `{ content: [...], isError: true, details: { exitCode: null } }` within ~1 second

### Requirement: `analyze_ast_graph` caches ast-bro availability per session
The tool SHALL NOT spawn `ast-bro --version` or `which ast-bro` on every invocation. Availability SHALL be computed at most once per session and cached.

#### Scenario: Availability check runs once per session
- **WHEN** the agent calls `analyze_ast_graph` multiple times in a session
- **THEN** the `ast-bro --version` and `which ast-bro` subprocesses spawn at most once across the session
