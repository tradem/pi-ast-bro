## ADDED Requirements

### Requirement: Skills avoid duplicating tool-reference content
The bundled skills SHALL NOT restate per-tool "what does this tool do" descriptions that already live in the tool metadata. Each kind of knowledge has a single source of truth: tool capability lives in tool metadata, orchestration and pi-exclusive rules live in skills, human onboarding lives in the README.

#### Scenario: Architecture skill is loaded
- **WHEN** the `ast-bro-architecture` skill is read
- **THEN** it contains no standalone "Tool reference" dictionary section restating each tool's purpose

#### Scenario: Agent needs a tool's purpose
- **WHEN** the agent needs to know what a tool does
- **THEN** that information is available from the tool metadata rather than duplicated in the skill

### Requirement: Refactor skill retains pi-exclusive discipline
The `ast-bro-refactor` skill SHALL retain the pi/extension-exclusive rules that no upstream `ast-bro` skill can provide: using `exact_snippet` verbatim as `edits[].oldText`, the 50-result `attention_required` batch-pivot rule, and pi tool names.

#### Scenario: Skill guides a snippet-backed edit
- **WHEN** the agent follows the refactor skill
- **THEN** it is instructed to use the `exact_snippet` value verbatim (no paraphrasing/whitespace changes) as `edits[].oldText`

#### Scenario: Result set exceeds the cap
- **WHEN** a tool response includes `attention_required`
- **THEN** the skill instructs the agent to stop iterative edits and pivot to a batch transformation

## MODIFIED Requirements

### Requirement: Architecture skill defines an AST-first workflow
The `ast-bro-architecture` skill SHALL specify a concrete tool chain for architecture, bounded-context, and aggregate relationship questions, and SHALL keep only pi/extension-exclusive guidance — the reflection rule, settings hints (e.g. raising `graphMaxEdges`/`contextDefaultBudget` via `/ast`), and orchestration workflows — without duplicating the full decision-tree table that already appears in the README and tool metadata.

#### Scenario: User asks for aggregate relationships
- **WHEN** the agent follows the skill
- **THEN** it first calls `analyze_ast_graph` on the crate root, then `analyze_ast_map` on key modules, then `analyze_ast_context` on relevant symbols, then `analyze_ast_search` with `mode: summary`, and finally targeted `read` only for business-rule details

#### Scenario: User asks how a specific symbol works
- **WHEN** the agent follows the skill
- **THEN** it calls `analyze_ast_context` on that symbol before falling back to `read`

#### Scenario: Skill references settings instead of restating tool docs
- **WHEN** the agent hits a truncated graph or short context
- **THEN** the skill points to raising `graphMaxEdges` or `contextDefaultBudget` via `/ast` rather than restating each tool's full description
