## Why

The direct `devDependencies` `typescript` (`^5.9.3`) and `@types/node` (`^24.12.4`) trail a major version behind their respective latest (`typescript` 6.0.3, `@types/node` 26.0.1). Both are `devDependencies` only (typecheck and build-time; no runtime effect on the loaded extension). Caret binds the major, so `npm install` stays on 5.9.x / 24.x without an explicit lift.

This change is intentionally **decoupled from the pi-0.80 upgrade (`upgrade-to-pi-080`)**: a TS major bump (5→6) carries its own breaking changes (notably `--moduleResolution` default shifts, adjusted `lib` sets, stricter control-flow analysis) that require an isolated typecheck + test pass. Mixing it with the pi bump would make a typecheck regression's root cause (pi types vs. TS strictness) ambiguous to attribute. Both bumps are coherent (TS 6 + `@types/node` 26 form a "modern" set) and are lifted together in one change.

Not in scope: `vitest` (`^4.1.9`, already on latest), `typebox` (`^1.x`, falls to 1.3.0 as part of `upgrade-to-pi-080`), the `@earendil-works/*` packages (also in `upgrade-to-pi-080`).

## What Changes

- **`typescript` `^5.9.3` → `^6.0.3`** in `devDependencies`. TS 6 is a major; care-typecheck required.
- **`@types/node` `^24.12.4` → `^26.0.1`** in `devDependencies`. Dev-only; we use only stable Node APIs (`node:fs`, `node:child_process`, `node:path`, `node:url`, `import.meta.url`, `AbortSignal`, `Buffer.byteLength`).
- Lockfile refresh (`package-lock.json`).
- Typecheck gate against TS 6; on typecheck regression, targeted fixes (no downgrade).

## Capabilities

### New Capabilities
- `dev-toolchain`: Documents that the project typechecks and tests green against the pinned `typescript` / `@types/node` versions, with a no-suppression rule (no `// @ts-ignore` to mask regressions). Operationalises AGENTS.md §1 ("Strict TypeScript, no `any`") for the typecheck gate.

## Impact

- `package.json` — two `devDependencies` pins.
- `package-lock.json` — regenerated.
- Possibly `tsconfig.json` — in case a TS 6 default changes (e.g. a mandatory `moduleResolution`); targeted adjustment only, not preemptive.
- No `src/` source change (unless a TS 6 strictness error forces a small adjustment, documented per fix in the change).
- No `tests/` change.
- Sequencing: ideally merged **after** `upgrade-to-pi-080`, so the TS 6 typecheck runs against the 0.80.2 types (otherwise double typecheck effort). Order is documented, not technically enforced.
