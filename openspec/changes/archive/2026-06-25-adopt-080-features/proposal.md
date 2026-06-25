## Why

pi 0.80 (and the 0.79.x additives that were not yet reachable under the prior `^0.79.8` pin) introduce several optional extension APIs, partially valuable for pi-ast-bro. Since the pi-0.80 pin bump (`upgrade-to-pi-080`) is what makes these APIs typecheckable at all, this change is the natural follow-up: targeted, value-driven adoption of the features that bring real benefit, and **explicit non-adoption** of the features that bring no value to our surface (so the reasoning is preserved and does not have to be re-evaluated at the next version lift).

Specifically identified, 0.80.2-reachable APIs and their disposition for pi-ast-bro:

| API | Introduced | Value for pi-ast-bro | Decision |
|---|---|---|---|
| `ctx.isProjectTrusted()` | ~0.79.x | **High** — auto-installer gate | ✅ adopt |
| `project_trust` event | ~0.79.x | Low — we are project-local | ❌ do not adopt |
| `ctx.mode` | ~0.79.x | Already used | ✅ consolidate (use case below) |
| `ctx.getSystemPromptOptions()` | ~0.79.x | Low — no prompt-mutation need | ❌ do not adopt |
| `InputEvent.streamingBehavior` | ~0.79.x | None — we do not hook on Input | ❌ do not adopt |
| `message_end` Override | ~0.79.x | None — no assistant-message mutation need | ❌ do not adopt |
| `ctx.ui.getEditorComponent()` | ~0.79.x | None — no custom-editor need | ❌ do not adopt |
| `thinking_level_select` event | ~0.79.x | None — no thinking-level-hook need | ❌ do not adopt |
| `ctx.ui.addAutocompleteProvider()` trigger chars | ~0.79.x | None — no slash-command autocomplete triggers | ❌ do not adopt |

## What Changes

- **`ctx.isProjectTrusted()` as an auto-installer gate in `session_start`**: before the `ast-bro install` `spawnSync` call (a privileged system operation: downloads/installs system software via `ast-bro install`), the extension, in addition to the existing `!ctx.hasUI || ctx.mode !== "tui"` gate, also checks `ctx.isProjectTrusted()`. In an **untrusted** project, no auto-install runs — the extension disables itself with a clear notification ("project not trusted; skipping ast-bro auto-install; install manually") rather than running the privileged spawn behind a plain confirm. The user can install ast-bro manually or trust the project.
- **`ctx.mode` consolidation**: the two existing scattered checks (`src/index.ts` `ctx.mode !== "tui"` and `src/tui.ts` `ctx.mode !== "tui" || !ctx.hasUI`) are consolidated into a single helper `isInteractiveTui(ctx)`, so future mode handling (e.g. JSON/print/RPC-mode skip in logging paths) is maintained in one place.

Explicitly **not** part of this change (rationale in design.md): `project_trust` event, `ctx.getSystemPromptOptions()`, `InputEvent.streamingBehavior`, `message_end` Override, `ctx.ui.getEditorComponent()`, `thinking_level_select` event, autocomplete trigger chars.

## Capabilities

### Modified Capabilities
- `runtime-compatibility` (newly created in `upgrade-to-pi-080`): the auto-installer protection is extended by the project-trust aspect — adds a "privileged-spawn-skipped-if-untrusted" requirement alongside the existing "warn-vs-disable" specification.

## Impact

- `src/index.ts` — the `session_start` auto-install branch: an additional `ctx.isProjectTrusted()` check before `ctx.ui.confirm` / `spawnSync`.
- `src/utils.ts` (or a new `src/modeUtils.ts`) — helper `isInteractiveTui(ctx)`.
- `src/tui.ts` — the two existing `ctx.mode` checks call the new helper (no behaviour change, consolidation only).
- No change to tool registrations, interceptors, or StatsManager.
- Depends on `upgrade-to-pi-080` (the APIs are only typecheckable against the 0.80.2 types; against 0.79.8 `ctx.isProjectTrusted` is not in the type).
