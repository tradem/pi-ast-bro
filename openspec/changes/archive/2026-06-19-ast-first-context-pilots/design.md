# AST-first Context Pilots — Design

## Context

`pi-ast-bro` already intercepts large file reads and exposes `analyze_ast_map`, `analyze_ast_search`, `analyze_ast_impact`, and `find_implementations`. In practice, the agent still defaults to `read` for architecture questions because the existing tools do not clearly communicate their order of use, and none of them return a compact, navigable overview. `ast-bro` itself provides richer commands (`context`, `graph`, `search`) that are not yet exposed to the LLM.

The goal is to add lightweight, language-agnostic "pilot" tools and guidance that keep the agent on the AST-first path while staying as token-efficient as `rtk`.

## Goals / Non-Goals

**Goals:**
- Make the agent prefer AST tools over sequential `read` for structure/architecture questions.
- Give the agent a compact, navigable map before it dives into details.
- Provide token-budgeted focused context for individual symbols.
- Add a grouped summary mode to semantic search so results are scannable, not snippet-heavy.
- Keep everything language-agnostic (works for Rust, C#, TypeScript, Python, etc. via `ast-bro`).

**Non-Goals:**
- No language-specific domain mapper (e.g. hard-coded DDD aggregate heuristics for Rust).
- No summarization performed by an LLM inside the tool; aggregation stays simple and deterministic.
- No new external runtime dependencies.

## Decisions

### 1. New tools wrap existing `ast-bro` commands, not custom parsers
- **Decision:** `analyze_ast_context` wraps `ast-bro context --json --compact --budget`. `analyze_ast_graph` wraps `ast-bro graph --json --compact --hide-external`.
- **Rationale:** `ast-bro` already produces structured, language-agnostic output. Reusing it avoids brittle per-language parsing and stays aligned with upstream improvements.

### 2. `analyze_ast_context` accepts `path`, optional `target`, optional `budget`
- **Decision:** `path` is required (root or file). `target` is optional (symbol). `budget` defaults to a token count that is large enough to be useful but small enough to stay cheap (e.g. 4000 tokens).
- **Rationale:** Matches the CLI shape `ast-bro context [target] [path]`. A default budget prevents accidental huge context while still allowing the agent to request more.

### 3. Search summary mode is an optional parameter, not a separate tool
- **Decision:** Add `mode?: "snippets" | "summary"` to `analyze_ast_search`, defaulting to `"snippets"`.
- **Rationale:** Keeps the tool surface small. Existing callers are unaffected. The agent can request a map view when it wants to scan many results quickly.

### 4. Summary output is JSON grouped by file
- **Decision:** In summary mode, parse the `path:start-end [score …]` headers and emit `{"total_hits": N, "files": {"path": {"hit_count": N, "ranges": ["12-34", ...]}}}`.
- **Rationale:** Compact, machine-readable, and gives the agent line ranges it can pass directly to `read` with `limit`/`offset` or to `analyze_ast_context`.

### 5. Prompt guidance lives in tool metadata + a dedicated skill
- **Decision:** Tool `description`/`promptGuidelines` carry the decision tree and reflection rule. A new `/ast-bro-architecture` skill hard-codes the workflow for architecture questions.
- **Rationale:** Tool metadata is always present in the system prompt, while the skill is opt-in and reusable for complex queries. Both reinforce each other.

### 6. No stats integration for the first iteration
- **Decision:** The new tools do not attempt to calculate byte savings for stats in the MVP.
- **Rationale:** `context` reads partial bodies that are hard to attribute to a single source file size; adding imperfect savings estimates could mislead. Stats can be added later if telemetry shows value.

### 7. Graph output and context budget are configurable
- **Decision:** Add settings `graphMaxEdges` (default 500) and `contextDefaultBudget` (default 4000 tokens) to `settings.json` and expose them in the `/ast` TUI dashboard.
- **Rationale:** Large codebases can produce huge graphs or need larger context budgets. Making these user-configurable keeps the defaults token-efficient while letting users scale up without code changes.
- **UI detail:** The TUI shows numeric token presets (e.g. 1000/2000/4000/8000/16000) alongside a short meaning label such as "compact", "standard", or "detailed" so the value stays precise while remaining understandable.

## Risks / Trade-offs

- **[Risk]** `ast-bro context` can still exceed its budget and return large output for big symbols.  
  → **Mitigation:** Low default budget and explicit `budget` parameter; agent can reduce it or fall back to `map`.
- **[Risk]** `ast-bro graph` output grows with repo size and could become unwieldy.  
  → **Mitigation:** Use `--compact --hide-external`, truncate to `graphMaxEdges` edges, and let users raise the cap in `/ast` or `settings.json`.
- **[Risk]** Adding three new tools could confuse the agent if descriptions are too similar.  
  → **Mitigation:** Very specific descriptions and the architecture skill workflow; iterate on prompt wording after real-world use.
- **[Risk]** Search summary parsing depends on `ast-bro search` header format.  
  → **Mitigation:** Header regex is conservative and falls back to raw output on parse failure.
- **[Trade-off]** Token savings vs. exactness: summary/context are compact, but when the LLM needs exact whitespace for an edit, it must still use the refactoring tools or `read` with offset/limit.

## Migration Plan

No migration needed. Existing tools remain unchanged by default; new parameters are optional and new skills are opt-in.

## Open Questions

- Should `analyze_ast_context` expose `--rebuild` to force a fresh index, or leave that to `ast-bro` defaults?  
  (Tentative: leave defaults to keep the tool simple.)
- Should `analyze_ast_graph` support a `--depth` limit? `ast-bro graph` does not; if needed, the extension can truncate the returned edge list.
