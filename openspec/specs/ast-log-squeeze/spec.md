# ast-log-squeeze Specification

## Purpose
TBD

## Requirements

### Requirement: Large log/text reads are intercepted with squeeze
When the agent reads a large `.log`/`.txt` file (above the configured size threshold) without explicit `limit`/`offset`, the extension SHALL replace the raw read with `ast-bro squeeze` output, governed by an `enableLogSqueeze` setting.

#### Scenario: Agent reads a large log file
- **WHEN** the agent calls `read` on a 20k-line `.log` file with no `limit`/`offset` and `enableLogSqueeze` is on
- **THEN** the extension returns the `ast-bro squeeze` compressed output instead of the raw file

#### Scenario: Squeeze interception is disabled
- **WHEN** `enableLogSqueeze` is off
- **THEN** the `read` proceeds with default behavior (no squeeze)

#### Scenario: Explicit range bypasses squeeze
- **WHEN** the agent calls `read` on a large log file with explicit `limit`/`offset`
- **THEN** the raw range is returned without squeeze interception

### Requirement: Squeeze interception degrades gracefully
If `ast-bro squeeze` is unavailable, errors, or would not help, the extension SHALL fall back to the default `read` behavior without crashing.

#### Scenario: ast-bro squeeze fails
- **WHEN** `ast-bro squeeze` returns a non-zero exit code or is missing
- **THEN** the extension falls back to the default `read` result
