## Context

pi-ast-bro is a project-local extension that, at session start, checks the `ast-bro` CLI availability and — if absent — in TUI mode offers an auto-install (confirmation via `ctx.ui.confirm`, then `spawnSync("ast-bro", ["install"])`; see `src/index.ts:196–240`). This auto-install is a **privileged system operation**: `ast-bro install` downloads and installs system software (the `ast-bro` Rust CLI) onto the user's machine.

Existing gates before the spawn:
1. `ctx.hasUI` — must have a UI
2. `ctx.mode === "tui"` — must be interactive TUI mode
3. `ctx.ui.confirm(...)` — user confirms

**Missing aspect:** the spawn also runs in **untrusted** projects. AGENTS.md §2 sets a strict supply-chain and security posture ("Every dependency is a potential supply-chain attack vector"; "NEVER pass unescaped strings into exec()"); running the auto-install in an untrusted project is inconsistent with that posture — the `ast-bro install` binary originates from PATH and is launched in a context where the user has not even trusted the project.

`ctx.isProjectTrusted()` (available since ~0.79.x on `ExtensionContext`, typecheckable for us once `upgrade-to-pi-080` lands) returns the effective trust decision including temporary trust decisions (e.g. "trust for this session"). That is exactly the missing aspect.

## Goals / Non-Goals

**Goals:**
- Auto-install of `ast-bro` happens **only** in trusted projects (`ctx.isProjectTrusted() === true`); in untrusted projects the spawn is skipped and a clear notification is emitted.
- Existing behaviour in the trusted TUI mode is unchanged (confirm → spawn → success/failure notification).
- The scattered `ctx.mode` checks are consolidated into a helper `isInteractiveTui(ctx)`; no behaviour change, only maintainability.

**Non-Goals (explicitly evaluated, not adopted — rationale per API):**

- **`project_trust` event** (~0.79.x): lets global/CLI extensions make or defer trust decisions. pi-ast-bro is project-local; it has no need to *decide* trust, only to *consult* the effective trust status (for which `ctx.isProjectTrusted()` suffices). Manipulating trust itself would be an overreach into the user's trust decision.
- **`ctx.getSystemPromptOptions()`** (~0.79.x): for extension commands that want to inspect the base system prompt inputs. The `/ast` and `/ast-gain` dashboards render ast-bro statistics and status, they have no need to reach the base system prompt inputs. Low value, adds only complexity.
- **`InputEvent.streamingBehavior`** (~0.79.x): distinguishes idle prompts from mid-stream steers and queued follow-ups. pi-ast-bro does not hook on input events (no `pi.on("input", ...)`); we react to `session_start`, `tool_call` / `tool_result`, `before_agent_start`, `session_shutdown`, `resources_discover` — none of which are input-event-like.
- **`message_end` Override** (~0.79.x): allows replacing finalised assistant messages (e.g. overriding usage/cost). pi-ast-bro does not mutate assistant messages; our instrumentation lives at the tool/interceptor level, not at the message level.
- **`ctx.ui.getEditorComponent()`** (~0.79.x): allows wrapping the configured custom-editor factory. pi-ast-bro has no custom-editor need; we render via `ctx.ui.custom()` in the `/ast` dashboard, which already works.
- **`thinking_level_select` event** (~0.79.x): observe thinking-level switches. No pi-ast-bro use case.
- **`ctx.ui.addAutocompleteProvider()` trigger chars** (~0.79.x): allows trigger chars like `#` / `$` for autocomplete. pi-ast-bro registers no autocomplete provider; no need.

This list is deliberately recorded in the proposal and design — at the next version lift (e.g. 0.81, 0.82) it will be clear which additives were already evaluated and rejected, and only the *new* additives need fresh evaluation.

## Decisions

### Decision 1: `ctx.isProjectTrusted()` as an additional, not replacing, gate

The new check is **additive**, not substitutive: the existing `!ctx.hasUI || ctx.mode !== "tui"` gate stays; `ctx.isProjectTrusted()` is added as a further gate. Rationale: the existing gates secure UI consistency (only TUI can display `confirm`); the trust gate secures the security posture. Both aspects are orthogonal.

### Decision 2: trust refusal does not persist a disable

Unlike the ast-bro compatibility refusal (which persists `config.enabled = false` and switches off the extension until the next start), the trust refusal is a **session-local skip**: `config.enabled` is not persisted to `false`. Rationale: trust is a dynamic property (it can change live during a session); a persistent disable would force the user to manually re-enable the extension once they trust the project. Instead: notification, the extension stays without auto-install this time, and the next `session_start` (e.g. after `/reload` with trust) re-checks.

### Decision 3: helper `isInteractiveTui(ctx)` in `src/utils.ts`

No new file (`src/modeUtils.ts`) — `src/utils.ts` is the right place for small helpers of this kind and keeps the file count constant. Signature: `function isInteractiveTui(ctx: { mode?: string; hasUI?: boolean }): boolean` returning `ctx.hasUI === true && ctx.mode === "tui"`. Loose type annotation, so the helper is callable with partial contexts in tests.

### Decision 4: no adoption of the rejected APIs (see Non-Goals)

The APIs listed in Non-Goals are not adopted. The rationale per API is documented there and serves as an audit trail for future re-evaluation.

## Risks & Mitigations

- **Risk: `ctx.isProjectTrusted()` is not present in older pi versions** (before ~0.79.x). _Mitigation:_ guard via `typeof ctx.isProjectTrusted === "function"` before the call; if the method is absent, fall back to the existing behaviour (no trust gate). Documented in the `runtime-compatibility` spec scenario. Since `upgrade-to-pi-080` lifts the minimum pin to `^0.80.0`, the API is factually always present; the guard is defensive for the case that someone loads the extension against an older pi version manually.
- **Risk: users expect the auto-install even in untrusted projects** (behaviour change). _Mitigation:_ clear notification messaging: "project not trusted; skipping ast-bro auto-install. Trust this project or install ast-bro manually." The UX path stays; only the privileged spawn is withheld.
- **Risk: consolidating the `ctx.mode` checks changes existing behaviour.** _Mitigation:_ the helper is semantically equivalent to the existing inline checks (`hasUI === true && mode === "tui"`); a behaviour change is excluded, only maintainability improves. New unit tests cover the helper.
