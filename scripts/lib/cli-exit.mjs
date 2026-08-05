#!/usr/bin/env node
/**
 * Shared CLI exit-code convention (#1918).
 *
 * `scripts/harness-stages.mjs` and `scripts/schema-diff.mjs` already agree on this
 * convention (0 success, 2 usage error, 1 other failure) — this just names it so new
 * scripts can adopt it instead of re-inventing their own codes.
 */

export const OK = 0
export const USAGE = 2
export const FAILED = 1

/**
 * Print a usage error to stderr and return the USAGE exit code.
 * Does not call process.exit — the caller decides when/whether to exit.
 */
export function usage(msg) {
  console.error(msg)
  return USAGE
}
