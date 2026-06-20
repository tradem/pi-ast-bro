## Why

`pi-ast-bro` sells **token frugality**, but an audit of the current code shows the output-filtering moat is applied inconsistently: `analyze_ast_impact`/`find_implementations` truncate and inject exact snippets, `analyze_ast_graph` enforces an edge budget, yet `analyze_ast_search` in `snippets` mode and `analyze_ast_map` return raw, unbounded `ast-bro` stdout. A large repo can therefore leak hundreds of unbounded hits straight into the context window from inside our supposed savings tool. In parallel, the two bundled skills duplicate "what does tool X do" content that already lives in the tool metadata and the README, creating a three-way source of truth that drifts. Finally, users have no honest decision aid for choosing between this extension, the upstream `ast-bro` `SKILL.md`, and managed indexing/graph tools (Copilot, Claude, Aider, Hermes).

## What Changes

- **Unify output budgeting across tools.** Introduce a consistent rule: every tool has an output upper bound. List tools with relevance ordering (search) trim from the bottom; set/membership tools (impact) cap with an `attention_required` flag (already the case).
  - Add a token/byte **budget** to `analyze_ast_search` `snippets` mode (a safety ceiling, not a replacement for `top_k`), trimming the lowest-ranked hits first and annotating `truncated`/omitted-hit counts.
  - The new budget MUST NOT override an explicit `top_k` requested by the agent; it is only the upper safety bound.
- **Skill diet (single source of truth per knowledge kind).**
  - `ast-bro-architecture`: remove the "Tool reference" dictionary (it lives in tool metadata) and stop duplicating the full decision-tree table; keep the reflection rule, settings hints, and orchestration workflows.
  - `ast-bro-refactor`: tighten the two generic introductory steps; keep the pi-exclusive core (`exact_snippet` → `edits[].oldText` discipline, 50-result `attention_required` rule, pi tool names).
- **Add a comparison table to the README** contrasting the `pi-ast-bro` extension vs. the plain upstream `SKILL.md` vs. managed indexing/graph tools (Copilot, Claude, Aider, Hermes) as a user decision aid.

## Capabilities

### New Capabilities
- `ast-output-budgeting`: A consistent output-size discipline across AST tools, adding a configurable budget to `analyze_ast_search` snippets mode that trims lowest-ranked hits first without overriding `top_k`.
- `extension-comparison-docs`: A README decision-aid table comparing the extension, the upstream skill, and managed indexing/graph tools.

### Modified Capabilities
- `ast-first-guidance`: The bundled skills are slimmed to remove tool-reference duplication; the architecture skill no longer duplicates the decision tree and keeps only pi/extension-exclusive guidance (reflection rule, settings, orchestration).

## Impact

- **Code**: `src/tools.ts` (search snippets budgeting + parser), `src/config.ts` (new `searchSnippetBudget` setting), `src/tui.ts` (expose the setting in `/ast`), `src/statsManager.ts` (optional savings attribution for trimmed search).
- **Docs/skills**: `skills/ast-bro-architecture/SKILL.md`, `skills/ast-bro-refactor/SKILL.md`, `README.md`, `docs/architecture.md` (settings reference).
- **Behavior**: `analyze_ast_search` snippets output becomes bounded; default `searchSnippetBudget` chosen so typical queries are unaffected. No breaking change to tool signatures.
- **No new runtime dependencies.**
