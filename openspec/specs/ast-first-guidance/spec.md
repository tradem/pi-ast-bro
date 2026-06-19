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
The `ast-bro-architecture` skill SHALL specify a concrete tool chain for architecture, bounded-context, and aggregate relationship questions.

#### Scenario: User asks for aggregate relationships
- **WHEN** the agent follows the skill
- **THEN** it first calls `analyze_ast_graph` on the crate root, then `analyze_ast_map` on key modules, then `analyze_ast_context` on relevant symbols, then `analyze_ast_search` with `mode: summary`, and finally targeted `read` only for business-rule details

#### Scenario: User asks how a specific symbol works
- **WHEN** the agent follows the skill
- **THEN** it calls `analyze_ast_context` on that symbol before falling back to `read`
