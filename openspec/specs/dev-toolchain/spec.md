# dev-toolchain Specification

## Purpose
This capability documents the dev-toolchain gate for the pi-ast-bro extension: the project SHALL typecheck (`tsc --noEmit`) and test (`vitest --run`) green against its pinned `typescript` and `@types/node` `devDependencies`. It constrains only the typecheck/test gate; it does not affect the runtime-loaded extension (which is compiled by jiti independently of the locally installed `typescript` package).
## Requirements
### Requirement: The project typechecks green against its pinned TypeScript and Node type declarations
The `devDependencies` for `typescript` and `@types/node` SHALL be pinned to caret ranges that the project is known to typecheck green against. Running `npm run typecheck` (`tsc --noEmit`) against the installed `typescript` and `@types/node` versions SHALL produce no errors. A Major bump of either dependency SHALL only land once the typecheck is confirmed green; if a TypeScript-Major-Strictness regression surfaces, the fix SHALL be a targeted Source- or `tsconfig.json`-adjustment (root-cause), not a downgrade or a suppression (`// @ts-ignore` / `// @ts-expect-error` SHALL NOT be introduced to mask typecheck regressions).

This requirement is intentionally narrow: it constrains only the typecheck gate. It does NOT prescribe specific TypeScript-or-`@types/node`-versions, and it does NOT affect the runtime-loaded extension (which is compiled by jiti independently of the locally installed `typescript` package).

#### Scenario: Typecheck passes after a TS/types major bump
- **WHEN** `typescript` is bumped to `^6.0.3` and `@types/node` to `^26.0.1` in `devDependencies`
- **THEN** `npm install` resolves both packages
- **AND** `npm run typecheck` exits with code 0
- **AND** no `// @ts-ignore` or `// @ts-expect-error` comments were added to make the typecheck pass

#### Scenario: Typecheck regression from a TS-6 strictness change
- **WHEN** TS-6 default-`lib` or stricter flow analysis produces new typecheck errors after bumping `typescript` to `^6.0.3`
- **THEN** the resolution is a targeted Source-Fix in `src/` or a minimal `tsconfig.json` addition (documented per-fix)
- **AND** the `typescript` pin is NOT reverted to a 5.x version to make the typecheck pass
- **AND** no `// @ts-ignore` / `// @ts-expect-error` is introduced to silence the new error

### Requirement: The test suite runs green under the pinned dev toolchain
The Vitest test suite (`npm test`) SHALL run green under the installed `typescript` and `@types/node` devDependency versions. If a `typescript`/`@types/node` Major bump causes Vitest transform or type-resolution failures, the fix SHALL be a Vitest configuration adjustment or a Vitest minor/patch bump within the existing `^4.1.9` range, not a revert of the `typescript` or `@types/node` pin.

#### Scenario: Vitest suite passes after the TS/types bump
- **WHEN** `typescript` is bumped to `^6.0.3` and `@types/node` to `^26.0.1`
- **THEN** `npm test` (`vitest --run`) exits with code 0
- **AND** no test in `tests/` was skipped, `.skip`-marked, or deleted to make the suite pass

#### Scenario: Vitest transform failure under TS 6
- **WHEN** Vitest fails to transform or type-resolve under the new `typescript` version
- **THEN** the fix is an adjustment to `vitest.config.ts` or a patch bump of `vitest` within `^4.1.9`
- **AND** the `typescript` pin is NOT reverted to make the suite pass
