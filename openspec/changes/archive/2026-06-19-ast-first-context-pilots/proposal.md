# AST-first Context Pilots

## Why

Productive use of `pi-ast-bro` showed that the agent still reaches for raw `read` when users ask architecture or relationship questions ("sketch the aggregates", "how are these connected?"). The AST tools exist, but the agent lacks a clear decision tree for when to use them first, and the existing tools return either low-level structure (`map`) or raw snippets (`search`) rather than a compact, navigable overview. We need lightweight, language-agnostic "pilots" that steer the agent toward the right AST tool, surface just enough context to answer the question, and avoid token-heavy file reads.

## What Changes

- **Richer tool guidance**: Update `description` and `promptGuidelines` for `analyze_ast_map` and `analyze_ast_search` with an explicit AST-first decision tree and a reflection rule ("before reading more than two files, check AST-first").
- **New architecture skill**: Add `/ast-bro-architecture` (`skills/ast-bro-architecture/SKILL.md`) with a hard-coded workflow for architecture, aggregate, and bounded-context questions.
- **New `analyze_ast_context` tool**: Wrap `ast-bro context --json --compact --budget` to return a token-budgeted bundle of a symbol's body, direct callers/callees, and relevant dependencies — replacing whole-file reads for "how does this work?" questions.
- **New `analyze_ast_graph` tool**: Wrap `ast-bro graph --json --compact` to return a compact file/module dependency graph for architecture and coupling questions.
- **Search summary mode**: Extend `analyze_ast_search` with an optional `mode: "summary"` that returns a grouped map of hits (files, line ranges, counts) instead of raw snippets, saving tokens and giving the agent a clearer targeting overview.
- **Configurable defaults**: Extend the settings schema with two new values:
  - `graphMaxEdges` (default 500) to cap `analyze_ast_graph` output.
  - `contextDefaultBudget` (default 4000 tokens) for `analyze_ast_context`.
  Both are editable in `.pi/plugins/ast-bro/settings.json` and in the `/ast` dashboard.
- **Tests & docs**: Add Vitest coverage for the new wrappers and update `README.md` with the new workflow.

No breaking changes. All new tool parameters are optional; existing behavior remains the default.

## Capabilities

### New Capabilities

- `ast-first-guidance`: Prompt-level rules and a dedicated skill that make the agent prefer AST tools over sequential `read` for structure and architecture questions.
- `ast-context-pilot`: Token-budgeted, focused context retrieval for individual symbols via `analyze_ast_context`.
- `ast-graph-pilot`: Compact module/file dependency graph via `analyze_ast_graph`.
- `ast-search-summary`: Optional compact summary output for `analyze_ast_search` that groups matches by file and line range for faster navigation.

### Modified Capabilities

- None.

## Impact

- `src/tools.ts` — updated descriptions, new wrappers for `context` and `graph`.
- New `src/astContextPilot.ts` and `src/astGraphPilot.ts` modules (or equivalent) for focused, testable CLI wrappers.
- `skills/ast-bro-architecture/SKILL.md` — new bundled skill.
- `src/index.ts` — register new tools and expose the skill via `resources_discover`.
- `tests/` — new Vitest suites mocking `node:child_process`.
- `README.md` — documentation for the new workflow and tools.
