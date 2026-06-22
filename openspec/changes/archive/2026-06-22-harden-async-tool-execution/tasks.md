## 1. Error-Boundary in allen Tool-`execute`-Funktionen

- [x] 1.1 `analyze_ast_map` (tools.ts): `try`-Block mit `catch (err)` ergänzen, der `throttle.flush()` aufruft und `{ isError: true, content: [{ text: "Internal error: …" }] }` returned
- [x] 1.2 `analyze_ast_search` (tools.ts): `try`-Block mit `catch (err)` ergänzen (gleiches Pattern)
- [x] 1.3 `analyze_ast_context` (astContextPilot.ts): `try`-Block mit `catch (err)` ergänzen
- [x] 1.4 `analyze_ast_graph` (astGraphPilot.ts): `try`-Block mit `catch (err)` ergänzen
- [x] 1.5 `analyze_ast_trace` (astNavigationTools.ts): `try`-Block mit `catch (err)` ergänzen
- [x] 1.6 `analyze_ast_surface` (astNavigationTools.ts): `try`-Block mit `catch (err)` ergänzen

## 2. AugmentResult-Fehlertoleranz in `executeAstBroRefactorTool`

- [x] 2.1 `augmentResult`-Call in try/catch wrappen; bei Exception das rohe CLI-JSON mit `augmentation_error`-Feld zurückgeben
- [x] 2.2 `augmentResult`-Signatur um `signal?: AbortSignal` erweitern; in `augmentArray` den `signal.aborted`-Check in der Schleife prüfen und bei Abbruch vorzeitig returnen
- [x] 2.3 `catch`-Block in `executeAstBroRefactorTool` ergänzen (analog zu 1.x, plus `augmentation_error` im Return-Payload)

## 3. Async-Wrapper in `src/utils.ts`

- [x] 3.1 `runAstBroDigestAsync(paths: string[], options?)` implementieren: `runAstBroAsync(["digest", ...paths], options)`
- [x] 3.2 `runAstBroCyclesAsync(repoPath: string, options?)` implementieren: `runAstBroAsync(["cycles", "--json", repoPath], options)`
- [x] 3.3 Sicherstellen, dass beide Wrapper `null` returnen bei Fehler/Exception (konsistent mit bestehenden sync-Varianten)

## 4. Read/ViewFile-Interceptors auf async migrieren

- [x] 4.1 `registerReadInterceptor`: `tool_call`-Handler – `runAstBro`/`runAstBroSqueeze` durch `await runAstBroAsync` ersetzen; `overrideResult` nach dem `await` aufrufen
- [x] 4.2 `registerReadInterceptor`: `tool_result`-Handler – gleiche async-Migration für Fallback-Pfad
- [x] 4.3 `registerViewFileInterceptor`: analoge async-Migration für beide Handler
- [x] 4.4 `AbortSignal` aus dem Event-Context an `runAstBroAsync` durchreichen (wo verfügbar)

## 5. Edit-Interceptor auf async migrieren

- [x] 5.1 `registerEditInterceptor`: Syntax-Check – `runAstBro("map", resolved)` durch `await runAstBroAsync(["map", resolved])` ersetzen
- [x] 5.2 `registerEditInterceptor`: Cycle-Check – `runAstBroCycles(repoPath)` durch `await runAstBroCyclesAsync(repoPath)` ersetzen
- [x] 5.3 `registerEditInterceptor`: `tool_result`-Handler bleibt `async`; alle `await`-Calls sind non-blocking für den Event-Loop

## 6. Session-Seed-Digest async migrieren

- [x] 6.1 `generateSessionSeed` in `src/index.ts`: `runAstBroDigest([seedRoot])` durch `await runAstBroDigestAsync([seedRoot])` ersetzen
- [x] 6.2 `newline`-Deklaration in `src/index.ts` prüfen: wird `generateSessionSeed` bereits mit `await` in `maybePrepareSessionSeed` aufgerufen? Falls nicht, korrigieren.

## 7. Tests

- [x] 7.1 Test: `catch`-Block in `analyze_ast_map` fängt Exception und returned `isError: true` (in `tests/progress.test.ts` oder neuem Test-File)
- [x] 7.2 Test: `augmentResult`-Exception in `analyze_ast_impact` liefert raw JSON mit `augmentation_error`-Feld und `isError: false`
- [x] 7.3 Test: `augmentResult` mit `signal.aborted` bricht Augmentation vorzeitig ab
- [x] 7.4 Test: Read-Interceptor `tool_call`-Handler verwendet `runAstBroAsync` (Mock-Prüfung auf `spawn`-Call ohne `spawnSync`)
- [x] 7.5 Test: Edit-Interceptor Syntax-Check verwendet `runAstBroAsync` (Mock-Prüfung)
- [x] 7.6 Test: Edit-Interceptor Cycle-Check verwendet `runAstBroAsync` (Mock-Prüfung)
- [x] 7.7 Test: Session-Seed verwendet `runAstBroAsync` (Mock-Prüfung)
- [x] 7.8 Alle bestehenden Tests laufen weiterhin grün (`npx vitest run`)