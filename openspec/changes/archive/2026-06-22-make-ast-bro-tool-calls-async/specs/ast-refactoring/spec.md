## MODIFIED Requirements

### Requirement: `analyze_ast_impact` and `find_implementations` execute asynchronously and yield the event loop
Both tools SHALL run `ast-bro impact`/`ast-bro implements` via `child_process.spawn` (not `spawnSync`), returning a Promise that resolves when the subprocess closes. The Node.js event loop SHALL yield during subprocess execution so the pi host can render progress.

#### Scenario: Impact query on a heavily used symbol does not freeze the TUI
- **WHEN** the agent calls `analyze_ast_impact` against a symbol with many callers
- **THEN** the pi TUI spinner continues to animate throughout the call
- **AND** no consecutive synchronous block in `execute()` exceeds 50ms

### Requirement: `analyze_ast_impact` and `find_implementations` propagate the AbortSignal to the subprocess
Both tools SHALL pass the `AbortSignal` received in `execute()` to the spawned `ast-bro` process; on abort the subprocess SHALL be killed and the tool SHALL return an error result within ~1s instead of running to completion.

#### Scenario: User aborts an impact query
- **WHEN** the `AbortSignal` is triggered while `ast-bro impact` is running
- **THEN** the spawned process is killed
- **AND** `execute()` returns `{ content: [...], isError: true, details: { exitCode: null } }` within ~1 second

### Requirement: Exact Source Excerpts are read asynchronously and at most once per file per call
The snippet augmentation (`injectSnippet` and its callers) SHALL read matches' files via `fs.promises.readFile` (not `readFileSync`). Within a single `execute()` invocation, each unique resolved file path SHALL be read at most once; subsequent reads in the same call SHALL use a cached buffer.

#### Scenario: Multiple matches in the same file
- **WHEN** `ast-bro impact --json` returns 10 matches all inside `src/lib.rs`
- **THEN** the file is read at most once during augmentation
- **AND** all 10 matches' `exact_snippet` values are derived from that single read

#### Scenario: File is mutated mid-call
- **WHEN** another tool edits `src/lib.rs` between the `ast-bro impact` subprocess closing and the augmentation loop reading it
- **THEN** the augmentation reads the current contents once and uses that single buffer for all snippets and any savings measurement, never reading a second time

### Requirement: Gamification Stats recording order is preserved
Savings (`stats.addReadSavings`) SHALL be recorded AFTER the final augmented output is computed and BEFORE `execute()` returns. The `StatsManager` interface, `stats.json` schema, persist mechanism, and callers outside the LLM tool `execute()` paths SHALL remain unchanged by this change.

#### Scenario: Recording happens exactly once per call that yields savings
- **WHEN** `analyze_ast_impact` returns successfully
- **THEN** `stats.addReadSavings` is called exactly once for that call
- **AND** the call occurs after the augmented payload is serialized and before `execute()` returns

### Requirement: Both tools cache ast-bro availability per session
Both tools SHALL NOT spawn `ast-bro --version` or `which ast-bro` on every invocation. Availability SHALL be computed at most once per session and cached.

#### Scenario: Availability check runs once per session
- **WHEN** the agent calls `analyze_ast_impact` or `find_implementations` multiple times in a session
- **THEN** the `ast-bro --version` and `which ast-bro` subprocesses spawn at most once across the session
