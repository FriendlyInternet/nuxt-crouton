#!/usr/bin/env node
/**
 * Doc checks (#3166, part of #3163) — most wrong docs are wrong in ways a script can see.
 *
 * Runs over docs/content/**.md and prints ONE report. Report-only by default (exit 0);
 * pass --strict to exit 1 on any finding (flip the CI step to --strict once the rebuilt
 * sections pass).
 *
 * The code-side lists (component props, CLI commands + flags, field types) come from the
 * api-reference generator (scripts/gen-api-reference.mjs, #3661) — this script does not parse
 * that code a second time. Needs `typescript` + `vue-component-meta`, so it runs in the CI job
 * that installs packages; without them the import fails and the run exits non-zero
 * ("could not run" is never a pass).
 *
 *   1. names     — `crouton <command>` and its `--flags` exist in the CLI; <CroutonX> components
 *                  and useCroutonX composables exist in packages/; props passed to a crouton-core
 *                  component exist on it (config keys: follow once #3702 adds that list)
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
import { propsOf, componentFiles, componentName, COMPONENTS_DIR, cliCommandsOf, fieldTypesOf } from './gen-api-reference.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ts = createRequire(import.meta.url)('typescript')

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
const camel = s => s.replace(/-(\w)/g, (_, c) => c.toUpperCase())

/** Every identifier-ish word in package sources (ts/vue/js/mjs) + Nuxt path-derived component names.
 *  Existence only, across ALL packages — the generator lists crouton-core alone. */
export function sourceWords(pkgDir) {
  const words = new Set()
  const visit = (d, parts) => {
    for (const e of readdirSync(d)) {
      if (['node_modules', 'dist', '.nuxt', '.output', '.git'].includes(e)) continue
      const p = join(d, e)
      if (statSync(p).isDirectory()) { visit(p, [...parts, e]); continue }
      if (!/\.(ts|vue|js|mjs|json)$/.test(e)) continue
      for (const m of readFileSync(p, 'utf8').matchAll(/\b(?:Crouton|use)[A-Za-z0-9]+/g)) words.add(m[0])
      if (e.endsWith('.vue')) {
        const i = parts.lastIndexOf('components')
        const pas = (x) => x.replace(/(^|[-_.])(\w)/g, (_, __, c) => c.toUpperCase())
        if (i >= 0) words.add(pas([...parts.slice(i + 1), e.replace('.vue', '')].join('-')))
        words.add(pas(e.replace('.vue', '')))
      }
    }
  }
  visit(pkgDir, [])
  return words
}

/** `<Tag attr="v" :x='y' @e="z">` starting at `i` (the `<`): attribute names + the index after `>`. */
export function readTag(text, i) {
  const attrs = []
  const nameEnd = text.slice(i).search(/[\s/>]/) // past the tag name
  let j = nameEnd < 0 ? text.length : i + nameEnd
  while (j < text.length) {
    while (/\s/.test(text[j] ?? '')) j++
    if (text[j] === '>' || text[j] === undefined) break
    if (text[j] === '/') { j++; continue }
    if (text.startsWith('<!--', j)) { const end = text.indexOf('-->', j); j = end < 0 ? text.length : end + 3; continue } // a comment between attributes
    const start = j
    while (j < text.length && !/[\s=/>]/.test(text[j])) j++
    const name = text.slice(start, j)
    if (!name) { j++; continue }
    while (/\s/.test(text[j] ?? '')) j++
    if (text[j] === '=') {
      j++
      while (/\s/.test(text[j] ?? '')) j++
      const q = text[j]
      if (q === '"' || q === "'") { const end = text.indexOf(q, j + 1); j = end < 0 ? text.length : end + 1 } else while (j < text.length && !/[\s>]/.test(text[j])) j++
    }
    attrs.push({ name, index: start })
  }
  return { attrs, end: j }
}

