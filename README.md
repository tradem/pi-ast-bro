# pi-ast-bro

A [Pi](https://pi.dev) extension that integrates the [`ast-bro`](https://github.com/aeroxy/ast-bro/)  CLI for AST-based code navigation, token-efficient context building, and pre-flight syntax checks.

## Features

| Capability | What it does | Best used for | Key inputs / settings |
|---|---|---|---|
| **Read interception** | Replaces large file reads with an `ast-bro map` outline when no `limit`/`offset` is given. | Skipping token-heavy whole-file reads. | Triggered by `read`; threshold: `fileSizeThresholdLines` (default 500). |
| **`analyze_ast_graph`** | Returns a compact file/module dependency graph. | Architecture, coupling, and module-relationship questions. | `path` (optional, defaults to cwd); capped by `graphMaxEdges` (default 500). |
| **`analyze_ast_map`** | Extracts a hierarchical AST block of a symbol or file. | Understanding the structure of a file or symbol. | `path` |
| **`analyze_ast_context`** | Returns token-budgeted focused context for a symbol or file. | "How does this symbol/file work?" before falling back to `read`. | `path` (required), `target` (optional), `budget` (optional; default from `contextDefaultBudget`, 4000). |
| **`analyze_ast_search`** | Hybrid BM25 + semantic search. | Finding symbols, patterns, or call sites. | `query`, `top_k` (1–100), `mode` (`"snippets"` or `"summary"`). |
| **`analyze_ast_impact`** | Cross-file caller/callee/impact analysis with exact source snippets. | Refactoring: finding who calls a symbol. | `symbol`, `file` (optional) |
| **`find_implementations`** | Finds trait/interface/base-class implementations. | Refactoring: discovering implementers. | `symbol`, `file` (optional) |
| **`/ast-bro-architecture` skill** | Bundled skill with an AST-first decision tree and workflow. | Architecture, bounded-context, and aggregate questions. | — |
| **`/ast-bro-refactor` skill** | Bundled skill enforcing the exact-snippet workflow. | Safe, whitespace-accurate refactoring. | — |
| **Pre-flight syntax checks** | Runs `ast-bro map` after `edit`/`write` and marks syntax errors immediately. | Catching broken code before it propagates. | Toggle: `enablePreFlightSyntaxChecks` |
| **Persistent gain tracking** | Tracks bytes saved, intercepts, and caught errors in `stats.json`. | Seeing the impact of AST-based shortcuts. | View with `/ast-gain` |
| **Interactive dashboards** | `/ast` for live settings and stats; `/ast-gain` for lifetime high-scores. | Tuning behavior and reviewing savings. | — |

### Agent decision tree

The extension embeds an AST-first decision tree in tool metadata and the `/ast-bro-architecture` skill:

| Question type | Start with | Then | Finally |
|---|---|---|---|
| Architecture / module relationships | `analyze_ast_graph` | `analyze_ast_map` on key modules | Targeted `read` for business-rule details |
| Where is a symbol used? | `analyze_ast_impact` | `analyze_ast_search` (use `mode: summary` for many hits) | Targeted `read` |
| Trait / interface implementations | `find_implementations` | `analyze_ast_context` on results | Targeted `read` |
| How does a symbol/file work? | `analyze_ast_context` | `analyze_ast_search` (summary mode) | Targeted `read` |
| Locate a pattern or name | `analyze_ast_search` | `analyze_ast_context` or `read` with `offset`/`limit` | — |

> **Reflection rule:** Before calling `read` on more than two files for a structural question, prefer `analyze_ast_graph`, `analyze_ast_map`, or `analyze_ast_search` first.

## Supported languages

This extension can intercept any language `ast-bro` supports. By default it acts on:

- `.rs` (Rust)
- `.cs` (C#)
- `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh` (C++)
- `.py`, `.pyi` (Python)
- `.ts`, `.tsx` (TypeScript)
- `.js`, `.jsx`, `.mjs`, `.cjs` (JavaScript)
- `.java` (Java)
- `.kt`, `.kts` (Kotlin)
- `.scala`, `.sc` (Scala)
- `.go` (Go)
- `.php` (PHP)
- `.rb` (Ruby)
- `.sql`, `.ddl`, `.dml` (SQL)
- `.md`, `.markdown`, `.mdx`, `.mdown` (Markdown)

`.dart` is not enabled by default because `ast-bro` currently does not ship a Dart / Flutter grammar.

## Installation

### Prerequisites

- [Pi](https://pi.dev) coding agent
- [Node.js](https://nodejs.org/) >= 22
- [`ast-bro`](https://github.com/badlogic/ast-bro) binary (version **3.0.0 – 3.1.x**) available on your `PATH`

### 1. Install `ast-bro`

Follow the upstream instructions and make sure the binary is reachable, for example:

```bash
cargo install ast-bro
ast-bro --version
```

If Pi cannot find `ast-bro`, create a symlink to a directory that is always on `PATH`:

```bash
sudo ln -s "$(which ast-bro)" /usr/local/bin/ast-bro
```

### 2. Install the extension

#### Option A: Install via `pi install` (recommended)

If the package is published to a Pi-compatible registry or GitHub:

```bash
pi install git:github.com/<owner>/pi-ast-bro
```

#### Option B: Global extension
```bash
mkdir -p ~/.pi/agent/extensions
ln -s /path/to/pi-ast-bro ~/.pi/agent/extensions/pi-ast-bro
```

Start Pi normally from any project.


Then restart Pi or run `/reload`. Pi reads the `pi.extensions` entry from `package.json` and loads the extension automatically.

### 3. Verify

Start Pi and run:

```text
/ast
```

You should see the dashboard showing `ast-bro status: available`, runtime stats, and toggles for the interceptors and threshold.

Run `/ast-gain` to see persistent lifetime stats (tokens saved, intercepts, caught errors, and recent activity).

## Usage

### Architecture and relationship questions

Start with the graph and map pilots before reading individual files:

```text
Show me the module dependencies in backend/crates/core
```

This calls `analyze_ast_graph` on `backend/crates/core`. If the result is
truncated, raise `graphMaxEdges` in `/ast` or narrow the path.

For "how does this symbol work?" questions, use context first:

```text
How does CostumeAggregate work in backend/crates/core?
```

This calls `analyze_ast_context` with `target: "CostumeAggregate"` and falls
back to targeted `read` only when exact source is needed.

### Search in summary mode

When scanning many files, ask for the compact grouped map:

```text
Search for character_id across the repo and give me a summary of hits
```

This calls `analyze_ast_search` with `mode: summary` and returns a JSON object
with `total_hits`, `files`, `hit_count`, and ordered `ranges` such as `["42-55",
"160-190"]`.

### Ask for high-level explanations

Prompts that only need structure and signatures work best with the AST summary:

```text
Explain the DD Core Bounded Context by using the AST structure and signatures.
```

### Force raw source

Any `read` call that includes explicit `limit` and/or `offset` bypasses the interceptor automatically:

```text
Read lines 1 to 200 of src/main.rs in full.
```

### Refactoring workflow

Both refactoring tools work on a **symbol**. For ambiguous symbols you can add an optional **file** to scope the lookup.

1. Call `analyze_ast_impact` with a symbol name:

   ```text
   Show callers of make_ctx in backend/crates/core/src/character/aggregate.rs
   ```

   This passes `symbol: "make_ctx"` and `file: "backend/crates/core/src/character/aggregate.rs"` to `ast-bro impact`.

2. Call `find_implementations` to discover trait/interface implementations:

   ```text
   Find implementations of Command
   ```

   This passes `symbol: "Command"` to `ast-bro implements`.

3. Use the returned `exact_snippet` values as `edits[].oldText` for each change.
4. If `attention_required` appears, rely on batch scripts (`ast-bro run`, `sed`, etc.) instead of manual edits.

**Ambiguous standard-library / built-in symbols** like `to_string`, `clone`, or `str.upper` are defined on many types. Either qualify them with a concrete type (`ProjectId.to_string`) or use `analyze_ast_search` first to find the relevant call sites.

### Settings

Settings are stored per project at `.pi/plugins/ast-bro/settings.json` and edited interactively via `/ast`.

| Setting | Default | Description |
|---|---|---|
| `enabled` | `true` | Master switch for AST interceptors. |
| `supportedExtensions` | `[".rs", ".cs", ".cpp", ".cc", ".cxx", ".hpp", ".hh", ".py", ".pyi", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".java", ".kt", ".kts", ".scala", ".sc", ".go", ".php", ".rb", ".sql", ".ddl", ".dml", ".md", ".markdown", ".mdx", ".mdown"]` | File extensions that trigger read interception. |
| `fileSizeThresholdLines` | `500` | Line threshold above which a large file read is replaced by an AST map. |
| `enablePreFlightSyntaxChecks` | `true` | Run `ast-bro map` after edits/writes and mark the result as an error on failure. |
| `graphMaxEdges` | `500` | Maximum edges returned by `analyze_ast_graph`; larger graphs are truncated. |
| `contextDefaultBudget` | `4000` | Default token budget for `analyze_ast_context`. |
| `enableLogSqueeze` | `false` | Replace large `.log`/`.txt` reads with `ast-bro squeeze` output. |
| `enableIndexRefresh` | `false` | Mark the `ast-bro` search index stale after successful `edit`/`write`. |
| `enableSessionSeed` | `false` | Inject an `ast-bro digest` repo map at session start. Default off to keep token savings unconditional. |
| `sessionSeedBudget` | `4000` | Token budget for the session-start digest; oversized output is trimmed and annotated. |
| `sessionSeedScope` | `"root"` | Scope of the digest: `root` (whole repo) or `cwd` (current working directory). |
| `enableCyclePreflight` | `false` | Run `ast-bro cycles` after edits and flag newly detected import cycles. |
| `searchSnippetBudget` | `8000` | Approximate-token ceiling for `analyze_ast_search` snippet output; lowest-ranked hits are dropped first. |
| `progressUpdateThrottleMs` | `100` | Minimum interval between on-tool progress updates (ms). `0` disables throttling. |

Example:

```json
{
  "enabled": true,
  "supportedExtensions": [
    ".rs",
    ".cs",
    ".cpp",
    ".cc",
    ".cxx",
    ".hpp",
    ".hh",
    ".py",
    ".pyi",
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".java",
    ".kt",
    ".kts",
    ".scala",
    ".sc",
    ".go",
    ".php",
    ".rb",
    ".sql",
    ".ddl",
    ".dml",
    ".md",
    ".markdown",
    ".mdx",
    ".mdown"
  ],
  "fileSizeThresholdLines": 500,
  "enablePreFlightSyntaxChecks": true,
  "graphMaxEdges": 500,
  "contextDefaultBudget": 4000,
  "enableLogSqueeze": false,
  "enableIndexRefresh": false,
  "enableSessionSeed": false,
  "sessionSeedBudget": 4000,
  "sessionSeedScope": "root",
  "enableCyclePreflight": false,
  "searchSnippetBudget": 8000,
  "progressUpdateThrottleMs": 100
}
```

## Choosing an approach

Not every workflow needs this extension. The table below compares six ways to get AST-aware help — `ast-bro` (wrapped or upstream) and three open-source Tree-sitter indexing engines ([Codebase-Memory](https://github.com/DeusData/codebase-memory-mcp), [CodeRLM](https://github.com/JaredStewart/coderlm), [Arbor](https://github.com/Anandb71/arbor)):

| | `pi-ast-bro` extension | Upstream `ast-bro` `SKILL.md` | Managed indexing / graph tools (Copilot, Claude, Aider, Hermes) | [`Codebase-Memory`](https://github.com/DeusData/codebase-memory-mcp) | [`CodeRLM`](https://github.com/JaredStewart/coderlm) | [`Arbor`](https://github.com/Anandb71/arbor) |
|---|---|---|---|---|---|---|
| **Tool lifecycle interception** | Yes — intercepts `read`, `edit`, and `write` inside Pi. | No — the agent must remember to invoke tools. | Varies; usually ambient or via IDE integration. | No — the agent invokes one of 14 deterministic MCP tools. | No — the agent drives a JSON API exposed by the Rust server. | No — the agent calls MCP tools via `arbor bridge` (10 tools, stdio), or the CLI/GUI; the `arbor-server` JSON-RPC/WebSocket backend powers the visualizer + VS Code extension. |
| **Output filtering** | Yes — per-tool ceilings (`graphMaxEdges`, `contextDefaultBudget`, `searchSnippetBudget`), exact-snippet augmentation, and `attention_required` batch pivoting. | Up to the upstream skill prompt; typically raw tool output. | Often managed server-side; usually opaque to the user. | No — returns graph-query results (incl. bundled semantic vector + Cypher); no per-call budgets. | No — returns exploration results on demand; no token ceilings. | No — returns blast-radius / impact / logic-path results; no per-call budgets. |
| **Index freshness / proactivity** | Optional background index refresh after edits (`enableIndexRefresh`) and explicit `/ast` controls. | Depends on the host running `ast-bro index` when needed. | Managed by provider; generally fresh but opaque. | Yes — `auto_index` on first connection plus a background git-based file watcher. | Manual — the server builds an index over the project, then queries hit it; refresh requires re-indexing. | Yes — sub-second incremental background indexing tracks edits in real time. |
| **Cross-agent support** | **No** — Pi only. | **Yes** — works with any agent that can read the skill and run `ast-bro`. | **Yes** — built into editors/hosts. | **Yes** — auto-configures 11 MCP-capable agents. | **Yes** — first-class Claude Code plugin; generators for Cursor, Copilot, Gemini, Codex. | **Yes** — MCP server (10 tools) via stdio, plus CLI and GUI. |
| **Privacy / local-only** | Yes — runs your local `ast-bro` binary; no remote indexing required. | Yes — same local `ast-bro` binary. | Usually not; code or embeddings may leave the machine. | Yes — single pure-C static binary; 100% local, embeddings bundled in the binary. | Yes — local Rust server, no remote indexing. | Yes — local Rust engine; no remote indexing. |
| **Setup effort** | Medium — install Pi, extension, and `ast-bro`. | Low-Medium — install `ast-bro` and load the skill into your agent. | Lowest — sign in and enable the integration. | Low — download the static binary, run `install`, say "index this project". | Medium — build the Rust server, then install the Claude Code plugin or run a generator. | Low-Medium — `cargo install arbor-graph-cli` or pull the GHCR image; add via `arbor bridge`. |
| **Token cost (definition vs. output)** | Fixed tool-definition cost per Pi session; output is filtered per call, so per-call cost is bounded. | Skill text is sent as context; output is unfiltered, so a large result can consume many tokens. | Definition cost is usually hidden; output tokens are charged per request, often without user-visible caps. | 14 MCP definitions per session; output targets small graph queries explicitly (claims ~10× fewer tokens than file-by-file). | Plugin + tool definitions in the session; recursive exploration can pull many tokens per chain. | 10 MCP definitions per session; blast-radius / impact results can be large and are unfiltered. |

Where the other approaches are stronger:

- **Upstream `ast-bro` skill / MCP** is the better choice if you do not use Pi or want the same tooling across multiple agents. It also has no Pi-extension version coupling.
- **Managed indexing / graph tools** win on cross-agent/editor integration, zero local setup, and automatic index freshness. They are appropriate when you are comfortable with cloud-side processing and do not need explicit token budgets.
- **`Codebase-Memory`** is the better choice when you want a standalone, multi-language (158-language) graph index with a fixed set of deterministic structural-query MCP tools, auto-indexing, and no per-host coupling — independent of Pi and of any single editor.
- **`CodeRLM`** is the better choice when you want a purpose-built AST server implementing the Recursive Language Model pattern for targeted, recursive codebase exploration (first-class in Claude Code; generators for Cursor, Copilot, Gemini, Codex) rather than an interception layer.
- **`Arbor`** is the better choice when your goal is deterministic blast-radius / impact analysis before a change ("what breaks if I change this symbol?", shortest architectural path between nodes) on a Tree-sitter-based semantic dependency graph — including the Flutter "Logic Forest" visualizer, the JSON-RPC/WebSocket server, and CI git-aware risk gating via `arbor check`.

Use `pi-ast-bro` when you want Pi-native interception, explicit output budgets, and the `exact_snippet` → `edit` workflow.

## Deliberately not wrapped

The extension intentionally does not register tools for every `ast-bro` command. The goal is a curated tool surface that avoids tool-confusion and schema-token bloat:

| Command | Reason it is not wrapped |
|---|---|
| `callers` / `callees` | Covered by `analyze_ast_impact`, which combines caller/callee/reverse-deps analysis with exact source snippets. |
| `show` | Covered by `analyze_ast_context` (focused symbol context) and `analyze_ast_map` (hierarchical block). |
| `deps` / `reverse-deps` | Covered coarsely by `analyze_ast_graph`; adding separate forward/reverse traversal tools would duplicate the dependency view. |
| `run` | Mutates files using pattern matching and bypasses the pre-flight syntax gate. Excluded for security per the project guidelines. |

If you need these commands, invoke `ast-bro` directly via `bash` or use the upstream `ast-bro mcp` server.

## Documentation

For an overview of the internal structure and data flow, see [`docs/architecture.md`](docs/architecture.md).

## Security notes

- `ast-bro` is invoked via `spawnSync` with argument arrays, never shell strings, to prevent command injection.
- File paths are validated before being passed to the OS.
- If `ast-bro` crashes, hangs, or is missing, the extension falls back to Pi’s default tool behavior.

## License

MIT

**No warranty:** This software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement. In no event shall the authors or copyright holders be liable for any claim, damages, or other liability.
