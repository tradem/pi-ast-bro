# Tasks

## 1. Setup Tool Scaffolding
- [x] Create `src/astBroTools.ts`
- [x] Define the Typebox schemas for `analyze_ast_impact` and `find_implementations`.

## 2. Implement the CLI Wrapper + Snippet Injector
- [x] Implement `spawnSync` calling logic for both commands.
- [x] Create a utility that parses the CLI JSON and uses `fs` to slice and append `exact_snippet`.
- [x] Implement the truncation logic to 50 items and injection of `attention_required`.

## 3. Implement the Refactoring Skill
- [x] Add `skills/ast-bro-refactor/SKILL.md` to the source repo.
- [x] Author the workflow rules to demand `exact_snippet` for `oldText`.
- [x] Wire up `resources_discover` in `src/index.ts` to expose the `skills` directory.

## 4. Integration Context Stats
- [x] Add size-diff calculation for JSON payload vs. real file size.
- [x] Pipe output to `ctx.ui.notify` for gamified UI feedback on save size.

## 5. Security & Test Hardening
- [x] Validate all file arguments given to `spawnSync` against injection.
- [x] Write Vitest unit tests verifying snippet injection for mocked CLI returns.
- [x] Add `package.json` instruction to ensure `skills/` is deployed.
