## Context

The `pi-ast-bro` extension currently only maintains in-memory session statistics (`SessionStats`), which reset on restart. To showcase the long-term value (token savings, prevented syntax errors), we need a persistent statistics manager and an `/ast-gain` TUI dashboard. 
Given the strict security requirements of the project (running within an AI agent harness), ensuring file path safety, preventing JSON injection/prototype pollution, mitigating I/O race conditions, and correctly handling CLI lifecycle exits are the primary drivers of this technical design.

## Goals / Non-Goals

**Goals:**
- Persistently track `totalBytesSaved`, `totalReadsIntercepted`, and `totalPreFlightErrorsCaught`.
- Maintain a rolling log of recent interception events.
- Implement a robust `StatsManager` that guarantees strict validation of on-disk data.
- Ensure file system I/O doesn't block agent execution, but guarantees data is saved upon process exit.
- Support parallel CLI executions via "Delta-Updates" rather than absolute overwrites.
- Output a TUI dashboard at `/ast-gain`.

**Non-Goals:**
- Granular per-file statistics beyond the recent history log.
- Exact millisecond-perfect concurrency locks (optimistic delta-updates are sufficient for stats).

## Decisions

### 1. StatsManager Replaces SessionStats Entirely
**Decision**: The existing `SessionStats` class will be removed and fully absorbed by the new `StatsManager`.
**Rationale**: Having two classes track the same metrics leads to state sync issues. `StatsManager` will keep distinct "session session properties" (what happened this run) vs "lifetime properties" (what is on disk).

### 2. Strict Schema Validation
**Decision**: Rely exclusively on `@sinclair/typebox` to validate data loaded from disk.
**Rationale**: Mitigates prototype pollution and JSON injection vulnerabilities if the physical `.pi/.../stats.json` file is tampered with.

### 3. Delta-Updates to mitigate Parallel Race Conditions
**Decision**: When persisting to disk, we won't blindly write memory values. Instead, `StatsManager` keeps track of the "delta" (the new bytes/errors added since the last save). During a save, it quickly reads the JSON from disk, adds the delta, appends the new history, and writes it back.
**Rationale**: If a user runs two instances of `pi` in the same directory, this prevents the "Last Writer Wins" race condition from zeroing out the other instance's progress.

### 4. Bounded Storage (Disk Exhaustion Mitigation)
**Decision**: Hard-limit the history array to a maximum of 100 entries (`history.slice(-100)`).
**Rationale**: Prevents unbounded memory/disk usage.

### 5. Debounced Async I/O with process.on('exit') Flush
**Decision**: `StatsManager.save()` will be debounced during normal runtime. However, we will register a `process.on('exit')` or `process.on('beforeExit')` hook that synchronously flushes and writes the final deltas.
**Rationale**: Solves the issue where short-lived LLM interactions could exit before the debounce timeout triggers, resulting in permanently lost statistics.

## Risks / Trade-offs

- **Risk: Sync writes on process exits blocking the terminal shutdown.**
  - *Mitigation*: The JSON payload is small (max 100 array items) and restricted to the fast `.pi` directory. `writeFileSync` will add negligible latency to CLI exits (sub-millisecond).