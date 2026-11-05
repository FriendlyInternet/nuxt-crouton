#!/usr/bin/env node
// Guard for GitHub's 21,000-char expression limit (#3382). A string containing `${{ }}` is rewritten
// by GitHub into format('<literal>', expr…), which DOUBLES every `{`, `}` and `'` in the literal.
// A 20,875-char script therefore became 21,312 and the whole workflow file was rejected (all
// dispatches silently dropped). actionlint does not check this, so we do. Node core only (no install).
import fs from 'node:fs'
import path from 'node:path'

const LIMIT = 21000

/** Yield { line, key, value } for block scalars and single-line values containing `${{`. */
export function scalarsOf(text) {
  const lines = text.split('\n')
  const out = []
  const indentOf = (l) => l.match(/^ */)[0].length
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*(?:- )?)([A-Za-z0-9_.-]+):\s*(.*)$/)
    if (!m) continue
    const keyIndent = m[1].length
    const rest = m[3].replace(/\s+#.*$/, '')
    if (/^[|>][+-]?\d?$/.test(rest)) {
      const body = []
      let j = i + 1
      let base = -1
      for (; j < lines.length; j++) {
        const l = lines[j]
        if (l.trim() === '') { body.push(''); continue }
        const ind = indentOf(l)
        if (ind <= keyIndent) break
        if (base < 0) base = ind
        body.push(l.slice(Math.min(base, ind)))
      }
      while (body.length && body[body.length - 1] === '') body.pop()
      out.push({ line: i + 1, key: m[2], value: body.join('\n'), block: true })
      i = j - 1
    } else if (m[3].includes('${{')) {
      out.push({ line: i + 1, key: m[2], value: m[3], block: false })
    }
  }
  return out
}

/** Length GitHub sees after rewriting the string to format(). 0 when there is no expression. */
export function formatLength(value) {
  if (!value.includes('${{')) return 0
  const parts = value.split(/\$\{\{([\s\S]*?)\}\}/g)
  let n = "format('".length + "'".length + ')'.length
  let idx = 0
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      const lit = parts[i]
      n += lit.length + (lit.match(/[{}']/g) || []).length
    } else {
      n += `{${idx++}}`.length + ', '.length + parts[i].trim().length
    }
  }
  return n
}

export function check(text, { limit = 18000, warnAt = 15000, file = '' } = {}) {
  const errors = []
  const warnings = []
  let max = { len: 0, line: 0 }
  let expressions = 0
  for (const s of scalarsOf(text)) {
    const fl = formatLength(s.value)
    if (fl) expressions++
    if (fl > max.len) max = { len: fl, line: s.line }
    const at = `${file}:${s.line} (${s.key})`
    if (fl > limit) {
      errors.push({ line: s.line, message: `${at} is ${fl} chars after GitHub's format() rewrite (limit 21000, margin ${limit}). Move \${{ }} into env: or move the script into scripts/.` })
    } else if (s.block && s.value.length > warnAt) {
      warnings.push({ line: s.line, message: `${at} is ${s.value.length} chars of inline script — one \${{ }} placeholder from GitHub's 21000 expression limit. Move it into scripts/.` })
    }
  }
  return { errors, warnings, max, expressions }
}

function defaultFiles() {
  const files = []
  const wf = '.github/workflows'
  if (fs.existsSync(wf)) for (const f of fs.readdirSync(wf)) if (/\.ya?ml$/.test(f)) files.push(path.join(wf, f))
  const ac = '.github/actions'
  if (fs.existsSync(ac)) for (const d of fs.readdirSync(ac)) for (const n of ['action.yml', 'action.yaml']) {
    const p = path.join(ac, d, n)
    if (fs.existsSync(p)) files.push(p)
  }
  return files.sort()
}

function main(argv) {
  const args = argv.length ? argv : defaultFiles()
  let failed = false
  let expressions = 0
  let max = { len: 0, file: '', line: 0 }
  for (const a of args) {
    const text = a === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(a, 'utf8')
    const file = a === '-' ? '<stdin>' : a
    const r = check(text, { file })
    expressions += r.expressions
    if (r.max.len > max.len) max = { ...r.max, file }
    for (const e of r.errors) { failed = true; console.log(`::error file=${file},line=${e.line}::${e.message}`) }
    for (const w of r.warnings) console.log(`::warning file=${file},line=${w.line}::${w.message}`)
  }
  console.log(`checked ${args.length} files, ${expressions} expression strings, max format length ${max.len} (${max.file}:${max.line})`)
  return failed ? 1 : 0
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main(process.argv.slice(2)))
