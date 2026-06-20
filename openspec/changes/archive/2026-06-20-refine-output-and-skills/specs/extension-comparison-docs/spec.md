## ADDED Requirements

### Requirement: README includes an approach comparison table
The README SHALL include a comparison table contrasting the `pi-ast-bro` extension, the plain upstream `ast-bro` `SKILL.md`, and managed indexing/graph tools (e.g. Copilot, Claude, Aider, Hermes) to help users choose an approach.

#### Scenario: User reads the comparison to choose an approach
- **WHEN** a user opens the README
- **THEN** they find a table whose rows compare the three approaches across decision-relevant axes

### Requirement: Comparison covers decision-relevant axes
The comparison table SHALL include axes that reflect the actual tradeoffs: tool-lifecycle interception, output filtering, index freshness/proactivity, cross-agent support, privacy/local-only, setup effort, and token cost (definition tokens vs. output tokens).

#### Scenario: A user worried about token cost reads the table
- **WHEN** the user scans the token-cost axis
- **THEN** the table distinguishes always-sent tool-definition cost from per-call output cost and shows where each approach lands

#### Scenario: A user needing cross-agent support reads the table
- **WHEN** the user scans the cross-agent axis
- **THEN** the table shows that managed indexing and the upstream MCP/skill are cross-agent while this extension targets pi specifically

### Requirement: Comparison is honest about extension limits
The comparison SHALL acknowledge where other approaches are stronger, including cross-agent reach and zero version-coupling, so it serves as a genuine decision aid rather than marketing.

#### Scenario: User evaluates whether they even need the extension
- **WHEN** the user reads the table and works in a non-pi agent
- **THEN** the table makes clear that the upstream skill or MCP is the appropriate choice there
