## Context

`pi-ast-bro` wraps 6 of `ast-bro`'s 16 commands. The upstream project already ships `ast-bro mcp` (an MCP server) and `ast-bro prompt`, which expose every command to any agent. So the extension cannot win by "wrapping more tools" — a bare MCP does that too. The extension's defensible moat is what an MCP sitting *beside* the agent cannot do: occupy pi's tool lifecycle (`tool_call`/`tool_result`/`session_start`) and filter outputs. This change adds the missing commands sorted into three tiers by that lens.

## Goals / Non-Goals

**Goals:**
- Add lifecycle features only an extension can provide: log-squeeze interception, index-staleness, session seed, cycle pre-flight.
- Add a small number of genuinely useful filtered navigation tools (`trace`, `surface`).
- Keep the tool surface curated to avoid tool-confusion and schema-token bloat.
- Preserve the unconditional token-frugality promise (anything that costs tokens is opt-in).

**Non-Goals:**
- Wrapping every `ast-bro` command. `callers`/`callees`/`show`/`deps`/`reverse-deps` are deliberately excluded (covered by existing tools); `run` is excluded for safety.
- Building an MCP client/proxy. The extension already invokes the CLI via `spawnSync`; an MCP layer between two local processes adds protocol complexity with no gain.
- Cloud indexing. Index freshness is handled locally via lifecycle invalidation.

## Decisions

1. **Three-tier triage.** Tier 1 (squeeze, index-staleness, session-seed, cycle pre-flight) uses the lifecycle moat. Tier 2 (`trace`, `surface`) are filtered tools wrapped only with output budgeting. Tier 3 is explicitly not wrapped, with documented rationale.
2. **Session seed defaults OFF.** Proactive injection always costs tokens (output-token cost), which can conflict with the savings promise on short sessions. Default-off + budget + scope keeps the promise unconditional; ROI telemetry enables a data-driven default flip later instead of a guess.
3. **Seed scope guards monorepos.** `sessionSeedScope` (`cwd` vs `root`) prevents `ast-bro digest .` from blowing the budget in large repos; combined with budget-trimming from the same discipline used elsewhere.
4. **`run` is excluded for security.** `ast-bro run --write` mutates files and bypasses the pre-flight syntax gate, violating AGENTS.md security principles. Not wrapped.
5. **CLI over MCP.** All target functionality exists as CLI subcommands; `spawnSync` with argument arrays stays the integration mechanism (injection-safe, filterable, no extra deps).
6. **Stats schema is migration-safe.** New `stats.json` fields initialize to zero when loading older files, preventing crashes per the graceful-degradation principle.

## Risks / Trade-offs

- **Session seed token cost.** The one feature that can contradict the savings story. Mitigated by default-off, budget, scope, and ROI tracking.
- **Index-staleness correctness.** Marking stale is cheap; auto-refresh could be slow on big repos. Start with invalidation (cheap, correct) and make refresh opt-in/best-effort.
- **Interception surface growth.** More `read` branches (code, now logs) increases interceptor complexity; mitigated by extension-gated settings and shared fallback paths.
- **Tool-count creep.** Each new tool adds always-sent schema tokens. Mitigated by the curated Tier 3 exclusions — fewer, sharper tools is itself the anti-confusion stance.
- **Cycle pre-flight noise.** Pre-existing cycles could be falsely attributed to an edit; mitigated by flagging only newly detected cycles and keeping it default-off.
