## Context

Seit dem async-Refactoring (`558910b`) laufen alle registrierten Tools über `runAstBroAsync` (async `spawn`). Die Progress-Integration (`aa9ac40`) fügte `onUpdate`-Calls und `createProgressThrottle`-Wrapping in jede `execute`-Funktion ein. Dabei entstanden zwei strukturelle Schwachstellen:

1. **Fehlende Error-Boundary**: Alle Tools wrappen ihren Körper mit `try { ... } finally { throttle.flush() }` — ohne `catch`. Wirft ein `await` innerhalb des `try`-Blocks (z.B. `augmentResult`, `readFile`, `stat`), rejectet die Promise. Pi's Runner fängt das zwar auf Type-Ebene, aber das Verhalten bei rejected Promises aus `execute()` ist undefiniert.

2. **Synchrone Interceptors**: `registerReadInterceptor`, `registerViewFileInterceptor`, `registerEditInterceptor` (samt Cycle-Check) und `generateSessionSeed` nutzen weiterhin `spawnSync`/`runAstBro`. Diese Aufrufe blockieren den Node-Event-Loop für die gesamte Dauer des `ast-bro`-Subprozesses (typischerweise 0.5–5s).

## Goals / Non-Goals

**Goals:**
- `executeAstBroRefactorTool`: Error-Boundary um `augmentResult`, sodass ein Fehler in der Snippet-Augmentation nicht zum Promise-Reject führt, sondern einen Fallback-Return (JSON ohne Snippets) liefert
- Alle `execute`-Funktionen: Expliziter `catch`-Block, der einen standardisierten Fehler-Return (`isError: true`) liefert
- Read/ViewFile/Edit-Interceptors: Ersatz von `spawnSync`/`runAstBro` durch `runAstBroAsync` mit `AbortSignal`-Support
- Session-Seed: `runAstBroDigest`-Aufruf async machen (neuer Wrapper oder direkter `runAstBroAsync`-Call)
- Cycle-Preflight: `runAstBroCycles` im Edit-Interceptor auf async umstellen

**Non-Goals:**
- Parallele Datei-Augmentation (concurrent `readFile` statt sequentiell) — Performance-Optimierung, kein Härten
- Timeout-Handling in `runAstBroAsync` ändern (Node.js `spawn`-Timeout wird als ausreichend betrachtet)
- Architektur-Änderungen an der Tool-Registrierung

## Decisions

### Decision 1: Error-Boundary liefert JSON ohne Snippets

**Gewählt**: Wenn `augmentResult` wirft, wird das rohe CLI-JSON (ohne `exact_snippet`-Injection) als Fallback zurückgegeben, mit `isError: false` und einem `attention_required`-Hinweis.

**Alternative erwogen**: Fehler-Return mit `isError: true` — verworfen, weil der `ast-bro impact`-Call bereits erfolgreich war und die Rohdaten für den Agenten nützlich sind.

**Rationale**: Der Agent erhält weiterhin die Caller/Implementierungs-Liste; lediglich die Whitespace-genauen Snippets fehlen. Der Hinweis signalisiert dem Agenten, dass er für exakte Edits selbst `read` aufrufen muss.

### Decision 2: `catch` in allen Tool-`execute`-Funktionen

**Gewählt**: Jeder `try { ... } finally { throttle.flush() }`-Block erhält einen `catch (err)`-Arm, der `throttle.flush()` aufruft und `{ content: [{ type: "text", text: "Internal error: ..." }], isError: true }` returned.

**Rationale**: Verhindert stille Promise-Rejects. Der Agent sieht einen klaren Fehler statt gar keiner Ausgabe. Der `throttle.flush()`-Call im `catch` stellt sicher, dass die letzte Progress-Phase auch im Fehlerfall ausgeliefert wird.

### Decision 3: Interceptors auf `runAstBroAsync` migrieren

**Gewählt**: `registerReadInterceptor` und `registerViewFileInterceptor` ersetzen `runAstBro`/`runAstBroSqueeze` durch `runAstBroAsync` mit `{ signal, timeoutMs: 30_000 }`. `registerEditInterceptor` ersetzt `runAstBro` (für Syntax-Check) und `runAstBroCycles` (für Cycle-Check) durch async-Äquivalente.

**Alternative erwogen**: Interceptors komplett auf `overrideResult`-Fast-Path beschränken und Fallback-Pfad entfernen — verworfen, weil ältere pi-Versionen `overrideResult` nicht unterstützen.

**Rationale**: Der `tool_call`-Handler ist bereits `async`; ein `await` auf `runAstBroAsync` gibt den Event-Loop frei. Der `tool_result`-Handler ist ebenfalls `async` und kann ebenso awaiten. Für den `overrideResult`-Fast-Path: `overrideResult` wird sofort aufgerufen, der `await`-Call ist non-blocking.

### Decision 4: Session-Seed-Digest async machen

**Gewählt**: `runAstBroDigest` wird durch einen neuen `runAstBroDigestAsync`-Wrapper ersetzt, der `runAstBroAsync(["digest", ...paths])` aufruft. Der `session_start`-Handler awaited das Ergebnis.

**Rationale**: `session_start` ist bereits `async`. Der sync `spawnSync`-Call blockiert den Session-Start für die Dauer des Digest (kann bei großen Repos mehrere Sekunden sein). Mit `runAstBroAsync` wird der Event-Loop freigegeben.

### Decision 5: Cycle-Preflight async machen

**Gewählt**: `runAstBroCycles` erhält einen async Wrapper `runAstBroCyclesAsync`, der im `tool_result`-Handler des Edit-Interceptors geawaitet wird.

**Rationale**: Der Cycle-Check läuft im `tool_result`-Handler, der bereits `async` ist. Ein `await` auf das async-Pendant gibt den Event-Loop frei, statt ihn für die Dauer des `ast-bro cycles`-Aufrufs zu blockieren.

## Risks / Trade-offs

- **[Risk] Timing-Änderung bei Interceptors**: Bisher synchrone Interceptor-Logik wird async. `overrideResult` muss ggf. vor dem `await` aufgerufen werden, da es den Original-Read überspringt. → **Mitigation**: `overrideResult`-Call geschieht nach dem `await`, aber vor dem Return; der Read selbst läuft parallel weiter, was akzeptabel ist, da `overrideResult` das Ergebnis ohnehin überschreibt.

- **[Risk] `runAstBroAsync`-Timeout in Interceptors**: Interceptors haben bisher kein Timeout (30s `spawnSync`-Default). Mit `runAstBroAsync` wird das Timeout explizit gesetzt. → **Mitigation**: Gleicher Timeout-Wert (30s) wie bei den expliziten Tools.

- **[Risk] Fehler-Return-Format im `catch`-Block**: Der `catch`-Block muss das gleiche Return-Format wie der normale Pfad liefern. → **Mitigation**: TypeScript stellt sicher, dass der Return-Type mit der `execute`-Signatur kompatibel ist.

- **[Risk] Session-Seed-Async könnte Race-Condition mit `before_agent_start` auslösen**: `session_start` setzt den Seed asynchron; `before_agent_start` liest ihn. → **Mitigation**: `maybePrepareSessionSeed` wird mit `await` aufgerufen; `setSessionSeed` ist synchron und wird vor dem `before_agent_start`-Event ausgeführt.