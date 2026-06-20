## 1. Settings + config

- [x] 1.1 Add settings to `src/config.ts`: `enableLogSqueeze`, `enableIndexRefresh`, `enableSessionSeed` (default false), `sessionSeedBudget`, `sessionSeedScope` (`cwd`|`root`), `enableCyclePreflight` (default false). Validate with TypeBox.
- [x] 1.2 Expose all new settings in `src/tui.ts` (`/ast`) with explanatory preset labels.
- [x] 1.3 Update settings tables in `README.md` and `docs/architecture.md`.

## 2. Tier 1 — log/text squeeze interception

- [x] 2.1 In `src/interceptors.ts`, add a `.log`/`.txt` branch that calls `ast-bro squeeze` for large files when `enableLogSqueeze` is on, respecting `limit`/`offset` bypass.
- [x] 2.2 Graceful fallback to default `read` when squeeze is unavailable/errors.

## 3. Tier 1 — index freshness

- [x] 3.1 In the `edit`/`write` `tool_result` path, mark the `ast-bro` index stale when `enableIndexRefresh` is on; best-effort, non-blocking.
- [x] 3.2 Optional best-effort refresh; never block the edit result or crash on failure.

## 4. Tier 1 — session seed

- [x] 4.1 In `src/index.ts` `session_start`, inject `ast-bro digest` only when `enableSessionSeed` is on.
- [x] 4.2 Apply `sessionSeedBudget` trimming with a partial-map annotation; honor `sessionSeedScope` (cwd vs root).
- [x] 4.3 Graceful no-seed fallback when digest errors/unavailable.

## 5. Tier 1 — cycle pre-flight

- [x] 5.1 In the post-edit pre-flight, optionally run `ast-bro cycles` when `enableCyclePreflight` is on and flag newly detected cycles; best-effort, non-blocking.

## 6. Tier 2 — navigation tools

- [x] 6.1 Add `analyze_ast_trace` wrapping `ast-bro trace <FROM> <TO>` with input validation and output budgeting.
- [x] 6.2 Add `analyze_ast_surface` wrapping `ast-bro surface <dir>` with input validation.
- [x] 6.3 Document Tier 3 exclusions (`callers`/`callees`/`show`/`deps`/`reverse-deps`/`run`) and their rationale in `docs/architecture.md`/`README.md`.

## 7. Stats + telemetry

- [x] 7.1 Extend `src/statsManager.ts` `stats.json` schema (migration-safe) for squeeze savings and session-seed cost/attributed-savings/ROI.
- [x] 7.2 Surface squeeze savings and seed ROI in `/ast-gain`.

## 8. Tests + validation

- [x] 8.1 Vitest: squeeze interception triggers only for large logs, off when disabled, bypassed with `limit`/`offset`, falls back on error.
- [x] 8.2 Vitest: session seed is no-op by default, budget-trimmed + annotated when enabled, scope-limited, graceful on failure.
- [x] 8.3 Vitest: index-staleness and cycle pre-flight are best-effort and never throw on `ast-bro` failure.
- [x] 8.4 Vitest: navigation tools validate inputs and return error results (not crashes) when `ast-bro` is unavailable.
- [x] 8.5 Vitest: stats manager loads pre-existing `stats.json` without the new fields.
- [x] 8.6 Run `openspec validate expand-lifecycle-tools --strict` and fix any issues.
