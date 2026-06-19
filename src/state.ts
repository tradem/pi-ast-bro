/**
 * Session-level statistics for the pi-ast-bro extension.
 *
 * Tracks estimated token/byte savings from intercepted `read` calls.
 *
 * Note: This is intentionally in-memory state. It is reset on every
 * new session and is not persisted across pi restarts.
 */
export class SessionStats {
  private bytesSaved = 0;
  private readsIntercepted = 0;
  private preFlightErrorsCaught = 0;

  addReadSavings(originalBytes: number, astOutputBytes: number): void {
    const saved = Math.max(0, originalBytes - astOutputBytes);
    this.bytesSaved += saved;
    this.readsIntercepted += 1;
  }

  recordPreFlightError(): void {
    this.preFlightErrorsCaught += 1;
  }

  getSummary(): {
    bytesSaved: number;
    readsIntercepted: number;
    preFlightErrorsCaught: number;
  } {
    return {
      bytesSaved: this.bytesSaved,
      readsIntercepted: this.readsIntercepted,
      preFlightErrorsCaught: this.preFlightErrorsCaught,
    };
  }
}
