## 1. Search snippets output budgeting

- [x] 1.1 Add `searchSnippetBudget` to `SettingsSchema` in `src/config.ts` with a conservative default and validation.
- [x] 1.2 In `src/tools.ts` `analyze_ast_search` snippets path, measure output size and trim lowest-ranked hits first until within `searchSnippetBudget`.
- [x] 1.3 Annotate trimmed output with a `truncated` indicator and omitted-hit count.
- [x] 1.4 Ensure the budget is applied only as a ceiling after any explicit `top_k`; never reduce below `top_k` unless the budget is exceeded.
- [x] 1.5 Attribute trimmed bytes to the `StatsManager`/`/ast-gain` savings where appropriate.

## 2. Dashboard + docs for the setting

- [x] 2.1 Expose `searchSnippetBudget` as a preset list with explanatory labels in `src/tui.ts` (`/ast`).
- [x] 2.2 Update the settings tables in `README.md` and `docs/architecture.md`.

## 3. Skill diet

- [x] 3.1 Remove the "Tool reference" dictionary section from `skills/ast-bro-architecture/SKILL.md`; keep reflection rule, settings hints, and orchestration workflows; replace the duplicated decision tree with a brief pointer.
- [x] 3.2 Tighten the two generic introductory steps in `skills/ast-bro-refactor/SKILL.md`; keep the `exact_snippet`→`oldText` discipline and the 50-result `attention_required` batch-pivot rule.

## 4. README comparison table

- [x] 4.1 Add a comparison table to `README.md`: `pi-ast-bro` extension vs. upstream `SKILL.md` vs. managed indexing/graph (Copilot/Claude/Aider/Hermes).
- [x] 4.2 Cover axes: lifecycle interception, output filtering, index freshness/proactivity, cross-agent, privacy/local-only, setup effort, token cost (definition vs. output).
- [x] 4.3 Include honest acknowledgements of where other approaches win.

## 5. Tests + validation

- [x] 5.1 Vitest: budget trimming keeps top-ranked hits, annotates omissions, respects `top_k`, and is a no-op under the default for small results.
- [x] 5.2 Vitest: graceful fallback when `ast-bro search` output is unparseable (return raw, `isError: false` on exit 0).
- [x] 5.3 Run `openspec validate refine-output-and-skills --strict` and fix any issues.
