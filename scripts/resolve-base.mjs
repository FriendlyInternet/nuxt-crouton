#!/usr/bin/env node
// Resolve the branch a PR is based on (#3072). The PR's own base wins; the ticket's epic_branch
// is only the fallback when no PR exists yet. Never inferred from `inputs.branch`, which names
// the PR head — a leaf PR into an epic used to lose its epic base and merge main instead.
import { fileURLToPath } from 'node:url'

export function resolveBase({ prBase = '', headRef = '', issueEpic = '' } = {}) {
  const leaf = /^work-\d+/.test(headRef)
  if (leaf && prBase && prBase !== 'main' && issueEpic && prBase !== issueEpic) {
    return { base: prBase, error: `PR targets ${prBase} but the ticket says ${issueEpic}` }
  }
  return { base: prBase || issueEpic || 'main', error: '' }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { PR_BASE, HEAD_REF, ISSUE_EPIC } = process.env
  const r = resolveBase({ prBase: PR_BASE, headRef: HEAD_REF, issueEpic: ISSUE_EPIC })
  console.log(`base=${r.base}`)
  if (r.error) console.log(`error=${r.error}`)
}
