## MODIFIED Requirements

### Requirement: The extension declares a supported pi-coding-agent version range and warns on mismatch
The extension SHALL declare a supported pi-coding-agent version range (`SUPPORTED_PI_RANGE`) in `src/constants.ts` and check the runtime `VERSION` import against it during `session_start`. When the running pi version falls outside the range, the extension SHALL emit a warning notification (via `ctx.ui.notify(..., "warning")`) wrapped in a `try`/`catch` so that a UI-API mismatch never crashes the extension. The extension SHALL NOT hard-disable itself on a pi-version mismatch (posture: warn, do not disable, because newer pi versions are often backwards-compatible).

Additionally, when the running pi version exposes `ctx.isProjectTrusted()`, the `session_start` auto-installer path SHALL consult it before performing the privileged `ast-bro install` spawn: in an untrusted project the spawn SHALL be skipped and a warning notification emitted instead. This trust gate is **additive** to the existing UI/mode gates; it does not replace them. The trust gate is **session-local**: a refused auto-install SHALL NOT persist `config.enabled = false` (trust is a dynamic property that may change session-live). When `ctx.isProjectTrusted()` is not present on the context (older pi versions), the extension SHALL fall back to the prior behavior (no trust gate) rather than crashing.

#### Scenario: User runs pi 0.80.2 against a caret-pinned `^0.80.0` range
- **WHEN** the extension loads under pi 0.80.2 and `SUPPORTED_PI_RANGE` is `"^0.80.0"`
- **THEN** `satisfiesSemver("0.80.2", "^0.80.0")` returns `true`
- **AND** `session_start` does NOT emit an "outside the tested range" warning notification

#### Scenario: User runs pi 0.81.0 against a caret-pinned `^0.80.0` range
- **WHEN** the extension loads under pi 0.81.0
- **THEN** `satisfiesSemver("0.81.0", "^0.80.0")` returns `false` (0.x caret locks the minor)
- **AND** `session_start` emits exactly one warning notification naming the running version and the supported range

#### Scenario: Runtime without `ctx.ui.notify` support
- **WHEN** the running pi version's UI context does not support `notify`
- **THEN** the thrown error is swallowed by the surrounding `try`/`catch`
- **AND** the extension continues to load (no crash, no hard-disable)

#### Scenario: ast-bro missing in an untrusted project skips the privileged install spawn
- **WHEN** `session_start` finds `ast-bro` missing AND the context responds to `isProjectTrusted()` with `false`
- **THEN** the extension does NOT call `spawnSync("ast-bro", ["install"])` (and does NOT call `ctx.ui.confirm` to prompt for it)
- **AND** `session_start` emits a warning notification: "project not trusted; skipping ast-bro auto-install. Trust this project or install ast-bro manually."
- **AND** `config.enabled` is NOT persisted as `false` (the refusal is session-local)
- **AND** `session_start` returns early without attempting the install

#### Scenario: ast-bro missing in a trusted project retains the existing confirm→install flow
- **WHEN** `session_start` finds `ast-bro` missing AND `isProjectTrusted()` returns `true` AND the mode is interactive TUI
- **THEN** the extension proceeds to the existing `ctx.ui.confirm` prompt and, on user confirmation, runs `spawnSync("ast-bro", ["install"])`
- **AND** on success the extension caches-clears ast-bro info, prepares the session seed, and emits the success notification (unchanged from prior behavior)

#### Scenario: Older pi runtime without `isProjectTrusted` falls back gracefully
- **WHEN** the running pi version's context does not expose `isProjectTrusted()` (method is `undefined`)
- **THEN** the extension skips the trust check (guarded by `typeof ctx.isProjectTrusted === "function"`)
- **AND** falls back to the prior UI/mode-gated confirm→install flow
- **AND** does NOT crash

### Requirement: `isInteractiveTui(ctx)` consolidates the interactive-TUI mode gate
The extension SHALL provide a single helper `isInteractiveTui(ctx)` (in `src/utils.ts`) returning `ctx.hasUI === true && ctx.mode === "tui"`, and the `session_start` auto-install UI gate (`src/index.ts`) and the `/ast` and `/ast-gain` command guards (`src/tui.ts`) SHALL use this helper instead of inline `ctx.mode !== "tui" || !ctx.hasUI` checks. The helper's semantics SHALL be exactly equivalent to the inline checks it replaces (no behavior change); its purpose is to make future mode-aware logic (e.g. JSON/print/RPC-mode skips in logging paths) maintainable in one place.

#### Scenario: Interactive TUI session is recognized
- **WHEN** `isInteractiveTui(ctx)` is called with `ctx.hasUI === true` and `ctx.mode === "tui"`
- **THEN** it returns `true`

#### Scenario: Non-TUI mode (JSON, print, RPC) is recognized as non-interactive
- **WHEN** `isInteractiveTui(ctx)` is called with `ctx.hasUI === true` and `ctx.mode === "json"` (or `"print"` or `"rpc"`)
- **THEN** it returns `false`

#### Scenario: TUI mode without UI is recognized as non-interactive
- **WHEN** `isInteractiveTui(ctx)` is called with `ctx.mode === "tui"` and `ctx.hasUI === false`
- **THEN** it returns `false`

#### Scenario: Undefined mode/hasUI fields are treated as non-interactive
- **WHEN** `isInteractiveTui(ctx)` is called with `ctx.mode` or `ctx.hasUI` being `undefined`
- **THEN** it returns `false` (defensive; never throws)
