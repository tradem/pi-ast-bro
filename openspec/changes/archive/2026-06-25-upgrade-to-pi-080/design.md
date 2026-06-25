## Context

pi-ast-bro is a pi extension that typechecks at build/runtime time against `@earendil-works/pi-coding-agent` and honours its `ExtensionAPI` contract. The extension declares two supported ranges in `src/constants.ts`:

- `SUPPORTED_PI_RANGE = "^0.79.8"` — checked in `src/index.ts` `session_start` via `satisfiesSemver(VERSION, SUPPORTED_PI_RANGE)`; on mismatch only a warning notification is emitted (no disable).
- `SUPPORTED_AST_BRO_RANGE = ">=3.0.0 <3.2.0"` — checked against the installed `ast-bro` CLI version; on mismatch the extension disables itself.

`satisfiesSemver` (`src/utils.ts`) is a deliberately minimal in-house parser (no `semver` dependency, per AGENTS.md §2). It implements npm caret semantics correctly (for 0.x: patch freedom, i.e. `^0.79.8` → `>=0.79.8 <0.80.0`), **but parses only a single comparator** per range string. The `opMatch` regex `^(>=|>|<=|<|=)?\s*(.+)$` matches `">=3.0.0 <3.2.0"` as `op=">="`, `base="3.0.0 <3.2.0"`; the trailing `<3.2.0` is turned into non-numbers by `parseInt` and never re-validated. Result: the ast-bro upper bound was never effective; `ast-bro 3.5.0` would erroneously be treated as supported.

0.80 release situation: the only extension-relevant 0.80 changelog entry is

> pi-ai's old global API (`stream`/`complete`/... / `getEnvApiKey`, ...) moved off the `@earendil-works/pi-ai` root entrypoint to `@earendil-works/pi-ai/compat`. Extensions are not affected at runtime: the extension loader resolves the pi-ai root to the compat entrypoint (a strict superset), so existing extensions keep working unchanged.

pi-ast-bro imports **no** symbols from `@earendil-works/pi-ai` (verified via grep over `src/`). Consequently the 0.80 source migration is a no-op for us. The remaining 0.80 additives (`ctx.isProjectTrusted`, `InputEvent.streamingBehavior`, `message_end` override, `thinking_level_select`, `Ctrl+J` newline, `pi update --all`) are optional and are out of scope for this change; adoption is tracked in a separate `adopt-080-features` change.

Already used since 0.79.8: `CONFIG_DIR_NAME` (added in 0.79.7) — stable in 0.80.2.

## Goals / Non-Goals

**Goals:**
- pi 0.80.0–0.80.2 run without the "outside tested range" warning.
- Dependency pins allow resolution of pi 0.80.x and pi-tui 0.80.x.
- `satisfiesSemver` honours documented compound ranges correctly (the upper bound `<3.2.0` is enforced).
- `satisfiesSemver` behaviour is covered by unit tests against compound, caret, and 0.80.x / 0.81.x cases.
- The typecheck passes against the 0.80.2 `.d.ts`.

**Non-Goals:**
- Adopting new 0.80 APIs (`ctx.isProjectTrusted`, `message_end` override, etc.) — separate change `adopt-080-features`.
- Bumping `typescript` or `@types/node` — separate change `bump-typescript-and-types`.
- Hard-disabling on out-of-range pi versions (posture stays: warn, do not disable).
- Introducing the `semver` package — forbidden by AGENTS.md §2; the in-house parser is extended.
- Changing the `SUPPORTED_AST_BRO_RANGE` value itself (only the parser correctness).

## Decisions

### Decision 1: Range shape — caret `^0.80.0` over explicit window `>=0.80.0 <0.82.0`

**Decided:** caret `^0.80.0`.

| Aspect | Caret `^0.80.0` | Explicit window `>=0.80.0 <0.82.0` |
|---|---|---|
| Matches the existing `constants.ts` posture ("newer versions are often backwards-compatible") | ✅ | ⚠️ less so |
| Compatible with the current single-comparator parser | ✅ | ❌ (requires fixing `satisfiesSemver` first) |
| Warns on 0.81+ | ✅ (caret locks 0.x minor) | ✅ |
| Upper bound enforced | ❌ (none) | ✅ |
| Consistent with `SUPPORTED_AST_BRO_RANGE` shape | ❌ (ast-bro uses compound) | ✅ |

The caret form is more conservative (warns earlier), matches the documented posture, and requires no parser change for the pi path. The `satisfiesSemver` fix happens anyway, because (a) the compound-range capability makes the `SUPPORTED_AST_BRO_RANGE` documentation true and (b) a future decision for explicit windows is possible without further parser work. We consciously accept that the pi upper bound is not hard-enforced — that is the same posture as before 0.80.

### Decision 2: `satisfiesSemver` — compound AND rather than a separate comparator list

The range string is split on whitespace (`s.split(/\s+/)`); each token is evaluated through the existing single-comparator path; the overall result is the AND of all tokens. Caret (`^`) remains allowed as a single-token construct (caret plus further comparators in one range is not standard in npm; we do not support it, but we do not throw — a `^` token evaluates itself correctly, and a following token would be a separate comparator to AND against, which is harmless).

Prerelease/build metadata: existing behaviour (`+...` strip, no prerelease semantics) is unchanged — pi releases and ast-bro releases do not use prerelease tags in the checked strings.

### Decision 3: the warn-branch in `session_start` is unchanged

No refactor of `src/index.ts`. Only the constant value in `constants.ts` changes; the warn path (try/catch around `ctx.ui.notify`) is unchanged, because the 0.80.2 API is stable and the `ctx.ui.notify` call is identical between 0.79 and 0.80.

### Decision 4: no test against a real pi binary in CI

Unit tests mock `VERSION` and `satisfiesSemver` inputs directly. A smoke test that loads the extension against a real pi 0.80.2 is documented (manual pre-merge gate) but is not part of the automated vitest suite (it would require a pi install in the test env).

## Risks & Mitigations

- **Risk: pi-tui 0.80.x changes the surface of `Container` / `SettingsList` / `SettingItem`.** _Mitigation:_ quick diff of the pi-tui 0.79.8 → 0.80.2 `.d.ts` for exactly those three symbols before merge; the typecheck catches structural breaks anyway.
- **Risk: the `satisfiesSemver` compound change behaves differently for existing single-comparator inputs.** _Mitigation:_ existing unit tests stay green (a single-comparator string is a one-element split); new cases cover compound and upper-bound edge cases.
- **Risk: users with `ast-bro 3.2.x` are suddenly disabled after the parser fix (previously tolerated).** _Mitigation:_ this is correct behaviour per the `constants.ts` comment ("3.2.x may introduce breaking changes"); it is an intended break with documented audit value. Mention it in the README upgrade notes before merge.
