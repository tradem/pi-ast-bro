# AST-based Refactoring Toolset Proposal

## Goal

Provide a robust, exact, and token-efficient toolset for safe refactorings within the `pi-ast-bro` extension. Ensure that the AI agent does not get stuck in infinite edit loops due to missing context and does not waste token budgets by blindly reading large files.

## Summary

This change introduces two new custom AI tools (`analyze_ast_impact` and `find_implementations`) and an opt-in workflow skill (`/ast-bro-refactor`). By wrapping the CLI commands `ast-bro impact` and `ast-bro implements`, we intercept the output, attach exact code snippets for context-perfect exact-match editing, limit the output size for safety, and track token savings for gamified telemetry.

## Scope

- **New AI Tool**: `analyze_ast_impact` (wraps `ast-bro impact`)
  - Identifies direct callers, callees, and affected test files.
- **New AI Tool**: `find_implementations` (wraps `ast-bro implements`)
  - Identifies interface implementations and derived classes.
- **Loop Prevention (Hardening)**: 
  - Both tools must read and inject the actual source code block (`exact_snippet`) surrounding the matching line into the JSON response.
  - This guarantees the agent has the exact whitespace-accurate target text for exact-match replacement `edit` tasks.
- **Fail-safes (Coverage Limit)**:
  - Truncation at 50 results. If results exceed this, an `attention_required` flag is added instead of omitting quietly.
- **Opt-in Skill**: `/ast-bro-refactor`
  - A markdown skill filed under `skills/ast-bro-refactor/SKILL.md` exposed via the extension's `resources_discover` hook.
  - Guides the AI on how to perform step-by-step refactoring workflows (1. Tool usage -> 2. Edit vs. Scripting fallback based on scale).
- **Gamified Telemetry**:
  - The byte difference between the full affected file sizes vs. the emitted tool JSON + Snippet size is forwarded to a "Token Savings" tracker surfaced in the agent UI.

## Out of Scope

- Automatic extraction of agent prompts (no invasive `before_agent_start` magic). We obey the Principle of Least Surprise via opt-in skills.
- The `find-related` semantic search feature is deferred to a future exploration around AI problem-solving context.

## Design Decisions

1. **Exact-Snippet Injector over Multiple File Reads:** We augment the tool inside Node.js to fetch the surrounding source lines alongside the line-number from `ast-bro`. This satisfies the strict `edits[].oldText` exact matching requirement of `pi-coding-agent` while reading only fraction of bytes.
2. **Opt-In `resources_discover` Hook:** The skill ships inside the NPM package, zero manual file copying is required from the end user.
3. **Scripting Fallback:** When a symbol has >50 dependents, manual iterative `edit` loops become dangerous for the context window. At that threshold, the tool instructs the LLM via `attention_required` to pivot to standard scripting (`sed` or `ast-bro run`).
