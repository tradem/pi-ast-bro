import { describe, expect, it } from "vitest";
import {
  looksLikePath,
  normalizeFilePath,
  normalizeSymbol,
  parseAstTarget,
} from "../src/utils.js";

describe("normalizeSymbol", () => {
  it("trims whitespace and strips paired quotes/backticks/parentheses", () => {
    expect(normalizeSymbol("  make_ctx  ")).toBe("make_ctx");
    expect(normalizeSymbol("`make_ctx`")).toBe("make_ctx");
    expect(normalizeSymbol('"make_ctx"')).toBe("make_ctx");
    expect(normalizeSymbol("'make_ctx'")).toBe("make_ctx");
    expect(normalizeSymbol("(make_ctx)")).toBe("make_ctx");
  });

  it("strips leading language keywords and modifiers", () => {
    expect(normalizeSymbol("fn make_ctx")).toBe("make_ctx");
    expect(normalizeSymbol("pub fn make_ctx")).toBe("make_ctx");
    expect(normalizeSymbol("struct Player")).toBe("Player");
    expect(normalizeSymbol("impl Player")).toBe("Player");
    expect(normalizeSymbol("trait Command")).toBe("Command");
    expect(normalizeSymbol("interface Command")).toBe("Command");
    expect(normalizeSymbol("class HttpHandler")).toBe("HttpHandler");
    expect(normalizeSymbol("async fn fetch_data")).toBe("fetch_data");
    expect(normalizeSymbol("pub(crate) fn internal_only")).toBe("internal_only");
  });

  it("strips trailing call/return annotations, generics, and braces", () => {
    expect(normalizeSymbol("make_ctx()")).toBe("make_ctx");
    expect(normalizeSymbol("Player.take_damage()")).toBe("Player.take_damage");
    expect(normalizeSymbol("fn make_ctx<T>(x: &str) -> Result<()>")).toBe("make_ctx");
    expect(normalizeSymbol("Player::new<T>()")).toBe("Player::new");
    expect(normalizeSymbol("impl Player { }")).toBe("Player");
  });

  it("strips trailing punctuation and collapses whitespace around separators", () => {
    expect(normalizeSymbol("make_ctx;")).toBe("make_ctx");
    expect(normalizeSymbol("make_ctx.")).toBe("make_ctx");
    expect(normalizeSymbol("Player . take_damage")).toBe("Player.take_damage");
    expect(normalizeSymbol("ProjectId . to_string")).toBe("ProjectId.to_string");
  });

  it("leaves already-clean symbols untouched", () => {
    expect(normalizeSymbol("make_ctx")).toBe("make_ctx");
    expect(normalizeSymbol("Player.take_damage")).toBe("Player.take_damage");
    expect(normalizeSymbol("ProjectId.to_string")).toBe("ProjectId.to_string");
    expect(normalizeSymbol("Player::new")).toBe("Player::new");
    expect(normalizeSymbol("std::collections::HashMap")).toBe("std::collections::HashMap");
  });

  it("returns an empty string for empty or non-string input", () => {
    expect(normalizeSymbol("")).toBe("");
    expect(normalizeSymbol("   ")).toBe("");
    expect(normalizeSymbol(undefined as unknown as string)).toBe("");
  });

  it("does not strip mid-string shell metacharacters (injection stays detectable)", () => {
    expect(normalizeSymbol("make_ctx; rm -rf /")).toBe("make_ctx; rm -rf /");
    expect(normalizeSymbol("fn rm -rf /")).toBe("rm -rf /");
  });
});

describe("normalizeFilePath", () => {
  it("trims and strips paired quotes/backticks", () => {
    expect(normalizeFilePath("  src/lib.rs  ")).toBe("src/lib.rs");
    expect(normalizeFilePath("`src/lib.rs`")).toBe("src/lib.rs");
    expect(normalizeFilePath('"src/lib.rs"')).toBe("src/lib.rs");
  });

  it("strips a leading ./ prefix", () => {
    expect(normalizeFilePath("./src/lib.rs")).toBe("src/lib.rs");
  });

  it("returns an empty string for empty or non-string input", () => {
    expect(normalizeFilePath("")).toBe("");
    expect(normalizeFilePath(undefined as unknown as string)).toBe("");
  });
});

describe("looksLikePath", () => {
  it("recognizes path separators and file extensions", () => {
    expect(looksLikePath("src/lib.rs")).toBe(true);
    expect(looksLikePath("src/Player.cs")).toBe(true);
    expect(looksLikePath("C:\\src\\lib.rs")).toBe(true);
  });

  it("rejects bare symbols and type-qualified names", () => {
    expect(looksLikePath("make_ctx")).toBe(false);
    expect(looksLikePath("Player.take_damage")).toBe(false);
    expect(looksLikePath("Player")).toBe(false);
  });
});

describe("parseAstTarget", () => {
  it("splits an embedded path:symbol out of the symbol field", () => {
    const parsed = parseAstTarget("src/lib.rs:make_ctx");
    expect(parsed.symbol).toBe("make_ctx");
    expect(parsed.file).toBe("src/lib.rs");
    expect(parsed.changed).toBe(true);
  });

  it("splits type-qualified embedded paths (src/Player.cs:TakeDamage)", () => {
    const parsed = parseAstTarget("src/Player.cs:TakeDamage");
    expect(parsed.symbol).toBe("TakeDamage");
    expect(parsed.file).toBe("src/Player.cs");
  });

  it("prefers the explicit file parameter over an embedded path", () => {
    const parsed = parseAstTarget("src/lib.rs:make_ctx", "src/other.rs");
    expect(parsed.symbol).toBe("make_ctx");
    expect(parsed.file).toBe("src/other.rs");
  });

  it("normalizes a noisy symbol", () => {
    const parsed = parseAstTarget("`fn make_ctx<T>(x: u32)`");
    expect(parsed.symbol).toBe("make_ctx");
    expect(parsed.file).toBeUndefined();
    expect(parsed.changed).toBe(true);
  });

  it("keeps Rust path syntax (double colon) intact", () => {
    const parsed = parseAstTarget("Player::new");
    expect(parsed.symbol).toBe("Player::new");
    expect(parsed.file).toBeUndefined();
  });

  it("keeps clean bare and type-qualified symbols unchanged", () => {
    expect(parseAstTarget("make_ctx")).toEqual({ symbol: "make_ctx", file: undefined, changed: false });
    expect(parseAstTarget("Player.take_damage")).toEqual({
      symbol: "Player.take_damage",
      file: undefined,
      changed: false,
    });
  });

  it("normalizes a noisy explicit file path", () => {
    const parsed = parseAstTarget("Command", "`./src/commands.rs`");
    expect(parsed.symbol).toBe("Command");
    expect(parsed.file).toBe("src/commands.rs");
    expect(parsed.changed).toBe(true);
  });
});
