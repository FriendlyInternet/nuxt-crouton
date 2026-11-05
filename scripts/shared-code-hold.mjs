#!/usr/bin/env node
// shared-code-hold.mjs — does a sub-PR's changed-file list hold it for a human? (#2777)
//
// Pure decision; automerge-epic-subpr.yml only does the calls. Owner decision (#2754):
// a PR into an `epic/*` branch whose only shared-code files are under `packages/` merges
// once it carries `build:approved` (the independent build review is the human stand-in).
// `.github/workflows/**` never self-merges (#2442). PRs into any other base (main) are
// not handled by this path at all.

const PKG = 'packages/'
const WF = '.github/workflows/'

/**
 * @param {{baseRef:string, labels:string[], files:string[]}} input
 * @returns {{action:'skip'|'merge'|'hold', held:string[], hasPkgs:boolean, hasWf:boolean, reason:string}}
 */
export function decideSharedCodeHold({ baseRef, labels = [], files = [] }) {
  const held = files.filter(f => f.startsWith(PKG) || f.startsWith(WF))
  const hasPkgs = held.some(f => f.startsWith(PKG))
  const hasWf = held.some(f => f.startsWith(WF))
  const out = (action, reason) => ({ action, held, hasPkgs, hasWf, reason })
  if (!String(baseRef).startsWith('epic/')) return out('skip', 'base is not an epic branch — not handled here')
  if (hasWf) return out('hold', 'workflow changes never self-merge (#2442)')
  if (hasPkgs) {
    return labels.includes('build:approved')
      ? out('merge', 'packages-only and build:approved — released (#2777)')
      : out('hold', 'touches packages/ without build:approved')
  }
  return out('merge', 'no shared code touched')
}
