// diagram-edit-link.test.mjs — the ✏️ Edit link for a design-hold diagram (#3690).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diagramEditUrl, DIAGRAM_EDITOR_ORIGIN, DIAGRAM_BRANCH } from './diagram-edit-link.mjs'

test('builds the editor URL with slug, branch and issue', () => {
  assert.equal(diagramEditUrl({ slug: 'my-epic', branch: 'diagrams', issue: 3690 }),
    'https://diagram.pmcp.dev/?slug=my-epic&branch=diagrams&issue=3690')
})

test('refuses main / master / empty branch — never a main link', () => {
  for (const branch of ['main', ' main ', 'master', '', undefined]) {
    assert.equal(diagramEditUrl({ slug: 's', branch, issue: 1 }), null, `branch=${JSON.stringify(branch)}`)
  }
})

test('a slug the editor would reject, or a bad issue number → no link', () => {
  assert.equal(diagramEditUrl({ slug: '../x', branch: 'diagrams', issue: 1 }), null)
  assert.equal(diagramEditUrl({ slug: '', branch: 'diagrams', issue: 1 }), null)
  assert.equal(diagramEditUrl({ slug: 's', branch: 'diagrams', issue: 0 }), null)
  assert.equal(diagramEditUrl({ slug: 's', branch: 'diagrams', issue: 'abc' }), null)
})

test('origin and save branch are pinned; the branch is outside every ruleset pattern', () => {
  assert.equal(DIAGRAM_EDITOR_ORIGIN, 'https://diagram.pmcp.dev')
  assert.equal(DIAGRAM_BRANCH, 'diagrams')
  assert.ok(!['main', 'master'].includes(DIAGRAM_BRANCH))
  assert.ok(!DIAGRAM_BRANCH.startsWith('epic/') && !DIAGRAM_BRANCH.startsWith('trial/'))
})
