import { describe, expect, it } from "vitest";
import { isInteractiveTui } from "../src/utils.js";

describe("isInteractiveTui", () => {
  it("returns true when hasUI is true and mode is tui", () => {
    expect(isInteractiveTui({ hasUI: true, mode: "tui" })).toBe(true);
  });

  it("returns false for non-TUI modes even when hasUI is true", () => {
    expect(isInteractiveTui({ hasUI: true, mode: "json" })).toBe(false);
    expect(isInteractiveTui({ hasUI: true, mode: "print" })).toBe(false);
    expect(isInteractiveTui({ hasUI: true, mode: "rpc" })).toBe(false);
  });

  it("returns false when in TUI mode but hasUI is false", () => {
    expect(isInteractiveTui({ hasUI: false, mode: "tui" })).toBe(false);
  });

  it("returns false when mode/hasUI fields are undefined", () => {
    expect(isInteractiveTui({})).toBe(false);
    expect(isInteractiveTui({ mode: "tui" })).toBe(false);
    expect(isInteractiveTui({ hasUI: true })).toBe(false);
    expect(isInteractiveTui({ mode: undefined, hasUI: undefined })).toBe(false);
  });
});
