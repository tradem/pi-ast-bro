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
 * Minimum supported ast-bro CLI range. Adjust this when the extension starts
 * depending on newer ast-bro flags or output formats.
 */
export const SUPPORTED_AST_BRO_RANGE = ">=0.1.0";
