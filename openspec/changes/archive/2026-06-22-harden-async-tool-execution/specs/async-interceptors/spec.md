## ADDED Requirements

### Requirement: Read interceptor uses async spawn
The `registerReadInterceptor` event handler SHALL replace synchronous `runAstBro`/`runAstBroSqueeze` calls with `runAstBroAsync` calls, releasing the Node.js event loop during `ast-bro map` or `ast-bro squeeze` execution.

In the `overrideResult` fast path, the tool_call handler SHALL `await` the async `ast-bro` result before calling `overrideResult`. In the fallback path, the `tool_result` handler SHALL `await` the async result before returning the rewritten content.

#### Scenario: Read interceptor does not block event loop
- **WHEN** a `read` tool call on a large supported file triggers the read interceptor
- **THEN** the interceptor calls `runAstBroAsync` (async `spawn`) instead of `runAstBro` (sync `spawnSync`)
- **AND** the event loop remains responsive during `ast-bro map` execution
- **AND** the final content replacement is delivered after the `await` completes

#### Scenario: Read interceptor fallback path is async
- **WHEN** the runtime does not support `overrideResult` and the read interceptor falls back to the `tool_result` phase
- **THEN** the `tool_result` handler `await`s `runAstBroAsync`
- **AND** the rewritten content is returned after the async subprocess completes

### Requirement: ViewFile interceptor uses async spawn
The `registerViewFileInterceptor` event handler SHALL mirror the read interceptor's async migration, replacing synchronous `spawnSync` calls with `runAstBroAsync`.

#### Scenario: ViewFile interceptor uses async spawn
- **WHEN** a `view_file` tool call triggers interception for a large file
- **THEN** the interceptor calls `runAstBroAsync` instead of `runAstBro`
- **AND** the event loop is released during the subprocess

### Requirement: Edit interceptor pre-flight checks use async spawn
The `registerEditInterceptor` event handler SHALL replace synchronous `runAstBro` (syntax check) and `runAstBroCycles` (cycle check) with their async equivalents, releasing the event loop during pre-flight checks.

#### Scenario: Syntax pre-flight uses async spawn
- **WHEN** `enablePreFlightSyntaxChecks` is on and an edit completes on a supported file
- **THEN** the `tool_result` handler calls `runAstBroAsync(["map", path])` instead of `runAstBro("map", path)`
- **AND** the handler `await`s the result before deciding whether to flag `isError: true`
- **AND** the event loop is released during the syntax check

#### Scenario: Cycle pre-flight uses async spawn
- **WHEN** `enableCyclePreflight` is on and an edit completes
- **THEN** the `tool_result` handler calls `runAstBroCyclesAsync` instead of `runAstBroCycles`
- **AND** the result is `await`ed before annotating the tool result

### Requirement: Async interceptor wrappers degrade gracefully
All async interceptor invocations SHALL handle errors and timeouts gracefully, with the same degradation behavior as the previous synchronous variants: if `ast-bro` is unavailable or errors, the original tool result is returned unchanged.

#### Scenario: Async interceptor fails gracefully
- **WHEN** a read/edit interceptor calls `runAstBroAsync` and the subprocess fails or times out
- **THEN** the interceptor returns the original tool result unchanged (no `overrideResult`, no content replacement)
- **AND** the failure is logged but not raised