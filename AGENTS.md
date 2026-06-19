# pi-ast-bro Agent Guidelines

Welcome to the `pi-ast-bro` extension project! This document outlines coding standards, testing practices, and critical security guidelines for agents and human developers building this `pi-coding-agent` extension.

## 1. Extension Architecture & TypeScript
- **Target Runtime**: Node.js ecosystem loaded via `jiti`. 
- **Language**: Strict TypeScript. Always define explicit interfaces and avoid `any`.
- **API Adherence**: You are extending `@earendil-works/pi-coding-agent`. Rely on `pi.on()` for events (`tool_call`, `tool_result`, `session_start`) and `pi.registerTool()` for new capabilities.
- **UI Interactions**: Use `@earendil-works/pi-tui` for interactive menus (the `/ast` command) and `ctx.ui.confirm` for prompts (like the ast-bro auto-installer).
- **Validation**: Strict schema validation MUST be done using `@sinclair/typebox`.

## 2. Security & Supply Chain Defense (CRITICAL)
As an extension executing inside an AI agent with file access, security must not be compromised.

- **Dependency Minimalism**: Do NOT add arbitrary `npm` packages to solve trivial problems. Every dependency is a potential supply-chain attack vector. Rely on native Node.js built-ins (`node:fs`, `node:child_process`, `node:path`) wherever possible.
- **Strict Package Locking**: Always respect and commit `package-lock.json` or `pnpm-lock.yaml`.
- **Command Injection Prevention**: We routinely invoke the `ast-bro` Rust CLI via Node's `child_process`.
  - **NEVER** pass unescaped or unvalidated strings directly into `exec()` or `execSync()`.
  - **ALWAYS** prefer `spawn()` or `spawnSync()` using argument arrays (e.g., `spawnSync("ast-bro", ["context", filePath])`) to definitively prevent bash parameter injection.
  - Provide validation checks on `filePath` before passing it to the OS.

## 3. Testing Strategy
We test the extension using **Vitest**. (Do not use Jest, as Vitest provides superior ESM and TypeScript support out of the box).

- **Unit Testing Framework**: You MUST use Vitest. It has zero-config ESM support which aligns with our secure, minimal-dependency approach. 
- **Mocking the Pi API**:
  - Since the extension exports an `ExtensionAPI` factory (`export default function(pi) { ... }`), you can pass a mocked `pi` object in your test suites.
  - Accumulate the registered event handlers in your mock, and dispatch synthetic `tool_call` or `tool_result` events.
  - Assert that `ctx.overrideResult()` behaves correctly regarding the `fileSizeThresholdLines` limits.
- **Mocking Child Processes**: Mock `node:child_process` strictly using `vi.mock('node:child_process')` and `vi.fn()`. Do not execute the actual `ast-bro` binary during standard unit tests. Ensure you assert that `spawn` is called with the exact right arguments (`["map", "target_file"]`).
- **Pre-Flight Test Logic**: Verify that your `edit` or `write` interception correctly alters the tool's result to `isError: true` if the mapped child process returns an error exit code.

## 4. Operational Principles
- **Graceful Degradation**: If `ast-bro` throws an error, hangs, or isn't installed, the extension must **never** crash the main pi-coding-agent process. It must elegantly log the failure and fall back to skipping the interceptor (yielding the default `read` / `edit` behaviors).
- **Quality Over Efficiency**: If prioritizing between saving LLM context tokens vs ensuring the LLM has exact text to perform an edit, prioritize exactness. The goal of contextual token-saving is to support navigation, but coding requires raw access.
