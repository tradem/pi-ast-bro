# Specs: pi-ast-bro Extension

## Technical Requirements
- Language/Environment: TypeScript, Node.js (`jiti` loader).
- Validated via OpenSpec processes.

## Extension Lifecycle Module
1. **Startup Logic**
   - Execute `child_process.spawnSync("ast-bro", ["--version"])`.
   - If exit code !== 0, utilize `ctx.ui.custom` or `ctx.ui.confirm` to present a dialog: "ast-bro binary not found in PATH. Would you like to install it?".
   - Fallback safely if user declines. Extension enters `disabled` state.

## Configuration & UI Module (`/ast`)
1. **Settings Store**
   - Settings schema must be defined utilizing `@sinclair/typebox`.
   - Default Values:
     - `enabled`: `true`
     - `supportedExtensions`: `['.rs', '.cs', '.ts', '.tsx', '.py', '.dart']`
     - `fileSizeThresholdLines`: `300`
     - `enablePreFlightSyntaxChecks`: `true`
2. **Dashboard**
   - Execute `pi.registerCommand('ast')`.
   - Construct a TUI menu detailing accumulated token savings (estimated via byte diff tracked during the session).

## Tool Interception Hooks
1. **Read Path Interceptor (`tool_call`)**
   - Target tools: `read`, `read_file` (if custom tool overrides exist), `view_file`.
   - Trigger Conditions: File extension matches config, Target File Lines > `fileSizeThresholdLines`, AND Tool parameters `offset`/`limit` are NOT set.
   - Outcome: Spawns `ast-bro context <target>` or `ast-bro map <target>`.
   - Modifies return object to return the AST textual representation and appends the string footprint warning the LLM how to trigger a raw bypass (by supplying `limit` and `offset`).
2. **Pre-Flight Write/Edit Middleware (`tool_result`)**
   - Target tools: `edit`, `write`. 
   - Timing: Runs after file is successfully modified on disk but **before** agent receives the completion response.
   - Trigger Condition: `enablePreFlightSyntaxChecks` === true AND extension supported.
   - Outcome: Executes `ast-bro map <file>`. If the ast parser throws a syntax error based on the newly written file state, the tool result is mutated: `isError: true` containing the syntax diagnostic string.

## Dedicated Open Tools
1. **Tool:** `analyze_ast_impact`
   - Description: "Cross-file impact analysis: traces callers, callees, and reverse-deps. Use this before a major refactor to plan changes."
   - Param: `path` (String).
2. **Tool:** `analyze_ast_map`
   - Description: "Extract the hierarchical AST block of a symbol/file." 
   - Param: `path` (String).
3. **Tool:** `analyze_ast_search`
   - Description: "Hybrid search over the repository based on syntax and text."
   - Param: `query` (String).
