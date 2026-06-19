# Architecture

This document describes the internal structure of `pi-ast-bro` for contributors and advanced users who want to understand or extend the extension.

## Module overview

- `src/index.ts`  
  Extension factory, startup lifecycle, and the optional auto-installer prompt for `ast-bro`.

- `src/config.ts`  
  Persistent settings manager using TypeBox schemas. Settings are stored per project at `.pi/plugins/ast-bro/settings.json`.

- `src/statsManager.ts`  
  Persistent and session-level statistics manager. Tracks bytes saved, intercepted reads, caught pre-flight syntax errors, and explicit `analyze_ast_map` calls. Uses delta-update saves and TypeBox validation for the on-disk `stats.json` format.

- `src/interceptors.ts`  
  `tool_call` interceptors for `read`/`view_file` and `tool_result` middleware for `edit`/`write`. Falls back to Pi’s default behavior whenever `ast-bro` is unavailable or returns an error.

- `src/tools.ts`  
  LLM-callable tools that are backed by `ast-bro` but do not require snippet augmentation: `analyze_ast_map` and `analyze_ast_search`.

- `src/astBroTools.ts`  
  Refactoring tools that wrap `ast-bro impact` and `ast-bro implements`. Parses the CLI JSON output, injects `exact_snippet` around each match, applies the 50-result cutoff with `attention_required`, and reports estimated byte savings via the stats manager and `ctx.ui.notify`.

- `src/tui.ts`  
  Interactive components for `/ast` and `/ast-gain`.

- `src/utils.ts`  
  Safe path validation, `ast-bro` execution helpers, availability checks, and file-system utilities.

- `skills/ast-bro-refactor/SKILL.md`  
  The bundled opt-in skill that guides the agent through the refactoring workflow and enforces the `exact_snippet`-only rule for `edits[].oldText`.

## Data flow

```
Agent calls read on a large file
         │
         ▼
   interceptors.ts
         │
         ▼
   runAstBro("map", path)
         │
         ▼
   Return AST outline + fallback reminder

Agent calls analyze_ast_impact / find_implementations
         │
         ▼
   astBroTools.ts
         │
         ▼
   runAstBro("impact" / "implements", path)
         │
         ▼
   Parse JSON, inject exact_snippet, truncate if > 50
         │
         ▼
   Report bytes saved to StatsManager + ctx.ui.notify
```

## Security notes

- `ast-bro` is invoked via `spawnSync` with argument arrays, never shell strings, to prevent command injection.
- File paths are validated with `isPathSafe` before being passed to the OS or read from disk.
- If `ast-bro` crashes, hangs, or is missing, the extension falls back to Pi’s default tool behavior.
