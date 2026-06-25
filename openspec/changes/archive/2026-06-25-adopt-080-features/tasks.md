## 1. `ctx.isProjectTrusted()` gate in the auto-installer

- [x] 1.1 `src/index.ts` `session_start` auto-install branch: after the existing `if (!ctx.hasUI || ctx.mode !== "tui")` gate (around line 196) add an additional check: `if (typeof ctx.isProjectTrusted === "function" && !ctx.isProjectTrusted()) { ... }`
- [x] 1.2 In the trust-refusal branch: notification "pi-ast-bro: project not trusted; skipping ast-bro auto-install. Trust this project or install ast-bro manually." (severity `warning`); `config.enabled` is **not** persisted to `false` (session-local skip); `return` from the `session_start` handler
- [x] 1.3 Ensure the trusted path (`isProjectTrusted() === true` or API absent) keeps the existing confirm → spawn behaviour unchanged
- [x] 1.4 Keep the `typeof ctx.isProjectTrusted === "function"` guard defensive, so the extension does not crash against older pi versions (before ~0.79.x) if someone loads it manually

## 2. Helper `isInteractiveTui(ctx)` and consolidation

- [x] 2.1 `src/utils.ts`: add helper `isInteractiveTui(ctx: { mode?: string; hasUI?: boolean }): boolean`; returns `ctx.hasUI === true && ctx.mode === "tui"`
- [x] 2.2 `src/index.ts`: replace the inline check `if (!ctx.hasUI || ctx.mode !== "tui")` with `if (!isInteractiveTui(ctx))` (import from `./utils.js`)
- [x] 2.3 `src/tui.ts`: replace the two existing checks `if (ctx.mode !== "tui" || !ctx.hasUI)` (in `registerAstCommand` around line 67 and `registerAstGainCommand` around line 284) with `if (!isInteractiveTui(ctx))`
- [x] 2.4 Unit tests for `isInteractiveTui`: TUI+hasUI → true; JSON/print/RPC+hasUI → false; TUI without hasUI → false; undefined fields → false

## 3. Verification

- [x] 3.1 `npm run typecheck` against the pi 0.80.2 `.d.ts` is green (requires `upgrade-to-pi-080` merged)
- [x] 3.2 `npm test` is green including the new `isInteractiveTui` cases
- [x] 3.3 Compat smoke test (mocked): `session_start` with `ctx.isProjectTrusted() === false` and missing ast-bro → "project not trusted" notification, no `spawnSync("ast-bro", ["install"])` call, `config.enabled` unchanged
- [x] 3.4 Compat smoke test (mocked): `session_start` with `ctx.isProjectTrusted() === true` and missing ast-bro → existing confirm behaviour (no regression)
- [x] 3.5 Compat smoke test (mocked): older pi stub without the `isProjectTrusted` method → no crash, fallback to the existing behaviour

## 4. Gating

- [x] 4.1 `openspec validate adopt-080-features` is green
- [x] 4.2 Review: no change to tool registrations, interceptors, StatsManager, refactoring tools
- [x] 4.3 Sequencing note: merge **after** `upgrade-to-pi-080` (typecheck against the `runtime-compatibility` capability and the 0.80.2 types)
