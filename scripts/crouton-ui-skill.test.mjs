// #3988 — every repo file or script the crouton-ui skill tells an agent to
// read or run exists, so none of its pointers can go stale without CI failing.
// Node core only: runs in the "Node checks" job, which installs nothing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const skillPath = join(root, '.claude/skills/crouton-ui/SKILL.md')

const read = () => {
  assert.ok(existsSync(skillPath), '.claude/skills/crouton-ui/SKILL.md must exist')
  return readFileSync(skillPath, 'utf8')
}

// covers: T1
test('frontmatter names the skill and its layer', () => {
  const text = read()
  const fm = text.match(/^---\n([\s\S]*?)\n---/)
  assert.ok(fm, 'SKILL.md must open with frontmatter')
  const lines = fm[1].split('\n')
  assert.ok(lines.includes('name: crouton-ui'), 'frontmatter has name: crouton-ui')
  assert.ok(lines.includes('layer: stack'), 'frontmatter has layer: stack')
})

// covers: T1
test('every `node scripts/…` command the skill names points at a script that exists', () => {
  const text = read()
  const tokens = [...text.matchAll(/`([^`]+)`/g)].map(m => m[1]).filter(t => t.startsWith('node scripts/'))
  assert.ok(tokens.length > 0, 'at least one `node scripts/…` command is named')
  for (const token of tokens) {
    const file = token.slice('node '.length).split(' ')[0]
    assert.ok(existsSync(join(root, file)), `${file} (from \`${token}\`) must exist`)
  }
})

// covers: T1
test('the block-authoring skill it points to exists', () => {
  const text = read()
  assert.ok(text.includes('`block-authoring`'), 'names the `block-authoring` skill')
  assert.ok(existsSync(join(root, '.claude/skills/block-authoring/SKILL.md')), 'block-authoring skill exists')
})

// covers: T1
test('the package docs path it names exists for a real package', () => {
  const text = read()
  assert.ok(text.includes('packages/<package>/docs/'), 'names packages/<package>/docs/')
  for (const f of ['packages/crouton-calendar/docs/llms.txt', 'packages/crouton-calendar/docs/components.md']) {
    assert.ok(existsSync(join(root, f)), `${f} must exist`)
  }
})
