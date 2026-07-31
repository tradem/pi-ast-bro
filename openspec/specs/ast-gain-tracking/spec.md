# ast-gain-tracking Specification

## Purpose
TBD - created by archiving change add-ast-gain. Update Purpose after archive.
## Requirements
### Requirement: Persistent tracking of token savings and intercepted reads
The system SHALL intercept large file reads via `ast-bro` and persistently track the bytes saved and the number of reads intercepted into a rolling file store strictly bounded to `CONFIG_DIR_NAME/plugins/ast-bro/stats.json`.

#### Scenario: Intercepting a large read
- **WHEN** the `pi-ast-bro` read interceptor triggers correctly for an oversized file
- **THEN** the exact bytes saved (original file size vs. ast-bro summary size) is added to the in-memory delta and scheduled for writing to `stats.json`

### Requirement: Persistent tracking of caught syntax errors
The system SHALL intercept write/edit calls, run a pre-flight syntax check using `ast-bro`, and permanently log intercepted errors to disk if an error is caught before it is handed back to the user.

#### Scenario: Catching a syntax error
- **WHEN** the `pi-ast-bro` edit interceptor detects invalid syntax via `ast-bro` output
- **THEN** the event is permanently stored on disk by incrementing the total errors caught counter and appending the error to the history log

### Requirement: TUI Dashboard Display
The system SHALL provide an interactive `/ast-gain` CLI/TUI command that formats and renders the persistent capabilities.

#### Scenario: Invoking /ast-gain
- **WHEN** a user enters `/ast-gain`
- **THEN** an ASCII retro-highscore style dashboard displays the total tokens saved, total intercepted errors, and the most recent events from the history array

#### Scenario: Dashboard shows the tracked score period
- **WHEN** the highscore view renders and `trackingSince` is set on the persisted stats (backfilled from the oldest history entry or the current time when absent)
- **THEN** the dashboard displays a `Score period` line formatted as `YYYY-MM-DD – YYYY-MM-DD` (start = `trackingSince`, end = the most recent history entry, or the current date when there is no history)

#### Scenario: Dashboard renders only the recent history tail
- **WHEN** the history array holds more than `RECENT_ACTIVITY_LIMIT` (20) entries
- **THEN** the dashboard renders only the last 20 entries, newest first
- **AND** the "Recent Activity" label reports the actual number of rendered actions.

## ADDED Requirements

### Requirement: Track squeeze interception savings
The system SHALL track bytes saved by log/text `squeeze` interception in `stats.json` and surface them in `/ast-gain`, in a schema-compatible (migration-safe) way.

#### Scenario: Squeeze interception saves bytes
- **WHEN** a large `.log`/`.txt` read is replaced by `ast-bro squeeze` output
- **THEN** the byte difference (raw file size vs. squeezed output) is added to the persistent savings and shown in `/ast-gain`

#### Scenario: Reading older stats files
- **WHEN** `stats.json` predates the squeeze fields
- **THEN** the stats manager loads it without error and initializes the new fields to zero

### Requirement: Track session-seed ROI
The system SHALL record the session-seed injection cost and the savings later attributed to it, surfacing a net ROI in `/ast-gain`.

#### Scenario: Viewing seed ROI
- **WHEN** a seeded session has injected a digest and later avoided reads
- **THEN** `/ast-gain` displays the seed's injection cost, attributed savings, and the resulting net ROI

### Requirement: Track the score period start
The system SHALL persist a `trackingSince` ISO timestamp in `stats.json` marking the start of the period the lifetime highscore counters refer to.

#### Scenario: Backfilling trackingSince on migration
- **WHEN** `stats.json` predates the `trackingSince` field
- **THEN** the stats manager loads it without error and backfills `trackingSince` from the oldest history entry (or the current time when the history is empty)
- **AND** the backfilled value is persisted with the next write

#### Scenario: Preserving trackingSince across merges and writes
- **WHEN** `stats.json` already contains `trackingSince`
- **THEN** `getLifetimeSummary()` and every subsequent write preserve the value unchanged

### Requirement: Track savings of all context-saving AST tools
The system SHALL record token/byte savings for every context-saving feature, not only the read/squeeze interceptors. `analyze_ast_context`, `analyze_ast_graph`, `analyze_ast_trace`, and `analyze_ast_surface` SHALL estimate the raw source volume their output replaces and report it via `stats.addReadSavings`.

#### Scenario: analyze_ast_context records savings from referenced files
- **WHEN** `analyze_ast_context` succeeds and the JSON report lists `report.entries[].file` paths
- **THEN** the extension sums the sizes of the referenced files (via `stat`), compares them to the emitted output size, and records the positive difference with `addReadSavings`
- **AND** the recording is best-effort: unresolvable files, stat errors, and non-JSON output are skipped without affecting the tool result

#### Scenario: analyze_ast_graph records savings from graph edges
- **WHEN** `analyze_ast_graph` succeeds and the JSON output contains `edges[].from`/`edges[].to`
- **THEN** the extension sums the deduplicated referenced file sizes and records the positive difference against the (possibly edge-truncated) output

#### Scenario: analyze_ast_trace and analyze_ast_surface record savings from output paths
- **WHEN** `analyze_ast_trace` succeeds with numbered `path:line` entries or `analyze_ast_surface` succeeds with `symbol  path:line` lines
- **THEN** the extension sums the deduplicated referenced file sizes and records the positive difference against the emitted output

#### Scenario: Failed tool runs never record savings
- **WHEN** a tool exits non-zero, is aborted, or references no existing files
- **THEN** no savings are recorded and the tool result is unchanged

