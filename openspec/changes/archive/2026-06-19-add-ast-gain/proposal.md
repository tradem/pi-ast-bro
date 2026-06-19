## Why

Currently, `pi-ast-bro` collects metrics (like how many tokens were saved or how many syntax errors were caught) exclusively in-memory for the current session. These stats reset on restart, meaning the user never sees the compounded value the tool provides over time. A persistent `/ast-gain` tracker (akin to `rtk-gain`) is needed to showcase the long-term ROI in token savings and intercepted errors.

## What Changes

- Create a persistent stats storage mechanism (e.g., `stats.json` alongside `settings.json`).
- Implement an event history array tracking the last `N` interception events.
- Implement lifetime counters for `totalBytesSaved`, `totalReadsIntercepted`, and `totalPreFlightErrorsCaught`.
- Register an interactive `/ast-gain` TUI command to display these statistics and event history in an ASCII dashboard.
- Update tracking calls in existing `read` and `edit`/`write` interceptors to hook into the persistent store.

## UI Sketch
```text
======================================================
               AST-BRO GAIN HIGHSCORES
======================================================
 Lifetime Savings:   ~312.5k Tokens  (1.25 MB)
 Intercepts:         420 large files skipped
 Saved from errors:  15 syntax errors caught 
======================================================
 Recent Activity (Last 100 actions):

 [10:45:00] edit(src/utils.ts) -> Prevented SyntaxError
 [10:42:00] read(main.ts)      -> Saved ~2.1k Tokens
 [10:15:00] read(app.tsx)      -> Saved ~4.3k Tokens
```

## Capabilities

### New Capabilities
- `ast-gain-tracking`: Persistent tracking of token savings, interceptions, and pre-flight syntax checks, visualised via a TUI command.

### Modified Capabilities
- `ast-dashboard`: The existing functionality might interact with the new tracking data to display it or act parallel to `/ast`.

## Impact

- **Storage**: Will write to `.pi/plugins/ast-bro/stats.json` asynchronously.
- **TUI/Settings**: Extends `src/tui.ts`, introduces `src/statsManager.ts`. Needs UI notification via `@earendil-works/pi-tui`.