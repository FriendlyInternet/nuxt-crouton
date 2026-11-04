#!/usr/bin/env node
// Publish PNGs to a non-branch ref (refs/review-captures/<key>) as an orphan commit, then verify
// every commit-pinned raw URL really serves an image (#3351).
//   node scripts/publish-review-captures.mjs --dir <dir> --key pr42|issue7 [--repo owner/name]
// Prints `sha=<commit>` and `url=<raw url>` lines; exits 1 if anything fails to publish or resolve.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureRef, rawImageUrl } from './lib/review-captures.mjs'

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined }
const dir = arg('dir')
const key = arg('key')
const repo = arg('repo') || process.env.GITHUB_REPOSITORY
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
const fail = (m) => { console.error(`publish-review-captures: ${m}`); process.exit(1) }
if (!dir || !key || !repo) fail('usage: --dir <dir> --key <pr<N>|issue<N>> [--repo o/r]')
if (!token) fail('GH_TOKEN is required')
const ref = captureRef(key)

const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png')).sort()
if (!files.length) fail(`no PNGs in ${dir}`)

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
const tmp = mkdtempSync(join(tmpdir(), 'review-captures-'))
for (const f of files) copyFileSync(join(dir, f), join(tmp, f))
const git = (...a) => run('git', a, { cwd: tmp })
git('init', '-q')
git('config', 'user.name', 'nuxt-harness[bot]')
git('config', 'user.email', '295566920+nuxt-harness[bot]@users.noreply.github.com')
git('add', '-f', '--', ...files) // *.png is gitignored — without -f this silently adds nothing
if (!git('diff', '--cached', '--name-only')) fail('nothing staged (ignored?)')
git('commit', '-q', '-m', `review captures ${key}`)
const sha = git('rev-parse', 'HEAD')

let pushed = false
try {
  git('push', '--force', `https://x-access-token:${token}@github.com/${repo}.git`, `HEAD:${ref}`)
  pushed = true
} catch (e) {
  console.error(`git push refused (${String(e.stderr || e.message).split('\n')[0]}); trying the refs API`)
}
if (!pushed) {
  // The objects must exist remotely for the API path; if push was refused entirely, the ref API cannot help.
  fail('push of the capture ref failed')
}

const bad = []
for (const f of files) {
  const url = rawImageUrl({ repo, sha, file: f })
  let ok = false
  for (let i = 0; i < 4 && !ok; i++) {
    try {
      const r = await fetch(url)
      ok = r.status === 200 && (r.headers.get('content-type') || '').includes('image/png')
    } catch { /* retry */ }
    if (!ok) await new Promise((r) => setTimeout(r, 2000))
  }
  console.log(`url=${url}`)
  if (!ok) bad.push(f)
}
console.log(`sha=${sha}`)
if (bad.length) fail(`raw URL did not serve image/png for: ${bad.join(', ')}`)
