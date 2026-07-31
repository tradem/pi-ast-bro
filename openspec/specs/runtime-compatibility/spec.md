# runtime-compatibility

## Purpose

Declares the runtime version ranges (pi-coding-agent and the `ast-bro` CLI) that
pi-ast-bro supports, and the start-up gates that warn or disable the extension
when a range is violated. The semver-range checker used by both gates is
minimal, in-house (no `semver` dependency), and honours compound comparator
ranges with AND semantics.

## Requirements

### Requirement: The extension declares a supported pi-coding-agent version range and warns on mismatch
The extension SHALL declare a supported pi-coding-agent version range (`SUPPORTED_PI_RANGE`) in `src/constants.ts` and check the runtime `VERSION` import against it during `session_start`. When the running pi version falls outside the range, the extension SHALL emit a warning notification (via `ctx.ui.notify(..., "warning")`) wrapped in a `try`/`catch` so that a UI-API mismatch never crashes the extension. The extension SHALL NOT hard-disable itself on a pi-version mismatch (posture: warn, do not disable, because newer pi versions are often backwards-compatible).

Additionally, when the running pi version exposes `ctx.isProjectTrusted()`, the `session_start` auto-installer path SHALL consult it before performing the privileged `ast-bro install` spawn: in an untrusted project the spawn SHALL be skipped and a warning notification emitted instead. This trust gate is **additive** to the existing UI/mode gates; it does not replace them. The trust gate is **session-local**: a refused auto-install SHALL NOT persist `config.enabled = false` (trust is a dynamic property that may change session-live). When `ctx.isProjectTrusted()` is not present on the context (older pi versions), the extension SHALL fall back to the prior behavior (no trust gate) rather than crashing.

#### Scenario: User runs pi 0.83.2 against a caret-pinned `^0.83.0` range
- **WHEN** the extension loads under pi 0.83.2 and `SUPPORTED_PI_RANGE` is `"^0.83.0"`
- **THEN** `satisfiesSemver("0.83.2", "^0.83.0")` returns `true`
- **AND** `session_start` does NOT emit an "outside the tested range" warning notification

#### Scenario: User runs pi 0.84.0 against a caret-pinned `^0.83.0` range
- **WHEN** the extension loads under pi 0.84.0
- **THEN** `satisfiesSemver("0.84.0", "^0.83.0")` returns `false` (0.x caret locks the minor)
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

### Requirement: `satisfiesSemver` parses compound ranges with AND semantics
The semver-range checker `satisfiesSemver(version, range)` SHALL split the range string on whitespace into one or more comparator tokens, evaluate each token independently against the version, and return `true` only if every token is satisfied (logical AND). A caret token (`^...`) SHALL continue to be evaluated by npm-caret semantics. Single-comparator ranges (`">=3.0.0"`, `"<3.2.0"`, `"=1.2.3"`, `"^0.83.0"`) SHALL remain supported and unchanged. The function SHALL NOT add a dependency on the `semver` package (the existing minimal in-house implementation is extended).

#### Scenario: Version inside both bounds of a compound range
- **WHEN** `satisfiesSemver("3.1.0", ">=3.0.0 <3.2.0")` is called
- **THEN** it splits the range into `[">=3.0.0", "<3.2.0"]`
- **AND** returns `true` (3.1.0 satisfies both `>=3.0.0` and `<3.2.0`)

#### Scenario: Version at the excluded upper bound
- **WHEN** `satisfiesSemver("3.2.0", ">=3.0.0 <3.2.0")` is called
- **THEN** it returns `false` (the `<3.2.0` token is not satisfied)

#### Scenario: Version above the upper bound
- **WHEN** `satisfiesSemver("3.5.0", ">=3.0.0 <3.2.0")` is called
- **THEN** it returns `false` (the `<3.2.0` token is not satisfied) — previously this erroneously returned `true` because the upper bound was silently ignored

#### Scenario: Version below the lower bound
- **WHEN** `satisfiesSemver("2.9.0", ">=3.0.0 <3.2.0")` is called
- **THEN** it returns `false` (the `>=3.0.0` token is not satisfied)

#### Scenario: Single-comparator range behavior is preserved
- **WHEN** `satisfiesSemver("0.83.2", "^0.83.0")` is called
- **THEN** the range splits into a single token `["^0.83.0"]`
- **AND** returns `true` (caret semantics unchanged from prior behavior)

#### Scenario: Empty or whitespace-only range is rejected defensively
- **WHEN** `satisfiesSemver("0.83.0", "   ")` or `satisfiesSemver("0.83.0", "")` is called
- **THEN** it returns `false` without throwing

### Requirement: ast-bro CLI version range is enforced including upper bound
The supported `ast-bro` CLI range (`SUPPORTED_AST_BRO_RANGE = ">=3.0.0 <3.2.0"`) SHALL be checked against the installed `ast-bro --version` output during `session_start`. When the installed version falls outside the range, the extension SHALL disable itself (set `config.enabled = false`, persist, emit an error notification) — unlike the pi-version warning gate, the ast-bro gate is a hard disable because a mismatched CLI cannot serve the extension's commands.

#### Scenario: ast-bro 3.1.0 is accepted
- **WHEN** `ast-bro --version` reports `3.1.0`
- **THEN** `satisfiesSemver("3.1.0", ">=3.0.0 <3.2.0")` returns `true`
- **AND** the extension enables its interceptors and tool registrations

#### Scenario: ast-bro 3.2.0 is correctly rejected (regression fix)
- **WHEN** `ast-bro --version` reports `3.2.0`
- **THEN** `satisfiesSemver("3.2.0", ">=3.0.0 <3.2.0")` returns `false` (previously erroneously `true`)
- **AND** the extension emits the "installed ast-bro ... is not supported ... Extension disabled." error notification
- **AND** `config.enabled` is set to `false` and persisted

#### Scenario: ast-bro 3.5.0 is correctly rejected (regression fix)
- **WHEN** `ast-bro --version` reports `3.5.0`
- **THEN** `satisfiesSemver("3.5.0", ">=3.0.0 <3.2.0")` returns `false`
- **AND** the extension disables itself as in the 3.2.0 scenario
