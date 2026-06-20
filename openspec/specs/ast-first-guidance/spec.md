# ast-first-guidance Specification

## Purpose
Prompt-level rules and a dedicated skill that make the agent prefer AST tools over sequential `read` for structure and architecture questions.

## Requirements

### Requirement: Existing AST tools expose an AST-first decision tree
The `description` or `promptGuidelines` of `analyze_ast_map` and `analyze_ast_search` SHALL include a decision table that tells the agent which tool to use first for common question types.

#### Scenario: Agent asks about architecture or module relationships
- **WHEN** the tool metadata is loaded into the system prompt
- **THEN** it states that architecture/relationship questions start with `analyze_ast_graph` or `analyze_ast_map`, then `analyze_ast_search`, and only fall back to `read` for semantics

#### Scenario: Agent asks where a symbol is used
- **WHEN** the tool metadata is loaded into the system prompt
- **THEN** it states that symbol-usage questions start with `analyze_ast_impact` or `analyze_ast_search`, then `read` only if needed

#### Scenario: Agent asks about an interface or trait implementation
- **WHEN** the tool metadata is loaded into the system prompt
- **THEN** it states that implementation questions start with `find_implementations`

### Requirement: Existing AST tools expose a reflection guardrail
The `promptGuidelines` of `analyze_ast_map` and `analyze_ast_search` SHALL contain an explicit rule that triggers self-reflection before opening many files with `read`.

#### Scenario: Agent is about to read multiple files
- **WHEN** the agent considers calling `read` on more than two files for a structural question
- **THEN** the prompt guideline instructs it to stop and prefer `analyze_ast_map`, `analyze_ast_graph`, or `analyze_ast_search` first

### Requirement: Architecture skill is discoverable
The extension SHALL expose a new bundled skill named `ast-bro-architecture` through the `resources_discover` hook.

#### Scenario: Agent initializes and discovers skills
- **WHEN** the pi agent loads the extension
- **THEN** `resources_discover` returns the path to `skills/ast-bro-architecture/SKILL.md`

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
