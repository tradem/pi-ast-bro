## 1. Lift devDependency pins

- [x] 1.1 `package.json` `devDependencies["typescript"]` `^5.9.3` → `^6.0.3`
- [x] 1.2 `package.json` `devDependencies["@types/node"]` `^24.12.4` → `^26.0.1`
- [x] 1.3 Regenerate `package-lock.json` (`npm install`) and commit

## 2. Typecheck verification

- [x] 2.1 Run `npm run typecheck` (`tsc --noEmit`); collect errors
- [x] 2.2 On strictness/default regression, targeted adjustment (smallest diff): either a Source fix in `src/` or a `tsconfig.json` addition; each fix as its own commit for root-cause attribution
- [x] 2.3 No `// @ts-ignore` or `// @ts-expect-error` as a "quick fix" — root-cause fix required

## 3. Test verification

- [x] 3.1 Run `npm test` (`vitest --run`); runs green under TS 6 / `@types/node` 26
- [x] 3.2 If Vitest emits TS-6-specific transform errors: inspect `vitest.config.ts`; if needed bump a Vitest patch version (within `^4.1.9`)

## 4. Sequencing and documentation

- [x] 4.1 Ensure `upgrade-to-pi-080` is merged before this change (typecheck against 0.80.2 types, not 0.79.8). If not possible, document a typecheck double-pass.
- [x] 4.2 Changelog/release-note hint: "Dev toolchain lifted to TS 6 + @types/node 26; no runtime impact."

## 5. Gating

- [x] 5.1 `openspec validate bump-typescript-and-types` is green
- [x] 5.2 Review: no `src/` source change other than documented TS 6 strictness fixes; no runtime/API change
