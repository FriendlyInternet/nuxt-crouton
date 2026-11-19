/**
 * #3881 — the epic splitter's branch lookup must never pick up a branch set aside by /fresh-branch.
 * An ls-remote pattern that doesn't start with `refs/` matches the END of a ref name, so
 * `epic/9-*` also finds `refs/heads/archive/epic/9-x`. These checks read the workflow's REAL
 * pattern and run it against a real bare repo.
 *
 *   node --test scripts/epic-branch-lookup.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WF = readFileSync(new URL('../.github/workflows/decompose-on-issue-pidev.yml', import.meta.url), 'utf8')
const lookups = WF.split('\n').filter(l => l.includes('ls-remote --heads'))
const patternOf = l => (l.match(/ls-remote --heads \S+ "([^"]+)"/) || [])[1]

test('(8a) every ls-remote --heads in the splitter passes a pattern anchored to refs/heads/', () => {
  assert.ok(lookups.length >= 1, 'expected the epic-branch lookup in decompose-on-issue-pidev.yml')
  for (const l of lookups) assert.match(l, /ls-remote --heads \S+ "refs\/heads\//, `unanchored lookup: ${l.trim()}`)
})

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

test('(8b) the workflow pattern ignores archive/epic/9-x and finds epic/9-x', (t) => {
  const pattern = patternOf(lookups[0]).replace('${EPIC}', '9')
  const dir = mkdtempSync(join(tmpdir(), 'epic-lookup-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const work = join(dir, 'work')
  const bare = join(dir, 'r.git')
  git(dir, ['init', '-q', '--bare', bare])
  git(dir, ['init', '-q', work])
  git(work, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init'])
  const sha = git(work, ['rev-parse', 'HEAD'])
  for (const b of ['archive/epic/9-x', 'epic/10-y']) git(work, ['push', '-q', bare, `${sha}:refs/heads/${b}`])

  assert.equal(git(dir, ['ls-remote', '--heads', bare, pattern]), '')
  git(work, ['push', '-q', bare, `${sha}:refs/heads/epic/9-x`])
  const out = git(dir, ['ls-remote', '--heads', bare, pattern]).split('\n').map(l => l.split(/\s+/)[1])
  assert.deepEqual(out, ['refs/heads/epic/9-x'])
})