const FALLTHROUGH = new Set(['class', 'style', 'key', 'ref', 'id', 'is'])
/** The prop an attribute sets, or null when it is not a prop (events, slots, directives, html attrs). */
export function propOfAttr(attr) {
  if (/^(@|#|v-on:|v-slot)/.test(attr)) return null
  if (attr === 'v-model' || /^v-model\./.test(attr)) return 'modelValue'
  const vm = attr.match(/^v-model:([\w-]+)/)
  if (vm) return camel(vm[1])
  if (attr.startsWith('v-') && !attr.startsWith('v-bind:')) return null
  const name = attr.replace(/^(:|v-bind:)/, '').split('.')[0]
  if (!name || FALLTHROUGH.has(name) || /^(data|aria)-/.test(name)) return null
  return camel(name)
}

// ---------- checks ----------

const lineAt = (text, index) => text.slice(0, index).split('\n').length

/** `<CroutonFoo` components and `useCroutonFoo()` composables named in a page must exist in package code. */
export function checkSymbols(file, md, facts) {
  const hits = []
  md.split('\n').forEach((text, i) => {
    for (const m of text.matchAll(/<(Crouton[A-Za-z0-9]+)|\b(useCrouton[A-Za-z0-9]*)\s*\(/g)) {
      const n = m[1] ?? m[2]
      if (!facts.words.has(n) && !facts.words.has(n.replace(/^Crouton/, ''))) hits.push({ file, line: i + 1, check: 'names', msg: `${m[1] ? 'component' : 'composable'} \`${n}\` not found in packages/` })
    }
  })
  return hits
}

/** Props passed to a crouton-core component must be props of it (read by the generator's propsOf). */
export function checkProps(file, md, facts) {
  const hits = []
  for (const m of md.matchAll(/<(Crouton[A-Za-z0-9]+)(?=[\s/>])/g)) {
    const comp = facts.components.get(m[1])
    if (!comp) continue // not a crouton-core component: existence is checkSymbols' job
    const { attrs } = readTag(md, m.index)
    for (const a of attrs) {
      const prop = propOfAttr(a.name)
      if (prop && !comp.props().has(prop)) hits.push({ file, line: lineAt(md, a.index), check: 'names', msg: `\`<${m[1]}>\` has no prop \`${prop}\` (from \`${a.name}\`)` })
    }
  }
  return hits
}

const GLOBAL_FLAGS = new Set(['help', 'version', 'h', 'v'])
/** Is `flag` (e.g. `--dry-run`, `--no-db`, `-f`) an argument of `cmd`? */
export function flagExists(cmd, flag) {
  const args = cmd.args
  const short = flag.match(/^-([A-Za-z])$/)
  if (short) return GLOBAL_FLAGS.has(short[1]) || Object.values(args).some(a => a.alias === short[1])
  const name = flag.replace(/^--/, '')
  if (GLOBAL_FLAGS.has(name)) return true
  const key = camel(name)
  const negated = key.replace(/^no([A-Z])/, (_, c) => c.toLowerCase())
  return key in args || (key !== negated && args[negated]?.type === 'boolean')
}

/** `crouton <command>` invocations: the command must exist, and every flag on it must be one of its args. */
export function checkCli(file, md, facts) {
  const hits = []
  md.split('\n').forEach((text, i) => {
    for (const m of text.matchAll(/\bcrouton\s+([a-z][a-z-]+)\b/g)) {
      const name = m[1]
      // only judge the CLI binary invocation: preceded by npx/pnpm/`$` or start of a code span/line
      const before = text.slice(0, m.index)
      if (!/(npx\s+|pnpm\s+(dlx\s+)?|^\s*\$?\s*|`)$/.test(before)) continue
      const cmd = facts.commands.get(name)
      if (!cmd) { hits.push({ file, line: i + 1, check: 'names', msg: `CLI command \`crouton ${name}\` does not exist` }); continue }
      // the rest of this invocation: up to the end of the code span, a pipe/&&/;, or the line
      const rest = text.slice(m.index + m[0].length).split(/`|&&|\|\||[|;#]/)[0]
      for (const f of rest.matchAll(/(?:^|\s)(--?[A-Za-z][\w-]*)/g)) {
        if (!flagExists(cmd, f[1])) hits.push({ file, line: i + 1, check: 'names', msg: `\`crouton ${name}\` has no flag \`${f[1]}\`` })
      }
    }
  })
  return hits
}

