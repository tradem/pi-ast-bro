## ADDED Requirements

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
- **THEN** an ASCII retro-highscore style dashboard displays the total tokens saved, total intercepted errors, and the most recent events from the history array.
