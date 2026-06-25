## Context

pi-ast-bro typechecks at build time via `tsc --noEmit` (script `typecheck` in `package.json`) against the `@earendil-works/pi-coding-agent` `.d.ts`. The TypeScript version (`^5.9.3`) and `@types/node` (`^24.12.4`) are devDependencies; they do **not** influence the runtime-loaded extension (jiti compiles TS on the fly independently of the locally installed `typescript` package). Meaning: this bump is pure toolchain hygiene with no runtime risk.

Latest situation (at creation time): `typescript` 6.0.3, `@types/node` 26.0.1. Both are major bumps:

- **TS 5 → 6**: expected levers: stricter control-flow analysis, changed default `lib` composition, possibly new mandatory `compilerOptions`. Concrete breaking items must be found through the typecheck, not prognosticated from the changelog.
- **`@types/node` 24 → 26**: `@types/node` is historically very compatible across majors; risk is low because pi-ast-bro uses only stable Node APIs (verified: `grep -rh "from \"node:" src/`). Main effect: avoid type friction with TS 6 (TS 6 generally expects `@types/node` 25+).

## Goals / Non-Goals

**Goals:**
- Lift `typescript` and `@types/node` to a TS-6-compatible, current major version.
- `tsc --noEmit` is green after the bump.
- `vitest --run` is green after the bump (Vitest 4 is TS 6-compatible).
- Lockfile refresh.

**Non-Goals:**
- Adopting TS-6-exclusive language features (e.g. new syntax) — the code stays TS-5-compatibly readable.
- Bumping `vitest` (already latest 4.1.9) or `typebox` (part of `upgrade-to-pi-080`).
- Bumping the `@earendil-works/*` runtime deps — owned by `upgrade-to-pi-080`.
- Switching to an alternative typechecker (e.g. `tsgo`).

## Decisions

### Decision 1: Joint bump of TS 6 + `@types/node` 26 in one change

TS 6 and `@types/node` 26 are coherent (both "modern", TS 6 expects newer `@types/node`). Single bumps would be incoherent (TS 6 + `@types/node` 24 can cause type friction). Hence a joint change.

### Decision 2: Caret pins (`^6.0.3` / `^26.0.1`) over pinned versions

Consistent with the existing pinning posture in the repo (all dev and runtime pins use caret). Allows future patch/minor updates without a change, without major bumps.

### Decision 3: Sequence after `upgrade-to-pi-080`

Recommended merge order: `upgrade-to-pi-080` before `bump-typescript-and-types`. Reason: TS 6 with `@types/node` 26 typechecks cleanest against the 0.80.2 `.d.ts`; a TS 6 pin against 0.79.8 types would only validate an intermediate version. Not technically enforced (no hard dependency), only documented as a sequencing hint.

### Decision 4: No preemptive `tsconfig.json` change

TS 6 may bring default changes; `tsconfig.json` (currently minimal: `strict: true` + `module` / `target` settings) is only adjusted if a concrete typecheck error demands it. No speculative `compilerOptions` addition.

## Risks & Mitigations

- **Risk: TS 6 strictness regression throws typecheck errors.** _Mitigation:_ tasks.md contains an explicit typecheck-pass task; on errors, targeted small Source-/`tsconfig`-adjustment (no TS downgrade, no `// @ts-ignore`).
- **Risk: `@types/node` 26 type conflict with TS 6 strictness.** _Mitigation:_ low; only stable APIs in use. If a conflict surfaces it is isolated as a visible type error and fixable.
- **Risk: Vitest 4 incompatible with TS 6 (config or transform side).** _Mitigation:_ Vitest 4.1.9 is current and TS-6-compatible per Vitest release notes; on runtime test failures the "test run" task is the first failure indicator.
- **No runtime risk**: dev-only; the loaded extension under pi uses jiti (independent of the `typescript` package), so even a broken TS bump would not touch the running extension — only the typecheck gate.
