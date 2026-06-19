# Design: pi-ast-bro Extension

## Architecture Overview

The extension strictly utilizes the `jiti` runtime provided by Pi and follows the standard Extension API factory pattern (`export default function (pi: ExtensionAPI)`).

```
┌─────────────────┐       ┌────────────────────┐
│   Pi Agent      │       │     pi-ast-bro     │
│                 │   1   │   (Extension API)  │
│   tool_call     │ ─────►│  /ast TUI Command  │ ───► Terminal Display & Stats
│   tool_result   │ ◄─────│  Interceptor Hooks │
└────────┬────────┘       └─────────┬──────────┘
         │                          │ 2. Spawns Child Process
         │                          ▼
         │                 ┌──────────────────┐
         └────────────────►│ ast-bro binary   │
            3. Graceful    │ (Rust CLI)       │
            Fallback       └──────────────────┘
```

## System Components

### 1. Verification and Setup
Lifecycle hook: `pi.on("session_start")`
- We execute a swift synchronous check for `which ast-bro` (or `ast-bro --version`).
- If missing, we pause initialization and run `await ctx.ui.confirm(...)` yielding an installation prompt.
- We will support executing `ast-bro install` (the CLI native way) or executing standard system commands to fetch it.

### 2. The Context-Saver Read Interceptor
Hook: `pi.on("tool_call")`
- **Filtering Logic**: Evaluates the tool name (`read`, `view_file`). Checks `event.input`. If `event.input.path` matches the configured extensions (`supportedExtensions`: `[".rs", ".cs", ".ts", ".tsx", ".dart", ".py"]`), we check the file's line count (or byte size).
- **Intent Check**: We confirm that `offset` and `limit` on the tool input are `undefined` or cover the entire file, signaling a generic read.
- **Execution**: `child_process.execSync('ast-bro context ' + path)`.
- **Patch/Override**: We populate the return result using `ctx.overrideResult()` (or by mutating the incoming event input and resolving), passing back the ast-bro token-budgeted output and appending a clear suffix to instruct the LLM on how to get the raw source if an exact literal edit is required. 
- **Telemetry**: We calculate string byte length differences (`originalFileLength` vs `astOutputLength`) and add it to our session statistics.

### 3. Pre-Flight Syntax Check
Hook: `pi.on("tool_result")`
- Captures `edit_file` / `write_file` / `edit` tool responses.
- Before yielding the success indicator to the LLM, reads the target `event.input.path`.
- Runs `ast-bro map <filePath>` silently. If the CLI exits with a non-zero code or outputs a syntax breakdown failure, the interceptor mutates the result payload.
- Returns `{ isError: true, content: "<AST Error Output>\n\nPlease correct your edit syntactically before proceeding." }` – intercepting the agent loop instantly.

### 4. Direct LLM Tools
Using `pi.registerTool(...)` mapped closely to schemas driven by `@sinclair/typebox`:
1. `analyze_ast_impact`: Parameters `{ path: string }`. Runs `ast-bro impact <path>`. Useful prior to large refactors to see blast radius.
2. `analyze_ast_search`: Parameters `{ query: string, semantic: boolean }`. Runs `ast-bro search` or `ast-bro find-related`.

### 5. Config Store and interactive UI Dashboard
- Configured via a `my-extension.json` stored in `ctx.cwd / .pi / plugins / ast-bro / settings.json` (or global equivalent).
- Hook: `pi.registerCommand("ast")`.
- Leverages `@earendil-works/pi-tui` constructs (`Box`, `Text`, `Container`).
- Displays read-only stats (`Total Bytes Saved: ~1.2MB`) and toggles for settings (e.g. `Pre-flight checks: [x]`, `Max File Depth Trigger: 300 lines`).

## Edge Cases and Resiliency
* **Crashing CLI**: All calls via `child_process` will have try/catch wrappers. If `ast-bro outline/context` fails silently or exits dirty (perhaps because of an edge-case grammar), we fallback transparently to the original raw `read` tool flow, ensuring the agent is never hard-blocked.
* **Non-supported Languages**: If `supportedExtensions` doesn't match the file, we skip the interceptor hooks immediately.
