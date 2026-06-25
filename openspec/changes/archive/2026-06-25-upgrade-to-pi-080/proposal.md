## Why

pi-coding-agent 0.80.0 / 0.80.1 / 0.80.2 are released. The only extension-relevant behaviour change in 0.80 — the relocation of the pi-ai global API from `@earendil-works/pi-ai` (root) to `@earendil-works/pi-ai/compat` — does **not** affect pi-ast-bro, because we import no symbols from `@earendil-works/pi-ai` (verified: every `@earendil-works/*` import comes from `pi-coding-agent` or `pi-tui`). The extension contract itself (`default function (pi: ExtensionAPI)`, `pi.on(...)`, `pi.registerTool(...)`, `ctx.ui.*`, `ctx.overrideResult`, `ctx.sessionManager`, `VERSION`) is byte-identical between 0.79.8 and 0.80.2.

Nevertheless, two things currently break for 0.80 users:

1. **Dependency pins lock out 0.80.** `package.json` pins `@earendil-works/pi-coding-agent` (peer + dev) and `@earendil-works/pi-tui` (dep) to `^0.79.8`. For 0.x versions the caret range `^0.79.8` grants only patch freedom (i.e. `>=0.79.8 <0.80.0`), so pi 0.80.x does not resolve.
2. **The runtime compatibility gate warns spuriously.** `SUPPORTED_PI_RANGE = "^0.79.8"` in `constants.ts` triggers, on every pi-ast-bro user running pi 0.80.x, the following `session_start` warning: _"pi-ast-bro: pi-coding-agent 0.80.2 is outside the tested range (^0.79.8). Some features may not work as expected."_ — even though the extension is factually compatible.

During investigation a **latent bug in `satisfiesSemver`** was also found (not a 0.80 upgrade requirement, but in the same code path): the function parses only a single comparator. The compound range `SUPPORTED_AST_BRO_RANGE = ">=3.0.0 <3.2.0"` is matched as `op=">="`, `base="3.0.0 <3.2.0"`; the upper bound `<3.2.0` is silently swallowed. An ast-bro version 3.5.0 would erroneously be treated as supported.

## What Changes

- **Lift dependency pins**: `@earendil-works/pi-coding-agent` peer + dev `^0.79.8 → ^0.80.0` (peer) and `^0.80.2` (dev); `@earendil-works/pi-tui` dep `^0.79.8 → ^0.80.2`; `typebox` dep `^1.1.38 → ^1.3.0` (already inside the existing `^1.x` range; the range is raised explicitly). Regenerate `package-lock.json`.
- **Raise `SUPPORTED_PI_RANGE` from `"^0.79.8"` to `"^0.80.0"`** so pi 0.80.x runs without warning and 0.81+ still warns (preserving the existing "newer versions are often backwards-compatible" posture from `constants.ts`). Decision against an explicit upper bound (`>=0.80.0 <0.82.0`) — see design.md.
- **Extend `satisfiesSemver` with compound-range support**: split the range string on whitespace, evaluate every comparator, AND them. This fixes both the (newly-unused but intents-faithful) ast-bro path and the documented contract of the function with compound ranges. No `semver` dependency is added (AGENTS.md §2 forbids arbitrary packages; the existing minimal in-house parser is extended).
- **Add tests**: `satisfiesSemver` unit tests for compound ranges (`">=3.0.0 <3.2.0"`) and the 0.80.x / 0.81.x compatibility cases; a smoke test that `session_start` under pi 0.80.2 does not fire the "outside tested range" warning.
- **Typecheck verification against the 0.80.2 `.d.ts`** as the final gate.

## Capabilities

### New Capabilities
- `runtime-compatibility`: The extension declares a supported pi-coding-agent version range and checks it at startup; the check logic is semver-correct (including compound ranges with upper bounds) and warns rather than disables on forward incompatibility.

## Impact

- `package.json` — pins for `pi-coding-agent` (peer + dev), `pi-tui`, `typebox`.
- `package-lock.json` — regenerated.
- `src/constants.ts` — `SUPPORTED_PI_RANGE` value.
- `src/utils.ts` — `satisfiesSemver` implementation (compound-range AND logic).
- `tests/` — new `satisfiesSemver` cases plus smoke/compat tests.
- No change to `src/index.ts` logic (the warn-branch remains; only the range constant changes).
- Documentation: README mentions the supported pi range; the comment in `AGENTS.md` about the "pi moves quickly" posture remains valid.