const SCHEMA_KEYS = new Set(['type', 'meta', 'refTarget'])
function stripJsonComments(s) {
  return s.replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/[^"\n]*$/gm, '')
}

function parseSchemaFields(b) {
  if (b.lang !== 'json' || b.skip) return null
  let obj
  try { obj = JSON.parse(stripJsonComments(b.code)) } catch { return null } // not valid JSON → fragment
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const entries = Object.entries(obj)
  const isField = ([, v]) => v && typeof v === 'object' && typeof v.type === 'string' && Object.keys(v).every(k => SCHEMA_KEYS.has(k))
  const fields = entries.filter(isField)
  return entries.length && fields.length === entries.length ? fields : null // else not a collection schema
}

export function checkSchemas(file, blocks, facts) {
  const hits = []
  for (const b of blocks) {
    for (const [name, f] of parseSchemaFields(b) ?? []) {
      if (!facts.fieldTypes.has(f.type)) hits.push({ file, line: b.line, check: 'schemas', msg: `field "${name}" uses unknown type "${f.type}"` })
    }
  }
  return hits
}

export function checkCode(file, blocks) {
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

/** The code-side lists, all from the generator except the all-packages existence word list. */
export function loadFacts() {
  const components = new Map()
  // stubs/ are placeholders the real package (maps, editor, ...) overrides: their props are not the real ones
  for (const f of componentFiles().filter(f => !f.startsWith('stubs/'))) {
    let props
    // propsOf runs the Vue checker, so only pay for components a page actually passes props to
    components.set(componentName(f), { props: () => (props ??= new Set(propsOf(`${COMPONENTS_DIR}/${f}`).props.map(p => p.name))) })
  }
  const fieldTypes = new Set(fieldTypesOf().flatMap(t => [t.name, ...(t.def.aliases ?? [])]))
  return { commands: new Map(cliCommandsOf().map(c => [c.name, c])), fieldTypes, components, words: sourceWords(join(root, 'packages')) }
}

export function run(docsDir, facts) {
  const per = { names: [], schemas: [], code: [], tutorials: [] }
  for (const f of walk(docsDir)) {
    const md = readFileSync(f, 'utf8')
    const rel = relative(root, f)
    const blocks = extractBlocks(md)
    per.names.push(...checkCli(rel, md, facts))
    per.names.push(...checkSymbols(rel, md, facts))
    per.names.push(...checkProps(rel, md, facts))
    per.schemas.push(...checkSchemas(rel, blocks, facts))
    per.code.push(...checkCode(rel, blocks))
  }
  return per
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const docsDir = args.find(a => !a.startsWith('--')) ?? join(root, 'docs/content')
  if (!existsSync(docsDir)) { console.error(`no such dir: ${docsDir}`); process.exit(2) }
  const facts = loadFacts()
  if (!facts.commands.size || !facts.fieldTypes.size || !facts.components.size) {
    console.error('could not read CLI commands / field types / components from code — refusing to report "all clear"')
    process.exit(2)
  }
  const per = run(docsDir, facts)
  if (args.includes('--json')) console.log(JSON.stringify(per, null, 2))
  else {
    console.log('# Doc checks')
    for (const k of ['names', 'schemas', 'code']) {
      console.log(`\n## ${k}: ${per[k].length} finding(s)`)
      for (const h of per[k]) console.log(`  ${h.file}:${h.line}  ${h.msg}`)
    }
    console.log('\n## tutorials: not run (needs a network install in an empty folder)')
  }
  const total = per.names.length + per.schemas.length + per.code.length
  console.log(`\nTotal: ${total}`)
  if (args.includes('--strict') && total) process.exit(1)
}
