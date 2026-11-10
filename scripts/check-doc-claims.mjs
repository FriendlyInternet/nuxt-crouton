#!/usr/bin/env node
/**
 * Doc checks (#3166, part of #3163) — most wrong docs are wrong in ways a script can see.
 *
 * Runs over docs/content/**.md and prints ONE report. Report-only by default (exit 0);
 * pass --strict to exit 1 on any finding (flip the CI step to --strict once the rebuilt
 * sections pass).
 *
 *   1. names     — `crouton <command>` named in a page exists in the CLI; `refTarget`-style
 *                  field "type" values and <Component>/useComposable names exist in code
 *   2. schemas   — every ```json block that looks like a collection schema uses known field types
 *   3. code      — ```ts / ```js blocks parse (syntax only; blocks containing `...` or `// ...`
 *                  are fragments and skipped, or mark a block `<!-- doc-check: skip -->` above it)
 *   4. tutorials — NOT automated here: following getting-started in an empty folder needs a
 *                  network install. Listed in the report as "not run".
 *
 * Usage: node scripts/check-doc-claims.mjs [--strict] [--json] [docsDir]
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ---------- parsing ----------

export function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (e === 'node_modules') continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.md')) out.push(p)
  }
  return out
}

/** Fenced code blocks with 1-based start line; `skip` when preceded by a skip marker. */
export function extractBlocks(md) {
  const lines = md.split('\n')
  const blocks = []
  let cur = null
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(`{3,})\s*([\w-]*)/)
    if (!m) { if (cur) cur.body.push(lines[i]); continue }
    if (!cur) {
      const prev = (lines[i - 1] || '').trim()
      cur = { lang: m[3], fence: m[2], line: i + 1, body: [], skip: /doc-check:\s*skip/.test(prev) }
    } else if (m[2].length >= cur.fence.length && !m[3]) {
      blocks.push({ ...cur, code: cur.body.join('\n') })
      cur = null
    } else cur.body.push(lines[i])
  }
  return blocks
}

const isFragment = (code) => /(^|\s)\.\.\.(\s|$)|\/\/\s*\.\.\./.test(code)

// ---------- code-side facts ----------

export function cliCommands(src) {
  const names = new Set()
  for (const m of src.matchAll(/meta:\s*\{\s*name:\s*'([\w-]+)'/g)) names.add(m[1])
  for (const m of src.matchAll(/^\s*'?([\w-]+)'?:\s*\w+Cmd\b/gm)) names.add(m[1])
  return names
}

export function snapshotFieldTypes(src) {
  const start = src.indexOf('FIELD_TYPES_SNAPSHOT')
  const types = new Set()
  // top-level keys are indented exactly 2 spaces inside the object literal
  for (const m of src.slice(start).matchAll(/^ {2}"([\w-]+)": \{/gm)) types.add(m[1])
  return types
}

// ---------- checks ----------

export function checkNames(file, md, facts) {
  const hits = []
  md.split('\n').forEach((text, i) => {
    for (const m of text.matchAll(/\bcrouton\s+([a-z][a-z-]+)\b/g)) {
      const cmd = m[1]
      // only judge the CLI binary invocation: preceded by npx/pnpm/`$` or start of a code span/line
      const before = text.slice(0, m.index)
      if (!/(npx\s+|pnpm\s+(dlx\s+)?|^\s*\$?\s*|`)$/.test(before)) continue
      if (!facts.commands.has(cmd)) hits.push({ file, line: i + 1, check: 'names', msg: `CLI command \`crouton ${cmd}\` does not exist` })
    }
  })
  return hits
}

const SCHEMA_KEYS = new Set(['type', 'meta', 'refTarget'])
function stripJsonComments(s) {
  return s.replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/[^"\n]*$/gm, '')
}

export function checkSchemas(file, blocks, facts) {
  const hits = []
  for (const b of blocks) {
    if (b.lang !== 'json' || b.skip) continue
    let obj
    try { obj = JSON.parse(stripJsonComments(b.code)) } catch { continue } // not valid JSON → fragment
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) continue
    const entries = Object.entries(obj)
    const fields = entries.filter(([, v]) => v && typeof v === 'object' && typeof v.type === 'string' && Object.keys(v).every(k => SCHEMA_KEYS.has(k)))
    if (!entries.length || fields.length !== entries.length) continue // not a collection schema
    for (const [name, f] of fields) {
      if (!facts.fieldTypes.has(f.type)) hits.push({ file, line: b.line, check: 'schemas', msg: `field "${name}" uses unknown type "${f.type}"` })
    }
  }
  return hits
}

export function checkCode(file, blocks, ts) {
  const hits = []
  for (const b of blocks) {
    if (b.skip || !['ts', 'typescript', 'js', 'javascript', 'tsx'].includes(b.lang) || isFragment(b.code)) continue
    const out = ts.transpileModule(b.code, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } })
    const d = out.diagnostics?.[0] // one finding per block, not per diagnostic
    if (d) {
      const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0)
      hits.push({ file, line: b.line + 1 + line, check: 'code', msg: `syntax: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')} (block at line ${b.line})` })
    }
  }
  return hits
}

// ---------- main ----------

export function loadFacts() {
  const cli = readFileSync(join(root, 'packages/crouton-cli/bin/crouton-generate.js'), 'utf8')
  const snap = readFileSync(join(root, 'packages/crouton-mcp/src/utils/field-types.snapshot.ts'), 'utf8')
  return { commands: cliCommands(cli), fieldTypes: snapshotFieldTypes(snap) }
}

export function run(docsDir, facts, ts) {
  const per = { names: [], schemas: [], code: [], tutorials: [] }
  for (const f of walk(docsDir)) {
    const md = readFileSync(f, 'utf8')
    const rel = relative(root, f)
    const blocks = extractBlocks(md)
    per.names.push(...checkNames(rel, md, facts))
    per.schemas.push(...checkSchemas(rel, blocks, facts))
    if (ts) per.code.push(...checkCode(rel, blocks, ts))
  }
  return per
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const docsDir = args.find(a => !a.startsWith('--')) ?? join(root, 'docs/content')
  let ts = null
  try { ts = createRequire(import.meta.url)('typescript') } catch { /* reported below */ }
  if (!existsSync(docsDir)) { console.error(`no such dir: ${docsDir}`); process.exit(2) }
  const facts = loadFacts()
  if (!facts.commands.size || !facts.fieldTypes.size) {
    console.error('could not read CLI commands / field types from code — refusing to report "all clear"')
    process.exit(2)
  }
  const per = run(docsDir, facts, ts)
  if (args.includes('--json')) console.log(JSON.stringify(per, null, 2))
  else {
    console.log('# Doc checks')
    for (const k of ['names', 'schemas', 'code']) {
      console.log(`\n## ${k}: ${per[k].length} finding(s)${k === 'code' && !ts ? ' (typescript not installed — NOT RUN)' : ''}`)
      for (const h of per[k]) console.log(`  ${h.file}:${h.line}  ${h.msg}`)
    }
    console.log('\n## tutorials: not run (needs a network install in an empty folder)')
  }
  const total = per.names.length + per.schemas.length + per.code.length
  console.log(`\nTotal: ${total}`)
  if (args.includes('--strict') && total) process.exit(1)
}
