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

## Workflows

### Architecture / bounded-context / aggregate relationships

1. Call `analyze_ast_graph` on the crate or project root.
   - If the output is truncated (`truncated: true`), raise `graphMaxEdges` in
     `/ast` or focus on a smaller sub-path.
2. Identify the modules/aggregates that matter.
3. Call `analyze_ast_map` on those files to get their top-level structure.
4. For individual symbols (aggregates, services, repositories), call
   `analyze_ast_context` with `path` set to the file or root and `target` set to
   the symbol name.
5. Use `analyze_ast_search` with `mode: summary` to find call sites or related
   names across the codebase.
6. Read only the specific line ranges or files that contain the business rules
   you still need.

### How a specific symbol works

1. Call `analyze_ast_context` with `path` set to the file or directory and
   `target` set to the symbol.
   - If the result is too short, raise the `budget` parameter or increase
     `contextDefaultBudget` in `/ast`.
2. Use `analyze_ast_search` with `mode: summary` to locate callers/implementers.
   - If `analyze_ast_search` snippets are truncated, raise `searchSnippetBudget`
     in `/ast` or switch to `mode: summary` for a compact map.
3. Fall back to `read` with explicit `offset`/`limit` only for exact source
   regions required for edits.
