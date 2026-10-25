#!/usr/bin/env node
/**
 * Render a pi pipeline persona (#2431, WS9 of #2108) — replaces the printf chains that used
 * to assemble the worker/decomposer prompts inside the workflow YAML.
 *
 *   node scripts/pipeline-prompt.mjs pi-worker --var issue=1932 --var branch_instr="branch off main …"
 *   node scripts/pipeline-prompt.mjs pi-decomposer --var issue=1932
 *   node scripts/pipeline-prompt.mjs pi-reviser --var pr=12 --var issue=1932 --var-file feedback=<path>
 *
 * `--var-file k=path` reads the value from a file VERBATIM — the owner's comment must reach pi
 * byte-for-byte, and `--var k="$(cat f)"` would strip its trailing newlines.
 *
 * Output = the shared operating contract + the agent file body (frontmatter stripped,
 * `{{name}}` replaced by --var) + any files named by the agent's `appends:` frontmatter.
 * A `{{var}}` with no --var is a hard error (a silent empty value is how prompts rot).
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const AGENTS = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude/agents')

export function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  return m ? { fm: m[1], body: m[2] } : { fm: '', body: text }
}

export function renderPrompt(agent, vars = {}) {
  if (!/^[\w-]+$/.test(agent)) throw new Error(`bad agent name: ${agent}`)
  const read = (n) => readFileSync(join(AGENTS, n), 'utf8')
  const { fm, body } = splitFrontmatter(read(`${agent}.md`))
  const fill = (s) =>
    s.replace(/\{\{(\w+)\}\}/g, (_, k) => {
      if (!(k in vars)) throw new Error(`missing --var ${k} for ${agent}`)
      return vars[k]
    })
  const appends = (fm.match(/^appends:\s*(\S+)/m) || [])[1]
  return read('pi-operating-contract.md') + fill(body) + (appends ? fill(read(appends)) : '')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [agent, ...rest] = process.argv.slice(2)
  const vars = {}
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]
    if (flag !== '--var' && flag !== '--var-file') continue
    const kv = rest[++i] || ''
    const eq = kv.indexOf('=')
    if (eq < 1) { console.error(`bad ${flag}: ${kv}`); process.exit(2) }
    const val = kv.slice(eq + 1)
    try {
      vars[kv.slice(0, eq)] = flag === '--var-file' ? readFileSync(val, 'utf8') : val
    } catch (e) {
      console.error(`${flag} ${kv}: ${e.message}`)
      process.exit(1)
    }
  }
  if (!agent) { console.error('usage: pipeline-prompt.mjs <agent> --var k=v …'); process.exit(2) }
  try {
    process.stdout.write(renderPrompt(agent, vars))
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
