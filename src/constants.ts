/**
 * Supported runtime version ranges.
 *
 * These ranges are checked at startup so the extension can warn or disable
 * itself before invoking commands that the runtime does not understand.
 */

/**
 * Targeted pi-coding-agent range. Mismatches currently produce a warning rather
 * than a hard disable, because pi moves quickly and newer versions are often
 * backwards-compatible.
 */
export const SUPPORTED_PI_RANGE = "^0.79.8";

/**
 * Supported ast-bro CLI range. 3.0.0 introduced the commands and output
 * formats this extension relies on; 3.2.x may introduce breaking changes.
 */
export const SUPPORTED_AST_BRO_RANGE = ">=3.0.0 <3.2.0";
