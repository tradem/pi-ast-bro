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
