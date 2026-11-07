/**
 * Verdict for the "Preview screenshot" check (#3575).
 *
 * Rule: a preview that was meant to be screenshotted gets a screenshot or a RED check; grey
 * (neutral) only when no job in the deploy was meant to leave a record.
 * "Meant to" = the deploy's own record step ran (deploy-app.yml decides that: staging + PR +
 * a seeded login or preview token + a URL). Apps with `reviewLogin: false` skip it on purpose.
 *
 * CLI (used by preview-screenshot.yml):
 *   node scripts/lib/screenshot-verdict.mjs count <jobs.json...>   -> prints the total
 *   node scripts/lib/screenshot-verdict.mjs verdict                -> reads EXPECTED/RECORDS/RESULT/SUMMARY
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Must match the step name in .github/workflows/deploy-app.yml exactly (a test pins it).
export const RECORD_STEP_NAME = 'Record preview for the screenshot check (#2697)'

/** Count jobs whose record step actually ran (success/failure). */
export function countExpectedRecords(jobs) {
  if (!Array.isArray(jobs)) return 0
  return jobs.filter(j =>
    (j?.steps || []).some(s => s?.name === RECORD_STEP_NAME && (s.conclusion === 'success' || s.conclusion === 'failure')),
  ).length
}

export function screenshotVerdict({ expected, records, result, summary }) {
  const rec = Number(records) || 0
  if (result === 'ok') return { conclusion: 'success', summary }
  if (rec > 0) {
    return { conclusion: 'failure', summary: `preview deployed, but no screenshot captured — ${summary || 'capture step did not finish'}` }
  }
  const exp = expected === undefined || expected === null || expected === '' ? NaN : Number(expected)
  if (Number.isNaN(exp)) {
    return { conclusion: 'failure', summary: 'preview deployed, but no screenshot captured — could not read the deploy run\'s jobs' }
  }
  if (exp > 0) {
    return { conclusion: 'failure', summary: 'preview deployed, but no screenshot captured — the deploy left no preview-meta record' }
  }
  return { conclusion: 'neutral', summary: 'no preview to capture for this commit (nothing deployed, or no sign-in by design)' }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...files] = process.argv.slice(2)
  if (cmd === 'count') {
    let total = 0
    for (const f of files) total += countExpectedRecords(JSON.parse(readFileSync(f, 'utf8')))
    console.log(total)
  } else if (cmd === 'verdict') {
    const v = screenshotVerdict({
      expected: process.env.EXPECTED,
      records: process.env.RECORDS,
      result: process.env.RESULT,
      summary: process.env.SUMMARY,
    })
    console.log(`conclusion=${v.conclusion}`)
    console.log(`summary=${v.summary.replace(/\n/g, ' ')}`)
  } else {
    console.error('usage: screenshot-verdict.mjs count <jobs.json...> | verdict')
    process.exit(2)
  }
}
