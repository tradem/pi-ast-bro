## 1. Lift dependency pins

- [x] 1.1 `package.json` `peerDependencies["@earendil-works/pi-coding-agent"]` `^0.79.8` → `^0.80.0`
- [x] 1.2 `package.json` `devDependencies["@earendil-works/pi-coding-agent"]` `^0.79.8` → `^0.80.2`
- [x] 1.3 `package.json` `dependencies["@earendil-works/pi-tui"]` `^0.79.8` → `^0.80.2`
- [x] 1.4 `package.json` `dependencies["typebox"]` `^1.1.38` → `^1.3.0`
- [x] 1.5 Regenerate `package-lock.json` (`npm install`) and commit
- [x] 1.6 Quick diff of the pi-tui 0.79.8 → 0.80.2 `.d.ts` for `Container`, `SettingsList`, `SettingItem` (verify surface compatibility)

## 2. Adjust the compatibility range

- [x] 2.1 `src/constants.ts`: set `SUPPORTED_PI_RANGE` from `"^0.79.8"` to `"^0.80.0"`
- [x] 2.2 Adjust the comment above `SUPPORTED_PI_RANGE` if it hardcodes the "0.79.8" string

## 3. `satisfiesSemver` compound-range support

- [x] 3.1 `src/utils.ts` `satisfiesSemver`: split the range on whitespace; run each token through the existing single-comparator logic; AND-combine all tokens as the return value
- [x] 3.2 Ensure a `^` token is still evaluated correctly (caret handling as a single-token path remains)
- [x] 3.3 Handle empty / whitespace-only input defensively (do not throw, return `false`)

## 4. Tests for `satisfiesSemver` and the compatibility gate

- [x] 4.1 Unit test: compound range `">=3.0.0 <3.2.0"`: `3.1.0` → `true`, `3.2.0` → `false`, `3.5.0` → `false`, `2.9.0` → `false`
- [x] 4.2 Unit test: caret `^0.80.0`: `0.80.0` / `0.80.2` → `true`, `0.81.0` → `false`, `0.79.9` → `false`
- [x] 4.3 Unit test: single-comparator regression cases stay green (existing cases)
- [x] 4.4 Compat smoke test (mocked): `session_start` with `VERSION="0.80.2"` fires **no** "outside tested range" notification; with `VERSION="0.81.0"` it fires one warning
- [x] 4.5 Compat smoke test (mocked): `ast-bro` version `3.5.0` disables the extension ("Extension disabled") per the corrected parser

## 5. Verification

- [x] 5.1 `npm run typecheck` (tsc --noEmit) against the pi-coding-agent 0.80.2 `.d.ts` is green
- [x] 5.2 `npm test` (vitest --run) is green including the new cases
- [x] 5.3 Manual smoke test: load the extension under a real pi 0.80.2, inspect `session_start` (no spurious warn toast)
- [x] 5.4 README: review/update the supported pi range hint (`^0.80.0`); add an upgrade note that `ast-bro 3.2.x` is now correctly disabled (previously silently tolerated)

## 6. Gating

- [x] 6.1 `openspec validate upgrade-to-pi-080` is green
- [x] 6.2 Review: no source change outside `constants.ts` and `utils.ts`; the `src/index.ts` logic is unchanged
