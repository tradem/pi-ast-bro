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
  LLM-callable tools that are backed by `ast-bro` but do not require snippet augmentation: `analyze_ast_map`, `analyze_ast_search`, and the optional summary-mode parser.

- `src/astContextPilot.ts`  
  Token-budgeted context pilot wrapping `ast-bro context --json --compact --budget`. Provides `analyze_ast_context` for focused symbol/file understanding.

- `src/astGraphPilot.ts`  
  Dependency-graph pilot wrapping `ast-bro graph --json --compact --hide-external`. Provides `analyze_ast_graph` for architecture and coupling questions and truncates the edge list to `graphMaxEdges`.

- `src/astBroTools.ts`  
  Refactoring tools that wrap `ast-bro impact` and `ast-bro implements`. Parses the CLI JSON output, injects `exact_snippet` around each match, applies the 50-result cutoff with `attention_required`, and reports estimated byte savings via the stats manager and `ctx.ui.notify`.

- `src/tui.ts`  
  Interactive components for `/ast` and `/ast-gain`. Exposes the new `graphMaxEdges` and `contextDefaultBudget` settings as preset lists with explanatory labels.

- `src/utils.ts`  
  Safe path validation, `ast-bro` execution helpers, availability checks, and file-system utilities.

- `skills/ast-bro-refactor/SKILL.md`  
  The bundled opt-in skill that guides the agent through the refactoring workflow and enforces the `exact_snippet`-only rule for `edits[].oldText`.

- `skills/ast-bro-architecture/SKILL.md`  
  The bundled opt-in skill that defines an AST-first workflow for architecture, bounded-context, aggregate, and module-relationship questions.

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

Agent calls analyze_ast_context
         │
         ▼
   astContextPilot.ts
         │
         ▼
   ast-bro context --json --compact --budget <budget> [target] path
         │
         ▼
   Return focused JSON context (or error on non-zero exit)

Agent calls analyze_ast_graph
         │
         ▼
   astGraphPilot.ts
         │
         ▼
   ast-bro graph --json --compact --hide-external path
         │
         ▼
   Truncate edges to graphMaxEdges, annotate truncated/total_edges
         │
         ▼
   Return compact dependency graph JSON

Agent calls analyze_ast_search with mode: summary
         │
         ▼
   tools.ts (summary parser)
         │
         ▼
   Parse path:start-end headers
         │
         ▼
   Return grouped JSON { total_hits, files: { path: { hit_count, ranges } } }
         │
         ▼
   Fall back to raw stdout if headers cannot be parsed

Agent calls analyze_ast_search with mode: snippets
         │
         ▼
   tools.ts
         │
         ▼
   Trim lowest-ranked hits until output fits within searchSnippetBudget
         │
         ▼
   Annotate truncated output with omitted-hit count
         │
         ▼
   Return bounded snippet output; record savings against referenced files

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

## Tool catalogue

| Tool | Module | CLI command | Output handling |
|---|---|---|---|
| `analyze_ast_context` | `src/astContextPilot.ts` | `ast-bro context --json --compact --budget <budget> [target] path` | Returns stdout JSON; errors on non-zero exit. Reads `contextDefaultBudget` from settings when `budget` is omitted. |
| `analyze_ast_graph` | `src/astGraphPilot.ts` | `ast-bro graph --json --compact --hide-external path` | Truncates edge list to `graphMaxEdges`, annotates `truncated` and `total_edges`; errors on non-zero exit. |
| `analyze_ast_map` | `src/tools.ts` | `ast-bro map path` | Returns stdout text; records read savings to `StatsManager` on success. |
| `analyze_ast_search` | `src/tools.ts` | `ast-bro search [--top-k N] query` | `mode: "snippets"` trims lowest-ranked hits to fit `searchSnippetBudget`, annotating omissions. `mode: "summary"` parses headers and returns grouped JSON, falling back to raw stdout if parsing fails. |
| `analyze_ast_impact` | `src/astBroTools.ts` | `ast-bro impact --json target` | Parses JSON, injects `exact_snippet` per match, truncates at 50 results, reports savings. |
| `find_implementations` | `src/astBroTools.ts` | `ast-bro implements --json symbol` | Parses JSON, injects `exact_snippet` per match, truncates at 50 results, reports savings. |
| `analyze_ast_trace` | `src/astNavigationTools.ts` | `ast-bro trace <FROM> <TO> [PATH]` | Shortest static call path, trimmed to `contextDefaultBudget`. |
| `analyze_ast_surface` | `src/astNavigationTools.ts` | `ast-bro surface [PATH]` | True published API surface, resolving re-exports. |

## Deliberately not wrapped

Several `ast-bro` commands are intentionally omitted to keep the tool surface sharp and avoid confusion:

| Command | Covered by | Exclusion rationale |
|---|---|---|
| `callers` / `callees` | `analyze_ast_impact` | Impact analysis already provides callers, callees, and reverse-deps together with exact snippets. |
| `show` | `analyze_ast_context`, `analyze_ast_map` | Symbol extraction is available through context (budgeted) and map (structural). |
| `deps` / `reverse-deps` | `analyze_ast_graph` | The dependency graph provides a coarse forward/reverse view without separate traversal tools. |
| `run` | — | `ast-bro run --write` mutates files and bypasses the pre-flight syntax gate, violating the security principles in `AGENTS.md`. |

## Settings reference

All settings are defined in `src/config.ts` (`SettingsSchema`) and exposed in the `/ast` dashboard via `src/tui.ts`.

| Setting | Default | Used by | Description |
|---|---|---|---|
| `enabled` | `true` | `interceptors.ts` | Master switch for read/view/edit interceptors. |
| `supportedExtensions` | `[".rs", ".cs", ".ts", ".tsx", ".py"]` | `interceptors.ts`, `utils.ts` | File extensions eligible for read interception. |
| `fileSizeThresholdLines` | `500` | `interceptors.ts` | Minimum line count to trigger AST read interception. |
| `enablePreFlightSyntaxChecks` | `true` | `interceptors.ts` | Whether to flag `edit`/`write` results as errors when `ast-bro map` fails. |
| `graphMaxEdges` | `500` | `src/astGraphPilot.ts` | Cap on edges returned by `analyze_ast_graph`. |
| `contextDefaultBudget` | `4000` | `src/astContextPilot.ts` | Default token budget for `analyze_ast_context`. |
| `enableLogSqueeze` | `false` | `interceptors.ts` | Replace large `.log`/`.txt` reads with `ast-bro squeeze` output. |
| `enableIndexRefresh` | `false` | `interceptors.ts` | Mark the `ast-bro` search index stale after successful `edit`/`write`. |
| `enableSessionSeed` | `false` | `src/index.ts` | Inject an `ast-bro digest` repo map at session start. |
| `sessionSeedBudget` | `4000` | `src/index.ts` | Token budget for the session-start digest; oversized output is trimmed and annotated. |
| `sessionSeedScope` | `"root"` | `src/index.ts` | Scope of the digest: `root` (whole repo) or `cwd` (current working directory). |
| `enableCyclePreflight` | `false` | `interceptors.ts` | Run `ast-bro cycles` after edits and flag newly detected import cycles. |
| `searchSnippetBudget` | `8000` | `src/tools.ts` | Approximate-token ceiling for `analyze_ast_search` snippet output; lowest-ranked hits are dropped first. |

## Security notes

- `ast-bro` is invoked via `spawnSync` with argument arrays, never shell strings, to prevent command injection.
- File paths are validated with `isPathSafe` before being passed to the OS or read from disk.
- If `ast-bro` crashes, hangs, or is missing, the extension falls back to Pi’s default tool behavior.
