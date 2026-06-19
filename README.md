# pi-ast-bro

A [Pi](https://pi.dev) extension that integrates the [`ast-bro`](https://github.com/badlogic/ast-bro) CLI for AST-based code navigation, token-efficient context building, and pre-flight syntax checks.

## Features

- **AST-powered read interception**  
  Large source files (> 500 lines by default) are transparently replaced with an `ast-bro map` outline when the agent calls `read` without explicit `limit`/`offset`.

- **Exact-match refactoring support**  
  The dedicated tools `analyze_ast_impact` and `find_implementations` wrap `ast-bro impact`/`implements` and inject an `exact_snippet` around every matched line. Use that snippet directly as `edits[].oldText` for safe, whitespace-accurate replacements.

- **Result safety cut-off**  
  If a query returns more than 50 matches, the output is truncated and an `attention_required` flag is added so the agent can fall back to a scripted transformation instead of looping through endless individual edits.

- **Pre-flight syntax checks**  
  After `edit` or `write`, the changed file is parsed with `ast-bro map`. If parsing fails, the tool result is marked as an error so the agent can fix the syntax immediately.

- **Refactoring skill**  
  The bundled `/ast-bro-refactor` skill guides the agent through the refactoring workflow and enforces the rule to only use `exact_snippet` values for exact-match edits.

- **Persistent gain tracking**  
  Bytes saved, intercepted reads, caught pre-flight syntax errors, and explicit `analyze_ast_map` calls are persisted across sessions in `.pi/plugins/ast-bro/stats.json`.

- **Interactive dashboards**  
  - `/ast` — session stats, `ast-bro` availability, and live toggles for settings.  
  - `/ast-gain` — retro high-score style dashboard with lifetime savings and recent activity.

## Supported languages

This extension can intercept any language `ast-bro` supports. By default it acts on:

- `.rs` (Rust)
- `.cs` (C#)
- `.ts`, `.tsx` (TypeScript)
- `.py` (Python)

You can change, add, or remove extensions in the `/ast` dashboard or in the settings file.

## Installation

### Prerequisites

- [Pi](https://pi.dev) coding agent
- [Node.js](https://nodejs.org/) >= 22
- [`ast-bro`](https://github.com/badlogic/ast-bro) binary available on your `PATH`

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

#### Option A: Global extension (recommended)

```bash
mkdir -p ~/.pi/agent/extensions
ln -s /path/to/pi-ast-bro ~/.pi/agent/extensions/pi-ast-bro
```

Start Pi normally from any project.

#### Option B: Install via `pi install`

If the package is published to a Pi-compatible registry or GitHub:

```bash
pi install git:github.com/<owner>/pi-ast-bro
```

Then restart Pi or run `/reload`. Pi reads the `pi.extensions` entry from `package.json` and loads the extension automatically.

### 3. Verify

Start Pi and run:

```text
/ast
```

You should see the dashboard showing `ast-bro status: available`, runtime stats, and toggles for the interceptors and threshold.

Run `/ast-gain` to see persistent lifetime stats (tokens saved, intercepts, caught errors, and recent activity).

## Usage

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

Settings are stored per project at:

```text
.pi/plugins/ast-bro/settings.json
```

Example:

```json
{
  "enabled": true,
  "supportedExtensions": [".rs", ".cs", ".ts", ".tsx", ".py"],
  "fileSizeThresholdLines": 500,
  "enablePreFlightSyntaxChecks": true
}
```

You can also edit these values interactively with `/ast`.

## Documentation

For an overview of the internal structure and data flow, see [`docs/architecture.md`](docs/architecture.md).

## Security notes

- `ast-bro` is invoked via `spawnSync` with argument arrays, never shell strings, to prevent command injection.
- File paths are validated before being passed to the OS.
- If `ast-bro` crashes, hangs, or is missing, the extension falls back to Pi’s default tool behavior.

## License

MIT

**No warranty:** This software is provided "as is", without warranty of any kind, express or implied, including but not limited to the warranties of merchantability, fitness for a particular purpose, and non-infringement. In no event shall the authors or copyright holders be liable for any claim, damages, or other liability.
