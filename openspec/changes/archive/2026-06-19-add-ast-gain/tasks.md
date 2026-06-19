## 1. Core Logic & Schema

- [x] 1.1 Create `src/statsManager.ts` and define the TypeBox schema (`StatsSchema`, `StatsHistoryEntrySchema`) for the JSON file. Ensure strict bounds (`maxItems: 100`).
- [x] 1.2 Implement the `StatsManager` class. It must hold Session-level counters AND a queue of unsaved "deltas"/history.
- [x] 1.3 Add a generic `getSessionSummary()` method to `StatsManager` so the main `/ast` UI can still read current-run stats.

## 2. File I/O & Concurrency

- [x] 2.1 Implement an async `save()` method handling "Delta-Updates". (Read disk -> Validate -> Add deltas -> Add history `slice(0, 100)` -> Write disk).
- [x] 2.2 Wrap `save()` in a debounced trigger so frequent `read` interceptions don't spam the disk.
- [x] 2.3 Implement a `flushSync()` method in `StatsManager` using `writeFileSync` for emergency teardown saves.
- [x] 2.4 Register a `process.on("exit")` or similar lifecycle hook in `src/index.ts` to call `flushSync()` guaranteeing data is saved when Pi finishes.

## 3. Integration & Cleanup

- [x] 3.1 Delete `src/state.ts` (`SessionStats`) entirely.
- [x] 3.2 Refactor `src/index.ts`, `src/interceptors.ts`, and `src/tui.ts` to consume the new `StatsManager` instead of `SessionStats`.
- [x] 3.3 Ensure the `bytesSaved` and `preFlightErrorsCaught` tracking calls in the interceptors correctly hit `StatsManager`.

## 4. UI Layer

- [x] 4.1 Create `registerAstGainCommand(pi, manager)` inside `src/tui.ts`.
- [x] 4.2 Format the terminal output to display lifetime counters (Total Bytes Saved roughly converted to tokens, Total Intercepts) and a rendered list of the recent event history.
- [x] 4.3 Ensure `/ast-gain` is registered in `src/index.ts`.

## 5. Testing

- [x] 5.1 Write Vitest tests covering Delta-Update logic (simulating disk state changing between reads/writes).
- [x] 5.2 Validate that the hard history limit of 100 cannot be bypassed in tests.
- [x] 5.3 Test invalid JSON handling explicitly to assert proto-pollution defenses.
