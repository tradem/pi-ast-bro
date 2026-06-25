import { describe, expect, it } from "vitest";
import { satisfiesSemver } from "../src/utils.js";

describe("satisfiesSemver — compound ranges (AND semantics)", () => {
  const range = ">=3.0.0 <3.2.0";

  it("returns true for a version inside both bounds", () => {
    expect(satisfiesSemver("3.1.0", range)).toBe(true);
  });

  it("returns false for a version at the excluded upper bound", () => {
    expect(satisfiesSemver("3.2.0", range)).toBe(false);
  });

  it("returns false for a version above the upper bound (regression: previously true)", () => {
    expect(satisfiesSemver("3.5.0", range)).toBe(false);
  });

  it("returns false for a version below the lower bound", () => {
    expect(satisfiesSemver("2.9.0", range)).toBe(false);
  });

  it("returns true for a version at the inclusive lower bound", () => {
    expect(satisfiesSemver("3.0.0", range)).toBe(true);
  });
});

describe("satisfiesSemver — caret range ^0.80.0", () => {
  const range = "^0.80.0";

  it("returns true for the range base version", () => {
    expect(satisfiesSemver("0.80.0", range)).toBe(true);
  });

  it("returns true for a patch bump within the range", () => {
    expect(satisfiesSemver("0.80.2", range)).toBe(true);
  });

  it("returns false for a minor bump (0.x caret locks the minor)", () => {
    expect(satisfiesSemver("0.81.0", range)).toBe(false);
  });

  it("returns false for an older patch", () => {
    expect(satisfiesSemver("0.79.9", range)).toBe(false);
  });
});

describe("satisfiesSemver — single-comparator regression cases", () => {
  it("'>=' comparator", () => {
    expect(satisfiesSemver("3.1.0", ">=3.0.0")).toBe(true);
    expect(satisfiesSemver("3.0.0", ">=3.0.0")).toBe(true);
    expect(satisfiesSemver("2.9.0", ">=3.0.0")).toBe(false);
  });

  it("'>' comparator", () => {
    expect(satisfiesSemver("3.1.0", ">3.0.0")).toBe(true);
    expect(satisfiesSemver("3.0.0", ">3.0.0")).toBe(false);
  });

  it("'<=' comparator", () => {
    expect(satisfiesSemver("3.2.0", "<=3.2.0")).toBe(true);
    expect(satisfiesSemver("3.3.0", "<=3.2.0")).toBe(false);
  });

  it("'<' comparator", () => {
    expect(satisfiesSemver("3.1.0", "<3.2.0")).toBe(true);
    expect(satisfiesSemver("3.2.0", "<3.2.0")).toBe(false);
  });

  it("'=' comparator (explicit)", () => {
    expect(satisfiesSemver("1.2.3", "=1.2.3")).toBe(true);
    expect(satisfiesSemver("1.2.4", "=1.2.3")).toBe(false);
  });

  it("bare exact version (implicit '=')", () => {
    expect(satisfiesSemver("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesSemver("1.2.4", "1.2.3")).toBe(false);
  });

  it("caret on a 1.x range (minor freedom)", () => {
    expect(satisfiesSemver("1.5.2", "^1.2.3")).toBe(true);
    expect(satisfiesSemver("1.2.3", "^1.2.3")).toBe(true);
    expect(satisfiesSemver("1.2.2", "^1.2.3")).toBe(false);
    expect(satisfiesSemver("2.0.0", "^1.2.3")).toBe(false);
  });

  it("caret on a 0.x range (patch freedom only)", () => {
    expect(satisfiesSemver("0.79.9", "^0.79.8")).toBe(true);
    expect(satisfiesSemver("0.80.0", "^0.79.8")).toBe(false);
  });

  it("ignores build metadata on the version", () => {
    expect(satisfiesSemver("0.80.2+64f048b", "^0.80.0")).toBe(true);
    expect(satisfiesSemver("3.1.0+sha", ">=3.0.0 <3.2.0")).toBe(true);
  });
});

describe("satisfiesSemver — defensive input handling", () => {
  it("returns false for an empty range string", () => {
    expect(satisfiesSemver("0.80.0", "")).toBe(false);
  });

  it("returns false for a whitespace-only range string", () => {
    expect(satisfiesSemver("0.80.0", "   ")).toBe(false);
  });

  it("returns false for a malformed version", () => {
    expect(satisfiesSemver("not-a-version", "^0.80.0")).toBe(false);
  });

  it("returns false for a malformed range token", () => {
    expect(satisfiesSemver("0.80.0", "garbage")).toBe(false);
  });
});
