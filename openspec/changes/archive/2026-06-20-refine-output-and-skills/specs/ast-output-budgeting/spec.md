## ADDED Requirements

### Requirement: Search snippets mode enforces an output budget
`analyze_ast_search` in `snippets` mode SHALL enforce a configurable output budget (`searchSnippetBudget`, measured in bytes/approximate tokens) that bounds the size of the returned raw output.

#### Scenario: Search output is within budget
- **WHEN** the agent calls `analyze_ast_search(query: "character_id")` and the `ast-bro search` output is smaller than `searchSnippetBudget`
- **THEN** the tool returns the output unchanged

#### Scenario: Search output exceeds budget
- **WHEN** the `ast-bro search` snippets output exceeds `searchSnippetBudget`
- **THEN** the tool trims the lowest-ranked hits first until the output fits within the budget

### Requirement: Budget trimming preserves relevance ordering
When trimming, the tool SHALL remove the lowest-ranked (least relevant) hits first, preserving the top-ranked hits emitted by `ast-bro search`.

#### Scenario: Trimming keeps the strongest matches
- **WHEN** a search returns 100 ranked hits and only the top 40 fit in the budget
- **THEN** the tool keeps the 40 highest-ranked hits and drops the remaining 60

### Requirement: Budget annotates truncation
When the tool trims hits to fit the budget, it SHALL annotate the result with a truncation indicator and the count of omitted hits.

#### Scenario: Agent sees that results were trimmed
- **WHEN** the tool drops 60 of 100 hits to fit the budget
- **THEN** the output includes a `truncated` indicator and an omitted-hit count such as `60 additional hits omitted`

### Requirement: Budget does not override explicit top_k
The `searchSnippetBudget` SHALL act only as an upper safety bound and MUST NOT reduce results below an explicit `top_k` requested by the agent unless the budget would otherwise be exceeded.

#### Scenario: Agent requests a specific top_k within budget
- **WHEN** the agent calls `analyze_ast_search(query: "x", top_k: 80)` and 80 hits fit within `searchSnippetBudget`
- **THEN** the tool returns all 80 hits without budget-based trimming

#### Scenario: Explicit top_k still exceeds budget
- **WHEN** the agent calls `analyze_ast_search(query: "x", top_k: 80)` but those 80 hits exceed `searchSnippetBudget`
- **THEN** the tool trims the lowest-ranked hits to fit the budget and annotates the truncation

### Requirement: searchSnippetBudget is configurable
The extension SHALL expose `searchSnippetBudget` as a persisted setting with a sensible default and surface it in the `/ast` dashboard.

#### Scenario: User changes the budget in the dashboard
- **WHEN** the user opens `/ast` and selects a new `searchSnippetBudget` value
- **THEN** the setting is persisted to `.pi/plugins/ast-bro/settings.json` and used by subsequent search calls

#### Scenario: Default keeps typical queries unaffected
- **WHEN** the setting is at its default value and a typical query returns a handful of hits
- **THEN** no trimming occurs and behavior matches the pre-change output
