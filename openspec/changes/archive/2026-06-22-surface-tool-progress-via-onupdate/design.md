## Context

`make-ast-bro-tool-calls-async` (Spec 1) eliminates the event-loop freeze across the pi-ast-bro tools. Once shipped, the TUI spinner stays animated during a multi-second `analyze_ast_impact` or `analyze_ast_search` call — but the user has no textual indication of *which phase* the tool is in. They see a spinning cursor, not "augmenting snippet 3/12".

The pi SDK provides the mechanism: every `execute()` receives an `onUpdate: AgentToolUpdateCallback<TDetails> | undefined` parameter. The SDK contract (verified in `@earendil-works/pi-agent-core/dist/types.d.ts:322`) is:

```ts
export type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;
```

The flow (traced end-to-end through `dist/core/agent-session.js:419` → `dist/modes/interactive/interactive-mode.js:2344`) is:

```
execute() calls onUpdate(partialResult)
   │
   ▼  agent-session re-emits "tool_execution_update" with partialResult
   │
   ▼  interactive-mode.js:
   │     component.updateResult({ ...event.partialResult, isError:false }, true /*isPartial*/)
   │     this.ui.requestRender()
   │
   ▼  TUI renders the partial tool result, REPLACING the previous partial display
      (per rpc.md: "partialResult contains the accumulated output so far,
       not just the delta")
   │
   ✘  Never reaches the LLM context stream. Only the final execute() return
      value is inserted into the tool_result message that the LLM sees.
```

The pi built-in `bash` tool (`dist/core/tools/bash.js:190-260`) is the canonical reference for using this callback. Its pattern:

```
onUpdate({ content:[], details:undefined })          ← initial empty "started"
onData → output.append(data)
        → scheduleOutputUpdate() (throttled, BASH_UPDATE_THROTTLE_MS = 100ms)
            scheduleOutputUpdate():
              if (Date.now() - lastUpdateAt < THROTTLE) set/update timer
              else emitOutputUpdate() immediately
            emitOutputUpdate():
              snapshot = output.snapshot()
              onUpdate({ content:[{type:"text", text:snapshot.content}],
                         details:{ truncation, fullOutputPath } })
onExit → finalize, return final result
```

Three things to copy from bash:
1. **Throttle scheduler** — coalesces rapid calls so the TUI isn't flooded with render requests.
2. **Accumulated, not delta** — each onUpdate contains the full current snapshot (we will use accumulated status text, since the bash partial-replace semantic means deltas would lose history).
3. **Initial empty start** — `{ content: [], details: undefined }` (or in our case, the first real phase emission serves as the start marker).

## Goals / Non-Goals

**Goals:**
- Surface phase-based status updates through `onUpdate` during multi-second tool invocations.
- Define a small, structured `details` schema (`{ phase, current?, total? }`) so future TUI affordances can be built on machine-readable phase data.
- Add a configurable throttle (`progressUpdateThrottleMs`, default 100ms) to prevent update flooding without losing meaningful phase transitions on slow tools.
- Make the contract clear that `partialResult` SHALL NOT enter the LLM context — this is a pure UX affordance.
- Fix the type error (`_onUpdate: unknown` → `onUpdate: AgentToolUpdateCallback<...> | undefined`).

**Non-Goals:**
- **Recurring heartbeat during the `ast-bro` subprocess.** For now, phases are emitted at transitions only (before spawn, after spawn pre-augment, per-batch in augmenter). A timed "still querying…" heartbeat during a 10-second `ast-bro context` call is a future enhancement; requires wiring a periodic timer into the async spawn wrapper added by Spec 1.
- **Partial-output streaming (the bash "see live stdout" model).** Option B was considered and rejected. Our tools return JSON or filtered snippets; partial-rendering incomplete JSON in the TUI is unhelpful. We emit status *text* only.
- **Sending partial results to the LLM.** The `onUpdate` payload never enters the LLM context. This is an invariant, not a goal to achieve — it's a property of pi's design.
- **Removing or modifying `ctx.ui.notify`.** Toast notifications (used in `recordSearchSavings`) are a separate channel and SHALL coexist with onUpdate.

## Decisions

