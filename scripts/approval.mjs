#!/usr/bin/env node
// approval.mjs — CLI + re-export of scripts/lib/approval-core.mjs (the pure rules live there, shebang-free).

import { pathToFileURL } from 'node:url'
import { isApproval, approvalKind } from './lib/approval-core.mjs'

export * from './lib/approval-core.mjs'

// ── CLI ─────────────────────────────────────────────────────────────────────────
//   node scripts/approval.mjs "<comment body>"   → exit 0 if approval, 1 if not
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const ok = isApproval(process.argv.slice(2).join(' '))
  console.log(ok ? `approval (${approvalKind(process.argv.slice(2).join(' '))})` : 'not an approval')
  process.exit(ok ? 0 : 1)
}
