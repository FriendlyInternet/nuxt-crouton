#!/usr/bin/env node
/**
 * One-off (#3386): label open `status:blocked` issues that traffic control parked
 * (newest traffic marker is the wait marker) with `traffic:waiting`, so the release walk lists them.
 *   node scripts/traffic-waiting-backfill.mjs          # dry run
 *   node scripts/traffic-waiting-backfill.mjs --apply  # write
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { handoffGuard } from './handoff-exec.mjs'

const WAIT = '<!-- traffic-wait -->'
const RELEASED = '<!-- traffic-released -->'
const LABEL = 'traffic:waiting'

/** True when the newest comment carrying either traffic marker carries the wait marker. */
export function needsWaitingLabel(comments) {
  const marked = (comments || []).filter((c) => String(c.body || '').includes(WAIT) || String(c.body || '').includes(RELEASED))
  const last = marked.at(-1)
  return !!last && String(last.body).includes(WAIT)
}

const gh = (...a) => JSON.parse(execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }) || 'null')

async function main() {
  const apply = process.argv.includes('--apply')
  if (apply) {
    execFileSync('gh', ['label', 'create', LABEL, '--color', 'd93f0b', '--force',
      '--description', 'Parked by traffic control (#2786): starts by itself when the same-scope work lands'], { stdio: 'inherit' })
  }
  const issues = gh('issue', 'list', '--label', 'status:blocked', '--state', 'open', '--limit', '500', '--json', 'number,labels')
  let n = 0
  for (const it of issues) {
    if (it.labels.some((l) => l.name === LABEL)) continue
    const { comments } = gh('issue', 'view', String(it.number), '--json', 'comments')
    if (!needsWaitingLabel(comments)) continue
    n++
    console.log(`${apply ? 'labelling' : 'would label'} #${it.number}`)
    if (apply) {
      await handoffGuard({ kind: 'label', issue: it.number, label: LABEL },
        () => execFileSync('gh', ['issue', 'edit', String(it.number), '--add-label', LABEL], { stdio: 'inherit' }))
    }
  }
  console.log(`${n} to label`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
