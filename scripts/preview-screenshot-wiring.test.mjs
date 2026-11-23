// Wiring test (#4407): preview-screenshot.yml must ask the merge step (automerge-epic-subpr.yml) for its
// PR once the screenshot check is published not-red — the App-posted check's own check_suite is skipped
// by automerge (#3501), so without this ask a re-run-green screenshot never triggers a merge.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const WF = readFileSync(new URL('../.github/workflows/preview-screenshot.yml', import.meta.url), 'utf8')

// Slice one `- name: <name>` step block: from its line to the next step (or end of file).
function step(name) {
  const lines = WF.split('\n')
  const start = lines.findIndex((l) => l.trim() === `- name: ${name}`)
  assert.ok(start >= 0, `step "${name}" exists`)
  const indent = lines[start].indexOf('-')
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]
    if (l.trim() === '') continue
    const ind = l.length - l.trimStart().length
    if (ind <= indent) { end = i; break } // next step, or a comment at step indent
  }
  return { start, block: lines.slice(start, end).join('\n') }
}

// covers: T1
test('Publish result has id: publish and still fails the step on a red verdict', () => {
  const { block } = step('Publish result')
  assert.match(block, /^\s+id: publish$/m)
  assert.match(block, /if: \$\{\{ always\(\) && steps\.check\.outputs\.id != '' \}\}/)
  const last = block.trimEnd().split('\n').at(-1)
  assert.match(last, /\[ "\$C" != failure \] \|\| \{.*exit 1; \}/)
})

// covers: T1
test('the step after Publish result asks automerge for this PR, only on a non-red published verdict', () => {
  const pub = step('Publish result')
  const ask = step('Ask the merge step again')
  assert.ok(ask.start > pub.start, 'ask step comes after Publish result')
  const between = WF.split('\n').slice(pub.start + 1, ask.start).filter((l) => /^\s+- name: /.test(l))
  assert.deepEqual(between, [], 'no step between Publish result and the ask')
  const b = ask.block
  const ifLine = b.match(/^\s+if: (.*)$/m)?.[1]
  assert.ok(ifLine, 'ask step has an if:')
  assert.match(ifLine, /steps\.publish\.outcome == 'success'/)
  assert.doesNotMatch(ifLine, /success\(\)/, 'must not use job-wide success()')
  assert.notEqual(ifLine.replace(/\s/g, ''), '${{always()}}', 'must not be a bare always()')
  assert.match(b, /GH_TOKEN: \$\{\{ steps\.token\.outputs\.token \}\}/)
  assert.match(b, /PR: \$\{\{ steps\.target\.outputs\.pr \}\}/)
  const run = b.match(/^\s+run: (.*)$/m)?.[1]
  assert.ok(run && run !== '|' && run !== '>', 'run: is a single line')
  assert.match(run, /node scripts\/handoff-exec\.mjs dispatch/)
  assert.match(run, /workflow:"automerge-epic-subpr\.yml"/)
  assert.match(run, /inputs:\{pr:\(\$i\|tostring\)\}/)
  assert.match(run, /--argjson i "\$PR"/)
  assert.match(run, /\|\| echo "::warning::/)
})
