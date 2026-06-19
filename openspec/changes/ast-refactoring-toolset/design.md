# AST-based Refactoring Toolset Design

## Overview
This design implements the `ast-bro impact` and `ast-bro implements` CLI wrappers natively in Node JS. It attaches an exact contextual file-reader on top of the CLI output before handing the JSON back to the AI context.

## Components

### 1. The Core Tools (`src/astBroTools.ts`)
- Registers `analyze_ast_impact` and `find_implementations`.
- Spawns the internal CLI.
- Iterates over the returned JSON output. For each file+line hit, invokes a lightweight `fs.readFileSync` wrapper.
- Returns augmented JSON to the agent.

### 2. The Context Truncator (`src/utils.ts`)
- Manages the hard `50` limit cutoff.
- Generates the `attention_required` signal if bounds are breached.

### 3. The Refactor Skill (`skills/ast-bro-refactor/SKILL.md`)
- A markdown document with explicit instructions for loop-prevention. Commands the agent to ONLY use `exact_snippet` for `edits[].oldText`.

### 4. Telemetry Integration (`src/index.ts`)
- Extends the `ctx.ui.notify` behavior or stats tracker with "Token savings".

## Dependencies
- `@sinclair/typebox` for Tool Schema definitions.
- `node:child_process` for invoking CLI.
- No new external runtime production dependencies.