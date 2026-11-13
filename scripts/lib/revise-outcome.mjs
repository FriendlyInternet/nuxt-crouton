// Decide what a REVISE run produced (#3432). A PR-description edit is neither a commit nor a
// reply, so it used to read as "produced nothing" (and paged the owner falsely).
import { createHash } from 'node:crypto'

export function bodyKey(body) {
  if (!body) return ''
  const t = String(body).replace(/\r\n/g, '\n').trim()
  if (!t) return ''
  return createHash('sha256').update(t).digest('hex').slice(0, 12)
}

const HDR = '<!-- pipeline-note -->\n> 🤖 **pi.dev harness** · agent pipeline (CI) · _revision (#3775)_\n\n'
const link = (text, from) => (from ? `[${text}](${from})` : text)

/**
 * The owner-request pass's exit code (#3775 — `steps.pi-request.outputs.rc`). Returns the code
 * when the worker FAILED, else null. Empty / missing = the pass did not run (no conflict merge),
 * so a revise run without a conflict is judged exactly as before.
 */
export function requestFailed(rc) {
  const t = String(rc ?? '').trim()
  if (t === '') return null
  return t === '0' ? null : t
}

/**
 * `headMoved` = a commit AFTER the base merge reached the PR. `baseOnly` = the only thing pushed
 * was the base merge (#3775) — that is not the requested change, so on its own it is a no-op.
 * Facts only: pi's wording is never read. `message` is the PR comment to post ('' = none).
 */
export function reviseOutcome({ headMoved, baseOnly, bodyChanged, replied, verdict, round, base = 'the base', from = '', requestRc = '' } = {}) {
  // A crashed worker is a failure, not a revision and not a vague comment (#3775): never count
  // it as revised, never ask the owner to rephrase — name the exit code.
  const rc = requestFailed(requestRc)
  if (rc !== null) {
    return {
      revised: false, noop: false, rereview: false, note: 'worker-failed', output: `request_failed=${rc}`,
      error: `the worker failed (exit ${rc}) while making the requested change (#3775)`,
      message: `${HDR}❌ **The worker failed (exit ${rc})** while making ${link('your change', from)} — this run does not count as the revision. Anything it pushed may be incomplete; this is a worker failure, not a problem with your comment.`,
    }
  }
  if (headMoved) return { revised: true, noop: false, rereview: false, note: 'commit', message: '' }
  if (bodyChanged) {
    return { revised: true, noop: false, rereview: verdict === 'no-go' && Number(round) === 1, note: 'body', message: '' }
  }
  // A reply with no commit beyond the base merge is narration, not proof (#3775 test 2, #1849):
  // the #3756 worker replied "fixed" and pushed nothing. Only without a base merge is a reply an answer.
  if (replied && !baseOnly) return { revised: true, noop: false, rereview: false, note: 'reply', message: '' }
  const message = baseOnly
    ? `${HDR}Brought up to date with \`${base}\`; ⚠️ **${link('your change', from)} was not made** — that merge is the only commit pushed${replied ? '. The worker described a change, but no commit with it was pushed.' : ', and the worker posted no answer.'} Rephrase it as a concrete change (which file, what to do) and comment again.`
    : `${HDR}⚠️ **${link('Your comment', from)} produced no change and no answer.** Nothing was pushed. Rephrase it as a concrete change (which file, what to do) and comment again.`
  return { revised: false, noop: true, rereview: false, note: 'noop', output: 'revise_noop=1', error: 'revise produced no commit after the base merge and no reply (#2446/#3775)', message }
}

// CLI: `key` (body on stdin) | `decide '<json>'` | `ok <rc>` (exit 0 unless the worker failed)
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2)
  if (cmd === 'key') {
    let s = ''
    process.stdin.on('data', (d) => (s += d)).on('end', () => process.stdout.write(bodyKey(s)))
  } else if (cmd === 'decide') {
    process.stdout.write(JSON.stringify(reviseOutcome(JSON.parse(arg || '{}'))))
  } else if (cmd === 'ok') {
    process.exit(requestFailed(arg) === null ? 0 : 1)
  } else {
    console.error('usage: revise-outcome.mjs key|decide <json>|ok <rc>'); process.exit(2)
  }
}
