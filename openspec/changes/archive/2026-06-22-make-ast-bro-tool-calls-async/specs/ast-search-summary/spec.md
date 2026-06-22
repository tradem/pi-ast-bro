## MODIFIED Requirements

### Requirement: `analyze_ast_search` executes asynchronously and yields the event loop
The tool SHALL run `ast-bro search` via `child_process.spawn` (not `spawnSync`), returning a Promise that resolves when the subprocess closes. The Node.js event loop SHALL yield during subprocess execution so the pi host can render progress.

#### Scenario: Search query does not freeze the TUI
- **WHEN** the agent calls `analyze_ast_search` against a repository where the search takes multiple seconds
- **THEN** the pi TUI spinner continues to animate throughout the call
- **AND** no consecutive synchronous block in `execute()` exceeds 50ms

### Requirement: `analyze_ast_search` propagates the AbortSignal to the subprocess
The tool SHALL pass the `AbortSignal` received in `execute()` to the spawned `ast-bro` process; on abort the subprocess SHALL be killed and the tool SHALL return an error result within ~1s instead of running to completion.

#### Scenario: User aborts a search query
- **WHEN** the `AbortSignal` is triggered while `ast-bro search` is running
- **THEN** the spawned process is killed
- **AND** `execute()` returns `{ content: [...], isError: true, details: { exitCode: null } }` within ~1 second

### Requirement: `analyze_ast_search` measures savings asynchronously and reads each file at most once per call
The savings measurement path (`recordSearchSavings`) SHALL use `fs.promises.stat` (not `statSync`). Within a single `execute()` invocation, each unique resolved file path SHALL be read at most once; subsequent reads in the same call SHALL use a cached buffer.

#### Scenario: Multiple hits across files
- **WHEN** `ast-bro search` returns hits referencing 12 distinct files
- **THEN** each of the 12 files is stat'd at most once during measurement for that call

### Requirement: `analyze_ast_search` caches ast-bro availability per session
The tool SHALL NOT spawn `ast-bro --version` or `which ast-bro` on every invocation. Availability SHALL be computed at most once per session and cached.

#### Scenario: Availability check runs once per session
- **WHEN** the agent calls `analyze_ast_search` multiple times in a session
- **THEN** the `ast-bro --version` and `which ast-bro` subprocesses spawn at most once across the session

### Requirement: `analyze_ast_search` recording order is preserved
Savings (`stats.addReadSavings`) SHALL be recorded AFTER the final (possibly trimmed/summarized) output is computed and BEFORE `execute()` returns. The `StatsManager` interface, `stats.json` schema, persist mechanism, and callers outside the LLM tool `execute()` paths SHALL remain unchanged by this change.

#### Scenario: Recording happens exactly once per call that yields savings
- **WHEN** `analyze_ast_search` returns successfully with hits
- **THEN** `stats.addReadSavings` is called exactly once for that call
- **AND** the call occurs after the final output is computed and before `execute()` returns
