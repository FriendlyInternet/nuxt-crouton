#!/usr/bin/env node
// pi-session-redact.mjs — copy a pi session dir with secrets removed, for upload (#4161).
//
// The session JSONL holds raw tool output. The repo is public, so any signed-in user can download
// a workflow artifact, and GitHub's log masking does not apply to artifact contents. So the
// record is redacted before it is uploaded:
//   (a) the exact value of every env var named in REDACT_VARS (comma list; values shorter
//       than 8 characters are ignored) → `[REDACTED:<NAME>]`
//   (b) any leftover token shape (GitHub tokens, Anthropic keys, Authorization headers,
//       PEM private keys) → `[REDACTED]`
//
//   node scripts/pi-session-redact.mjs <src-dir> <out-dir>
//
// Dependency-free. Always exits 0 (it runs on the failure path); a missing src copies nothing.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const TOKEN_SHAPES = [
  /gh[opsur]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /authorization: *(?:basic|bearer) +[A-Za-z0-9+/=._-]+/gi,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
]

/** `[{ name, value }]` for every REDACT_VARS name whose value is at least 8 characters. */
export function secretsFromEnv(env = process.env) {
  return String(env.REDACT_VARS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .map((name) => ({ name, value: String(env[name] ?? '') }))
    .filter((s) => s.value.length >= 8)
    // Longest first, so a secret that contains another is replaced whole.
    .sort((a, b) => b.value.length - a.value.length)
}

/** Redact one text. Returns `{ text, count }`. */
export function redactText(text, secrets = []) {
  let out = String(text)
  let count = 0
  for (const { name, value } of secrets) {
    const parts = out.split(value)
    if (parts.length > 1) { count += parts.length - 1; out = parts.join(`[REDACTED:${name}]`) }
  }
  for (const re of TOKEN_SHAPES) {
    out = out.replace(re, () => { count++; return '[REDACTED]' })
  }
  return { text: out, count }
}

/** Relative paths of every regular file under `src` (an unreadable directory is skipped). */
function listFiles(src) {
  const files = []
  const stack = ['']
  while (stack.length) {
    const rel = stack.pop()
    let entries = []
    try { entries = fs.readdirSync(path.join(src, rel), { withFileTypes: true }) } catch { /* skip */ }
    for (const e of entries) {
      const r = path.join(rel, e.name)
      if (e.isDirectory()) stack.push(r)
      else if (e.isFile()) files.push(r)
    }
  }
  return files
}

/** Redact one file from `src` into `out`. Returns the replacement count (0 if it is unreadable). */
function redactFile(src, out, rel, secrets) {
  try {
    const { text, count } = redactText(fs.readFileSync(path.join(src, rel), 'utf8'), secrets)
    fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true })
    fs.writeFileSync(path.join(out, rel), text)
    return count
  } catch { return 0 /* skip an unreadable file rather than fail the job */ }
}

/** Copy every regular file under `src` into `out` (same relative paths), redacted. */
export function redactDir(src, out, secrets = []) {
  let values = 0, files = 0
  if (!src || !fs.existsSync(src)) return { values, files }
  for (const rel of listFiles(src)) {
    const count = redactFile(src, out, rel, secrets)
    if (count) { values += count; files++ }
  }
  return { values, files }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2)
  try {
    const r = redactDir(src, out || 'pi-session-out', secretsFromEnv())
    console.log(`redacted ${r.values} value(s) in ${r.files} file(s)`)
  } catch (e) {
    console.log(`pi-session-redact: skipped (${e.message})`)
  }
  process.exit(0)
}
