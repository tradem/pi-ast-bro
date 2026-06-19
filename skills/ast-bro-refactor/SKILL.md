---
name: ast-bro-refactor
description: Opt-in AST refactoring workflow using ast-bro exact snippets
---

# /ast-bro-refactor

Use this skill whenever you are planning a cross-file or multi-location
refactoring inside a codebase that has the `ast-bro` CLI available.

## Workflow

1. **Plan the change** with `analyze_ast_impact`.
   - Pass the file path or fully-qualified symbol name.
   - The tool returns affected callers, callees, and tests as JSON, with each
     match annotated with an `exact_snippet`.

2. **Discover polymorphic borders** with `find_implementations`.
   - Pass the interface or base class path/symbol.
   - Again, every match contains an `exact_snippet` ready for editing.

3. **Perform edits with exact-match safety**.
   - Use the `exact_snippet` value from the JSON output as the
     `edits[].oldText` argument to the `edit` tool.
   - Do not rewrite, reformat, or paraphrase the snippet. Any whitespace change
     will cause the edit to fail.
   - If the snippet spans multiple lines, include the *entire* snippet string as
     `oldText`.

4. **Scale fallback**.
   - If the tool response contains `attention_required` (triggered when more
     than 50 results are omitted), stop manual iterative edits.
   - Switch to a batch transformation: use `ast-bro run`, `sed`, or a temporary
     Node.js/Python script, then verify with `analyze_ast_map`.

## Rule of thumb

> If you can see the exact text in an `exact_snippet` field, you may edit it
> directly. Otherwise, read the raw file first.
