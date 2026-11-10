// Decide what a REVISE run produced (#3432). A PR-description edit is neither a commit nor a
// reply, so it used to read as "produced nothing" (and paged the owner falsely).
import { createHash } from 'node:crypto'

export function bodyKey(body) {
  if (!body) return ''
  const t = String(body).replace(/\r\n/g, '\n').trim()
  if (!t) return ''
  return createHash('sha256').update(t).digest('hex').slice(0, 12)
}

export function reviseOutcome({ headMoved, basePushed, bodyChanged, replied, verdict, round } = {}) {
  if (headMoved || basePushed) return { revised: true, noop: false, rereview: false, note: 'commit' }
  if (bodyChanged) {
    return { revised: true, noop: false, rereview: verdict === 'no-go' && Number(round) === 1, note: 'body' }
  }
  if (replied) return { revised: true, noop: false, rereview: false, note: 'reply' }
  return { revised: false, noop: true, rereview: false, note: 'noop' }
}

// CLI: `key` (body on stdin) | `decide '<json>'`
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2)
  if (cmd === 'key') {
    let s = ''
    process.stdin.on('data', (d) => (s += d)).on('end', () => process.stdout.write(bodyKey(s)))
  } else if (cmd === 'decide') {
    process.stdout.write(JSON.stringify(reviseOutcome(JSON.parse(arg || '{}'))))
  } else {
    console.error('usage: revise-outcome.mjs key|decide <json>'); process.exit(2)
  }
}
