## 1. Tool Guidance Updates

- [x] 1.1 Update `analyze_ast_map` description and `promptGuidelines` with the AST-first decision tree and reflection rule
- [x] 1.2 Update `analyze_ast_search` description and `promptGuidelines` to mention the summary mode, decision tree, and reflection rule

## 2. Architecture Skill

- [x] 2.1 Create `skills/ast-bro-architecture/SKILL.md` with the AST-first workflow for architecture and relationship questions
- [x] 2.2 Wire the new skill into the `resources_discover` hook in `src/index.ts`

## 3. Context Pilot Tool

- [x] 3.1 Create `src/astContextPilot.ts` with a `runAstBroContext` helper that invokes `ast-bro context --json --compact --budget`
- [x] 3.2 Define the TypeBox schema for `analyze_ast_context` with `path` (required), `target` (optional), and `budget` (optional) parameters
- [x] 3.3 Add path-target safety validation and graceful fallback when `ast-bro` is unavailable or errors
- [x] 3.4 Register `analyze_ast_context` in `src/index.ts`

## 4. Graph Pilot Tool

- [x] 4.1 Create `src/astGraphPilot.ts` with a `runAstBroGraph` helper that invokes `ast-bro graph --json --compact --hide-external`
- [x] 4.2 Define the TypeBox schema for `analyze_ast_graph` with an optional `path` parameter
- [x] 4.3 Add path safety validation and graceful fallback when `ast-bro` is unavailable or errors
- [x] 4.4 Register `analyze_ast_graph` in `src/index.ts`

## 5. Search Summary Mode

- [x] 5.1 Extend the `analyze_ast_search` TypeBox schema with an optional `mode` enum (`"snippets" | "summary"`, default `"snippets"`)
- [x] 5.2 Implement the header parser and grouped JSON summary formatter in `src/tools.ts` or a dedicated helper
- [x] 5.3 Ensure summary mode falls back to raw stdout when headers cannot be parsed
- [x] 5.4 Verify that existing snippet-mode behavior is unchanged

## 6. Tests

- [x] 6.1 Add Vitest tests for `analyze_ast_context` using `vi.mock('node:child_process')`
- [x] 6.2 Add Vitest tests for `analyze_ast_graph` using mocked `spawnSync`
- [x] 6.3 Add Vitest tests for search summary parsing and fallback behavior
- [x] 6.4 Add tests verifying unsafe paths are rejected without invoking `ast-bro`

## 7. Settings & TUI

- [x] 7.1 Extend `SettingsSchema` in `src/config.ts` with `graphMaxEdges` (default 500, minimum 1) and `contextDefaultBudget` (default 4000, minimum 500)
- [x] 7.2 Update `getDefaults()` and `mergeDefaults()` to handle the new settings
- [x] 7.3 Add TUI controls in `src/tui.ts` for `graphMaxEdges` and `contextDefaultBudget` with sensible preset values and short explanatory labels (e.g. "4000 — standard context")
- [x] 7.4 Ensure new tools read settings from `SettingsManager` at runtime

## 8. Documentation

- [x] 8.1 Update `README.md` with the new tools (`analyze_ast_context`, `analyze_ast_graph`, search summary mode), configurable settings, and the `/ast-bro-architecture` skill
- [x] 8.2 Update `docs/architecture.md` to describe the new data flow and tool modules
