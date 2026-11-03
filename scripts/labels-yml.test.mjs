// .github/labels.yml is applied to GitHub by labels.yml (crazy-max/ghaction-github-labeler)
// on every push to main. GitHub rejects a label description over 100 characters, and the
// labeler aborts the whole sync on the first rejection — so ONE long description silently
// froze every label change from 2026-10-19 on: `delegate-hard` and `frontend` were never
// created, and `delegate` kept a description saying it starts the Claude pipeline while it
// routes to pi (#2427). These checks catch it on the PR instead of on main.
//
// Parsed with the same line regex the other scripts use for this file
// (apply-decompose-plan.mjs knownLabelsFromFile) rather than a YAML dependency the root
// package doesn't declare.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const file = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'labels.yml')

function parseLabels(text) {
  const labels = []
  for (const line of text.split('\n')) {
    const name = line.match(/^-\s*name:\s*["']?(.+?)["']?\s*$/)
    if (name) {
      labels.push({ name: name[1] })
      continue
    }
    const desc = line.match(/^\s+description:\s*"(.*)"\s*$/) || line.match(/^\s+description:\s*'(.*)'\s*$/)
    if (desc && labels.length) labels[labels.length - 1].description = desc[1].replace(/\\"/g, '"')
  }
  return labels
}

const labels = parseLabels(readFileSync(file, 'utf8'))

test('labels.yml parses to a real list', () => {
  assert.ok(labels.length > 20, `only ${labels.length} labels parsed — the regex no longer matches the file`)
})

test('every label description fits GitHub\'s 100-character limit', () => {
  const tooLong = labels
    .filter(l => [...(l.description || '')].length > 100)
    .map(l => `${l.name} (${[...l.description].length} chars)`)
  assert.deepEqual(tooLong, [], `GitHub rejects these and the label sync stops: ${tooLong.join(', ')}`)
})

test('label names are unique', () => {
  const seen = new Set()
  const dupes = labels.map(l => l.name.toLowerCase()).filter(n => seen.has(n) || !seen.add(n))
  assert.deepEqual(dupes, [])
})
