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

// covers: T5 (#4535)
test('capture reads both deploy runs, waits, reuses one check run and shoots the selected list', () => {
  const jobIf = WF.match(/^    if: (.*)$/m)?.[1]
  assert.ok(jobIf, 'job has an if:')
  assert.doesNotMatch(jobIf, /workflow_run\.conclusion == 'success'/, 'a failed deploy still starts a capture')
  assert.match(jobIf, /workflow_run\.event == 'pull_request'/)

  const target = step('Resolve target').block
  assert.match(target, /node scripts\/lib\/screenshot-targets\.mjs runs /)
  assert.match(target, /for wf in deploy-apps\.yml deploy-pocs\.yml/)
  assert.doesNotMatch(target, /status=success/, 'no status filter: a running deploy must be visible')
  assert.doesNotMatch(WF, /RUN_ID: \$\{\{ github\.event\.workflow_run\.id \}\}/)

  const lookup = WF.indexOf('check-runs?check_name=Preview%20screenshot')
  const post = WF.indexOf('gh api -X POST "repos/${GITHUB_REPOSITORY}/check-runs"')
  assert.ok(lookup >= 0 && post >= 0 && lookup < post, 'existing check is looked up before any POST')
  const open = step('Open check run').block
  assert.ok(open.indexOf('-X PATCH') >= 0 && open.indexOf('-X PATCH') < open.indexOf('-X POST'), 'PATCH the existing check first')

  const select = step('Select apps').block
  assert.match(select, /screenshot-targets\.mjs select .*--out "\$RUNNER_TEMP\/selected\.txt"/)
  assert.match(select, /if: .*steps\.target\.outputs\.wait != 'true'/)
  const capture = step('Capture + post review-surface evidence').block
  assert.match(capture, /done < "\$RUNNER_TEMP\/selected\.txt"/)
  assert.doesNotMatch(capture, /find "\$RUNNER_TEMP\/records" -name meta\.json/)
  assert.match(capture, /if: \$\{\{ steps\.select\.outputs\.count != '0'/)
  assert.match(step('Download preview records').block, /if: .*steps\.target\.outputs\.wait != 'true'/)

  const pub = step('Publish result').block
  assert.match(pub, /MISSING: \$\{\{ steps\.select\.outputs\.missing \}\}/)
  assert.match(pub, /if \[ "\$WAIT" = true \]; then[\s\S]*status=in_progress[\s\S]*exit 0/)
  assert.match(step('Ask the merge step again').block, /if: .*steps\.target\.outputs\.wait != 'true'/)
})

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
  // A plain YAML scalar ends at ` #` (comment) — that truncated this line and broke shellcheck,
  // so run: must be a block scalar carrying the one command on the next line.
  const runLines = b.split('\n')
  const runAt = runLines.findIndex((l) => /^\s+run:/.test(l))
  assert.ok(runAt >= 0, 'ask step has a run:')
  assert.match(runLines[runAt], /^\s+run: \|$/, 'run: is a block scalar (run: |)')
  const run = runLines.slice(runAt + 1).map((l) => l.trim()).filter(Boolean).join('\n')
  assert.equal(run.split('\n').length, 1, 'block holds a single command')
  assert.match(run, /node scripts\/handoff-exec\.mjs dispatch/)
  assert.match(run, /workflow:"automerge-epic-subpr\.yml"/)
  assert.match(run, /inputs:\{pr:\(\$i\|tostring\)\}/)
  assert.match(run, /--argjson i "\$PR"/)
  assert.match(run, /\|\| echo "::warning::/)
})
