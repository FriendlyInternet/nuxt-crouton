#!/usr/bin/env node
// Extract the clean-room command block from the getting-started page.
// The page is the single source of truth: the clean-room check runs exactly
// these lines, so the page and the check cannot drift.
//
// Usage: node scripts/clean-room-commands.mjs [page.md]   (prints one command per line)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const PAGE = 'docs/content/1.getting-started/0.start-here.md'
export const MARKER = '<!-- clean-room -->'
export const MAX_COMMANDS = 5

/** Return the commands in the fenced block that follows the marker. Throws on any malformed page. */
export function extractCommands(markdown) {
  const parts = markdown.split(MARKER)
  if (parts.length !== 2) throw new Error(`expected exactly one ${MARKER} marker, found ${parts.length - 1}`)
  const m = parts[1].match(/^\s*```[^\n]*\n([\s\S]*?)\n```/)
  if (!m) throw new Error(`${MARKER} must be followed directly by a fenced code block`)
  const commands = m[1].split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  if (!commands.length) throw new Error('clean-room block is empty')
  if (commands.length > MAX_COMMANDS) throw new Error(`clean-room block has ${commands.length} commands; max is ${MAX_COMMANDS}`)
  return commands
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(extractCommands(readFileSync(process.argv[2] || PAGE, 'utf8')).join('\n'))
  } catch (e) {
    console.error(`clean-room-commands: ${e.message}`)
    process.exit(1)
  }
}
