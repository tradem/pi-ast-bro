---
name: ast-bro-architecture
description: AST-first navigation workflow for architecture, bounded-context, aggregate, and module-relationship questions.
license: MIT
compatibility: Requires the pi-ast-bro extension and ast-bro CLI.
metadata:
  author: pi-ast-bro
  version: "1.0"
---

# /ast-bro-architecture

Use this skill when the user asks high-level structural questions such as:

- "Sketch the aggregates in this bounded context."
- "How are these modules connected?"
- "What depends on X?"
- "Explain the architecture of the backend."
- "How does this symbol work?"

The goal is to stay on the AST-first path and avoid reading many whole files
sequentially. For the exact tool surface and per-tool capabilities, see the tool
metadata or the README. This skill focuses on the pi-ast-bro-specific
orchestration rules.

## Reflection rule

Before calling `read` on **more than two files** for a structural question, stop
and prefer `analyze_ast_graph`, `analyze_ast_map`, or `analyze_ast_search` first.
Only fall back to `read` when you need exact source text, exact whitespace, or
a specific business-rule implementation detail.

## Resolve symbol names before targeting them

`analyze_ast_context`, `analyze_ast_impact`, `find_implementations` and
`analyze_ast_trace` resolve `target` by **exact suffix match only**. There is no
fuzzy or prefix matching: asking for `initialize` does *not* find
`initializeExtension`. A guessed name fails.

So never invent a `target`. Derive it:

- Name unknown → `analyze_ast_map` on the file first. It lists every top-level
  symbol with its line range, which is the authoritative set of valid targets.
- Name roughly known → `analyze_ast_search`, then use the `qn` it returns.
- The logic is an inline lambda or a branch inside a larger function → it has no
  own name. Target the **enclosing** symbol instead, then `read` the exact line
  range from the map.

### When a target does not resolve

On `symbol_not_found` the target does not exist — do not retry with variations
of the same guess. Run `analyze_ast_map` on the same `path` and pick a real
symbol from the output. If the map shows no such symbol, the code is inline
logic: target its enclosing function and fall back to `read` for that range.

## Workflows

### Architecture / bounded-context / aggregate relationships

1. Call `analyze_ast_graph` on the crate or project root.
   - If the output is truncated (`truncated: true`), raise `graphMaxEdges` in
     `/ast` or focus on a smaller sub-path.
2. Identify the modules/aggregates that matter.
3. Call `analyze_ast_map` on those files to get their top-level structure.
4. For individual symbols (aggregates, services, repositories), call
   `analyze_ast_context` with `path` set to the file or root and `target` set to
   the symbol name taken from the map in step 3 — never a guessed name.
5. Use `analyze_ast_search` with `mode: summary` to find call sites or related
   names across the codebase.
6. Read only the specific line ranges or files that contain the business rules
   you still need.

### How a specific symbol works

1. Resolve the exact symbol name (see "Resolve symbol names before targeting
   them"). If you already have it from an earlier `analyze_ast_map` or
   `analyze_ast_search` result, skip straight to step 2.
2. Call `analyze_ast_context` with `path` set to the file or directory and
   `target` set to the symbol.
   - If the result is too short, raise the `budget` parameter or increase
     `contextDefaultBudget` in `/ast`.
3. Use `analyze_ast_search` with `mode: summary` to locate callers/implementers.
   - If `analyze_ast_search` snippets are truncated, raise `searchSnippetBudget`
     in `/ast` or switch to `mode: summary` for a compact map.
4. Fall back to `read` with explicit `offset`/`limit` only for exact source
   regions required for edits.
