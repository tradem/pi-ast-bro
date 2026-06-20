## Context

A code audit of the four AST tool modules showed output filtering is applied inconsistently:

- `src/astBroTools.ts` — strong transformation: 50-result `MAX_RESULTS` cap, `exact_snippet` injection (±2 lines), `attention_required`, byte measurement.
- `src/astGraphPilot.ts` — edge budget via `graphMaxEdges` with `truncated`/`total_edges` annotation.
- `src/tools.ts` `analyze_ast_search` — `mode: "summary"` aggregates headers, but `mode: "snippets"` returns **raw unbounded stdout**.
- `src/astContextPilot.ts` / `analyze_ast_map` — pass-through (budgeting happens inside `ast-bro`).

The unbounded `snippets` path is the concrete leak this change closes. Separately, the bundled skills and README duplicate "what does tool X do" content that already lives in tool metadata, causing three-way drift.

## Goals / Non-Goals

**Goals:**
- Make "every tool has an output upper bound" a consistent, stated principle.
- Bound `analyze_ast_search` snippets output with a configurable budget that trims lowest-ranked hits first.
- Slim the skills to pi/extension-exclusive content; establish a single source of truth per knowledge kind.
- Add an honest README comparison table (extension vs. upstream skill vs. managed indexing/graph).

**Non-Goals:**
- Adding new commands/tools (that is `expand-lifecycle-tools`).
- Changing `analyze_ast_context`/`analyze_ast_map` internal budgeting (deferred; `ast-bro` already budgets context).
- Replacing the existing `top_k` parameter — the budget is a ceiling, not a replacement.

## Decisions

1. **Budget, not element cap, for search.** `search` results are relevance-ranked, so a count cap (like impact's 50) is the wrong measure and would collide with `top_k`. A byte/token budget that trims from the bottom respects ranking and mirrors `graphMaxEdges`/`contextDefaultBudget`. New setting: `searchSnippetBudget`.
2. **Budget never overrides explicit `top_k`.** `top_k` stays the primary agent-controlled lever; the budget is only a safety ceiling, applied after `top_k`.
3. **Trim from the bottom + annotate.** Preserve top-ranked hits; emit a `truncated` indicator and omitted-hit count, consistent with how `graph` annotates truncation.
4. **Single source of truth per knowledge kind.** Tool capability → tool metadata; orchestration + pi-exclusive rules → skills; human onboarding + comparison → README. Skills stop carrying tool-reference dictionaries.
5. **Comparison table is honest.** It explicitly credits other approaches where they win (cross-agent, zero version-coupling) so it serves as a decision aid, not marketing. Token cost is split into definition-token (always sent) vs. output-token (per call) to defuse the common MCP misconception.

## Risks / Trade-offs

- **Trimming could drop a hit the agent wanted.** Mitigated by trimming lowest-ranked first, annotating omissions, and choosing a default budget high enough that typical queries are untouched.
- **Default budget tuning.** Too low harms recall; too high keeps the leak. Start conservative (typical queries unaffected) and expose in `/ast` for tuning.
- **Skill slimming risk.** Removing content the agent silently relied on. Mitigated because removed content is duplicated in tool metadata that the model sees every turn anyway.
- **README table maintenance.** Competitor capabilities change; phrase axes at a stable, conceptual level rather than versioned feature lists.
