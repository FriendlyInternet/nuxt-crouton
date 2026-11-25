#!/usr/bin/env node
// Runs `fallow audit` judged against the PR's OWN base branch (#3519).
// Without --base fallow diffs against origin/main, so a PR into an epic/* branch
// is charged with the epic's other changes. Push runs keep fallow's default.
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function fallowBaseArgs({ event, baseRef }) {
  const ref = String(baseRef ?? '').trim()
  if (String(event ?? '').startsWith('pull_request') && ref) return ['--base', `origin/${ref}`]
  return []
}

export function auditCommand({ event, baseRef, passthrough = [] }) {
  return ['fallow', 'audit', ...fallowBaseArgs({ event, baseRef }), ...passthrough]
}

export function assertRefExists(ref, cwd = process.cwd()) {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd, stdio: 'ignore' })
  } catch {
    throw new Error(`fallow-audit: base ref ${ref} not found — is fetch-depth: 0 set?`)
  }
}

function main() {
  const event = process.env.EVENT ?? ''
  const baseRef = process.env.BASE_REF ?? ''
  const base = fallowBaseArgs({ event, baseRef })
  if (base.length) {
    assertRefExists(base[1])
    console.log(`fallow-audit: judging against ${base[1]} (PR base)`)
  } else {
    console.log("fallow-audit: judging against fallow's default (merge-base with origin/main)")
  }
  const [, ...args] = auditCommand({ event, baseRef, passthrough: process.argv.slice(2) })
  const r = spawnSync('npx', ['fallow', ...args], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main() } catch (e) { console.error(e.message); process.exit(1) }
}
