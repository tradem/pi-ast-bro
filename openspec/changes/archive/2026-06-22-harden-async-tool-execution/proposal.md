## Why

Die async-Migration der Tools (`558910b`) und die Progress-Integration (`aa9ac40`) haben `analyze_ast_impact` / `find_implementations` zwar entblockt, aber die sequentielle Datei-Augmentation (`augmentResult → augmentArray → injectSnippet → readFile`) läuft ohne Timeout-Schutz und ohne Error-Boundary. Bei vielen Treffern blockiert die Augmentation den Tool-Return effektiv — das Tool erscheint dem Nutzer als „hängt“ oder „liefert keine Ausgabe“. Gleichzeitig laufen Interceptors (Read/Edit/Cycle) und der Session-Seed-Digest noch synchron via `spawnSync` und blockieren den Event-Loop.

## What Changes

- **Error-Boundary um `augmentResult` in `executeAstBroRefactorTool`**: Fängt Exceptions aus der Snippet-Augmentation ab, liefert Fallback-JSON ohne Snippets statt stummem Promise-Reject.
- **Timeout & Progress für Augmentation**: Augmentations-Schleife respektiert `signal`-Abbruch und reportet Fortschritt granularer, sodass das Tool nicht stumm bei vielen Treffern hängt.
- **Interceptors auf async umstellen**: `registerReadInterceptor`, `registerViewFileInterceptor`, `registerEditInterceptor` (sowie Cycle-Check und Session-Seed-Digest) ersetzen `spawnSync`/`runAstBro` durch `runAstBroAsync` mit `signal`-Support.
- **`finally`-Blocks ohne `catch` absichern**: Alle `try { ... } finally { throttle.flush() }`-Blöcke erhalten einen expliziten `catch`, der einen standardisierten Fehler-Return liefert, statt die Promise rejecten zu lassen.

## Capabilities

### Modified Capabilities
- `ast-refactoring`: Augmentations-Fehlertoleranz und Abort-Support in `executeAstBroRefactorTool`
- `ast-tool-progress`: Garantiertes Fehler-Reporting via `onUpdate` auch im Exception-Fall
- `ast-session-seed`: Async-Migration des Digest-Aufrufs (kein `spawnSync`-Block mehr)
- `ast-cycle-preflight`: Async-Migration des Cycle-Checks im Edit-Interceptor

### New Capabilities
- `async-interceptors`: Async-Migration der Read/ViewFile/Edit-Interceptors von `spawnSync` auf `runAstBroAsync`

## Impact

- `src/astBroTools.ts` – `executeAstBroRefactorTool`: try/catch um `augmentResult`, signal-Check in Augmentations-Schleife
- `src/interceptors.ts` – `registerReadInterceptor`, `registerViewFileInterceptor`, `registerEditInterceptor`: `spawnSync` → `runAstBroAsync`
- `src/index.ts` – `generateSessionSeed`: `runAstBroDigest` (sync) → async Alternative
- `src/utils.ts` – ggf. neue `runAstBroDigestAsync`-Wrapper
- `tests/` – neue Tests für Error-Boundary, Abort während Augmentation, async Interceptors