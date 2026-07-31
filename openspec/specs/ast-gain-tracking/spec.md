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

