# Proposal: pi-ast-bro Extension

## Goals and Vision
Develop a TypeScript-based extension for `pi-coding-agent` called `pi-ast-bro`. This extension seamlessly integrates the `ast-bro` CLI tool to provide language-agnostic AST (Abstract Syntax Tree) analysis for languages like Rust, C#, TypeScript, Dart, and Python. The ultimate goal is to drastically reduce token consumption while building agent context ("Kontextaufbau"), while prioritizing qualitative edits by keeping the agent's full raw-read capabilities intact for actual coding.

## Problem Statement
When LLMs attempt to explore a large codebase, they often rely on `read` tool calls which load entire files into the context window. This rapidly inflates token usage and dilutes the context, often making the LLMs lose track of details. If they try to navigate around using `grep`, they lose hierarchical context. However, forcing an agent to exclusively use AST tooling limits their ability to run exact-text-matching based edits. 

## Approach / Proposed Solution
We will wrap the powerful `ast-bro` CLI tool inside a Pi Extension to offer a hybrid approach to agentic coding:

1. **Auto-Installation & Verification**: On `session_start`, the extension checks via `child_process` if the `ast-bro` binary is available in the `$PATH`. If not, we utilize `pi-tui` to surface an overlay prompt asking the user to install it via cargo or the recommended installer script, preventing silent failures.
2. **Intent-Based Tool Interception (Token Saver Hook)**: We will register a `tool_call` interceptor for the built-in `read` (and potentially `view_file`) tool. 
   - If a file exceeds a configured threshold (e.g., lines or bytes) and the agent hasn't specified pagination (`offset`/`limit`), we interpret it as context-gathering.
   - We intercept the read, pipe the file path to `ast-bro context <file>` or `ast-bro map <file>`, and return a token-budgeted representation of the code.
   - We inject a suffix onto the payload informing the LLM: *"AST context summary provided to save tokens. To read exact source code for editing, specify 'limit' and 'offset' in your read tool."*
3. **Pre-flight Syntax Checking (Quality over Quantity)**: We will register a `tool_result` middleware on exact-edit/write tools. Before returning success to the LLM, we will run `ast-bro map` (or parse) quietly in the background on the written file. If it yields a syntactic error, we report the AST parsing error directly back into the tool result, allowing the LLM to auto-fix the syntax error instantly before moving on.
4. **Explicit Agent Tools**: To maximize `ast-bro`'s capabilities for structural refactoring, we will register dedicated LLM tools for dependency graphing and impact analysis:
   - `analyze_ast_impact`: Wraps `ast-bro impact` to analyze cross-file caller/callee dependencies before a refactor.
   - `analyze_ast_search`: Wraps `ast-bro search` / `find-related` for semantic/AST-aware structural searching.
5. **Interactive TUI Dashboard**: A registered global `/ast` command will spawn an interactive Terminal UI (TUI) via `@earendil-works/pi-tui`, displaying extension configuration options (`pi-settings.json`) and runtime statistics (e.g., "Tokens Saved by Intercepting").

## Scope
### In Scope
- Bootstrap a basic Pi Extension structure using `@earendil-works/pi-coding-agent`.
- Dynamic CLI environment check and user-prompted auto-installer on startup.
- `tool_call` interceptor logic bridging `read` to `ast-bro context`.
- `tool_result` middleware for pre-flight syntax verification.
- Exposing specific `ast-bro` CLI commands as LLM tools via `pi.registerTool()`.
- A `/ast` interactive terminal dashboard for stats and configurable values using `pi-tui`.

### Out of Scope
- Rewriting the `ast-bro` parser natively in TypeScript; everything delegates to the Rust-based CLI.
- Supporting languages not supported by the underlying `ast-bro` CLI tool.
- A custom build distribution mechanic beyond standard Pi extension patterns or binary download instructions.