1. **Status text in `content`, structured `details` alongside.** Each `onUpdate` call passes `{ content: [{ type: "text", text: "<human-readable status>" }], details: { phase, current?, total? } }`. Rationale: today only `content[0].text` is rendered by pi's default tool renderer, so the human-readable status must live there. The `details` schema is forward-looking — a future TUI custom render (via `renderResult`) could consume `details.phase`/`details.current` for richer affordances without changing the wire format.

2. **No recurring heartbeat during spawn.** For this change, `onUpdate` is fired only at phase transitions: `starting` before spawn, `querying` immediately after the spawn promise is established (or as the sole phase for non-augmenting tools), and `augmenting` after the subprocess closes for tools that augment. A timed heartbeat during a long spawn would require wiring a periodic timer inside `runAstBroAsync` (from Spec 1) and is a real but future enhancement; not in scope.

3. **Standard phase enum, per-tool subset.** Phases are named string constants:
   - `starting` — every tool emits this before invoking `ast-bro`.
   - `querying` — every tool emits this once the spawn is in flight. For non-augmenting tools, this is the latest phase.
   - `augmenting` — only `analyze_ast_impact`, `find_implementations`, `analyze_ast_search`, `analyze_ast_map` emit this, with `current`/`total` tracking progress. The final emission has `current === total` and indicates augmentation is complete (no separate `finalizing` phase).

4. **Throttle = timeout-based scheduler, default 100ms, configurable.** A new `src/utils.ts` helper `createProgressThrottle(throttleMs, onUpdate)` returns a `progress(partialResult)` function that coalesces calls: if the last emit was within `throttleMs`, the latest payload is held and a `setTimeout` is set/updated; on timer fire or on subsequent call past the window, the held payload is emitted. Rationale: direct port of bash's `scheduleOutputUpdate` pattern; 100ms matches pi's empirical default so behavior is consistent across tools. The throttle is scoped per-`execute()`-invocation (created fresh each call), so it does not need invalidation logic beyond the existing "calls after the tool promise settles are ignored" guarantee.

5. **Per-tool phase set is explicit in spec deltas.** The cross-cutting capability `ast-tool-progress` defines the mechanism; each tool's spec delta enumerates *which* of the standard phases that specific tool emits. This avoids ambiguity (e.g. `analyze_ast_context` only emits `starting` + `querying`, never `augmenting`).

6. **`progressUpdateThrottleMs` is a persisted setting, surfaced in `/ast`.** Default 100ms; minimum validated (reject < 0; minimum effective 0 means "no throttle"). Rationale: matches the existing settings model (`cfg.json`-backed, surfaced in `/ast`); lets users tune if they find the default too aggressive (e.g. for very fast tool chains on small repos where all updates are suppressed) or too noisy.

7. **`partialResult` non-LLM-invariant is documented as a requirement, not just a design note.** Even though it's a property of pi's design (not something we implement), stating it as a SHALL in the spec prevents future contributors from misusing `onUpdate` to "send status to the LLM" — a tempting but impossible misuse that would silently no-op.

## Risks / Trade-offs

- **Suppression of the sole `starting`→`querying` transition on a fast tool** — if the throttle is set very high (e.g. 5000ms) and a tool completes in 200ms, only the *final* phase is emitted. Acceptable: the spinner animates throughout regardless (Spec 1), so the tool is visibly active; only the textual phase label is curtailed. Documented as expected behavior.
- **Verbose vs. terse phases** — three phases (`starting` / `querying` / `augmenting`) could feel noisy on fast tools. The throttle absorbs most of this: if all three fire within 100ms, only the last surfaces. The schema also allows future TUI custom renderers to collapse phases.
- **Phases mislabeled** — risk: an `augmenting` emission in a tool that doesn't actually augment (e.g. accidentally emitting it in `analyze_ast_context`). Mitigated by per-tool phase sets in spec deltas and tests that assert the exact phase sequence per tool.
- **Throttle per-execution scope** — the throttle is created fresh per `execute()` invocation. No need to invalidate between calls (the SDK ignores `onUpdate` calls after the tool promise settles). This avoids the bash tool's `clearUpdateTimer` cleanup logic, which is bash-specific.
- **No streaming during spawn** — a user staring at a 15-second `ast-bro context` call sees only "querying ast-bro context…" the entire time. Acknowledged limitation; future heartbeat enhancement would address it without changing this spec (an additive `querying` heartbeat is non-breaking).
