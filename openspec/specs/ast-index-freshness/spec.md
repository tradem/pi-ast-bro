# ast-index-freshness Specification

## Purpose
TBD

## Requirements

### Requirement: Edits invalidate the search index
After a successful `edit`/`write` (`tool_result`), the extension SHALL mark the per-repo `ast-bro` search index as stale, governed by an `enableIndexRefresh` setting.

#### Scenario: Agent edits a source file
- **WHEN** the agent successfully edits a file in a repo that has an `ast-bro` index and `enableIndexRefresh` is on
- **THEN** the extension marks the index stale so the next search reflects the change

#### Scenario: Index refresh disabled
- **WHEN** `enableIndexRefresh` is off
- **THEN** the extension does not touch the index after edits

### Requirement: Index refresh never blocks or crashes
Index invalidation/refresh SHALL be best-effort and MUST NOT block the edit result or crash the agent if `ast-bro` index operations fail.

#### Scenario: Index refresh fails
- **WHEN** the index operation errors or `ast-bro` is unavailable
- **THEN** the edit result is returned unchanged and the failure is logged, not raised
