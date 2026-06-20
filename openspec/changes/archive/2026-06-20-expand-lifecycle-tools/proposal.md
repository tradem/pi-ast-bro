## Why

`pi-ast-bro` wraps only 6 of `ast-bro`'s 16 commands today. The strategic question is not "wrap them all" — a bare `ast-bro mcp` server already exposes every command to any agent. The defensible moat of a **pi extension** is the tool lifecycle (`tool_call`/`tool_result`/`session_start`) and output filtering, which an MCP server sitting *beside* the agent structurally cannot occupy. This change adds the missing commands that either (a) exploit that lifecycle moat or (b) close a genuine filtered-output gap, while *deliberately omitting* commands already covered by existing tools to avoid tool-confusion and schema-token bloat.

## What Changes

- **Tier 1 — lifecycle moat features (structurally impossible for MCP/skill):**
  - **Log/text squeeze interception**: extend the existing large-file `read` interception so big `.log`/`.txt` reads are replaced by `ast-bro squeeze` output, widening token savings beyond code.
  - **Index staleness management**: on `edit`/`write` (`tool_result`), mark the per-repo `ast-bro` search index stale (optionally trigger a refresh), healing the local index's freshness gap vs. managed cloud indexing.
  - **Session context seed (opt-in)**: on `session_start`, optionally inject an `ast-bro digest` repo map — the AST-exact answer to proactive RAG. Default **OFF**, budget- and scope-limited, with ROI tracking.
  - **Cycle pre-flight check (optional)**: optionally run `ast-bro cycles` as part of the post-edit pre-flight, surfacing new import cycles like the existing syntax gate.
- **Tier 2 — optional filtered tools (wrapped only with output budgeting):**
  - `analyze_ast_trace` (wraps `ast-bro trace`): shortest call path A→B, budget-trimmed.
  - `analyze_ast_surface` (wraps `ast-bro surface`): the package's actually-published API.
- **Tier 3 — deliberately NOT wrapped (documented rationale):** `callers`/`callees` (covered by `impact`), `show` (covered by `context`/`map`), `deps`/`reverse-deps` (covered coarsely by `graph`), `run` (mutates files, bypasses pre-flight — security risk per AGENTS.md).

## Capabilities

### New Capabilities
- `ast-log-squeeze`: Large `.log`/`.txt` read interception via `ast-bro squeeze`, with the same threshold/fallback discipline as code interception.
- `ast-index-freshness`: Lifecycle-driven invalidation/refresh of the `ast-bro` search index after edits/writes.
- `ast-session-seed`: Opt-in, default-off, budget- and scope-limited `session_start` repo-map injection with self-measured ROI.
- `ast-cycle-preflight`: Optional post-edit import-cycle detection surfaced like the syntax pre-flight gate.
- `ast-navigation-tools`: New filtered tools `analyze_ast_trace` and `analyze_ast_surface`, plus documented exclusions.

### Modified Capabilities
- `ast-gain-tracking`: Stats gain new categories — bytes saved by squeeze interception and a session-seed cost-vs-savings ROI metric surfaced in `/ast-gain`.

## Impact

- **Code**: `src/interceptors.ts` (squeeze branch, index-stale hook, optional cycle pre-flight), `src/index.ts` (`session_start` seed), new `src/astTraceTool.ts`/`src/astSurfaceTool.ts` (or extensions to existing tool modules), `src/config.ts` (new settings: `enableLogSqueeze`, `enableSessionSeed`, `sessionSeedBudget`, `sessionSeedScope`, `enableIndexRefresh`, `enableCyclePreflight`), `src/tui.ts` (`/ast` controls), `src/statsManager.ts` (`stats.json` schema additions, migration-safe).
- **Behavior**: New interceptions are opt-in or threshold-gated; session seed is default OFF so the token-frugality promise stays unconditional. No breaking changes to existing tool signatures.
- **Dependencies**: still only the `ast-bro` CLI via `spawnSync` with argument arrays; no new npm packages. `ast-bro run` is intentionally excluded for security.
- **Risk**: session-seed always costs tokens when enabled; mitigated by default-off + budget + scope + ROI telemetry to inform a future default flip.
