/**
 * Score the Qodo experiment (#3370): for each pipeline PR Qodo was asked to review, list
 * Qodo's findings next to our build-review verdict, as a table the owner marks real / not real.
 *
 *   node scripts/qodo-score.mjs [--since 2026-11-05] [--limit 1000] [--out writeups/reports/qodo-score-YYYYMMDD.md]
 *
 * Needs `gh` auth. Report-only: reads PRs and comments, writes one markdown file.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const QODO = /qodo/i

export function isQodo(login) {
  return QODO.test(login ?? '')
}

export function verdictOf(comments) {
  // newest build-review verdict wins
  let v = 'none'
  for (const c of comments) {
    const m = /<!-- build-review-verdict:([a-z-]+) -->/.exec(c.body ?? '')
    if (m) v = m[1]
  }
  return v
}

export function qodoFindings(comments) {
  return comments.filter((c) => isQodo(c.user?.login) && (c.body ?? '').trim())
}

export function asked(comments) {
  return comments.some((c) => /<!-- qodo-asked-sha:[0-9a-f]+ -->/.test(c.body ?? ''))
}

/** True when this exact head SHA already carries our `/review` marker (once per commit). */
export function askedAt(comments, sha) {
  return comments.some((c) => (c.body ?? '').includes(`<!-- qodo-asked-sha:${sha} -->`))
}

/** Asked PRs where Qodo never answered — means it may ignore app-authored `/review` comments. */
export function unanswered(rowsData) {
  return rowsData.filter((r) => r.findings === 0).map((r) => r.pr)
}

export function row(pr, comments) {
  const f = qodoFindings(comments)
  const first = f[0]?.html_url ?? ''
  return `| #${pr} | ${verdictOf(comments)} | ${f.length} | ${first} | | |`
}

/** Search string for pipeline PRs inside the experiment window. */
export function searchQuery(since) {
  return `head:work- created:>=${since}`
}

/** True when the result filled the cap, so older PRs may be missing. */
export function truncated(count, limit) {
  return count >= Number(limit)
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

function main() {
  const argv0 = process.argv.slice(2)
  if (argv0[0] === '--asked-at') {
    // usage: --asked-at <comments.json> <sha> ; exit 0 when already asked
    const raw = readFileSync(argv0[1], 'utf8').replace(/\]\s*\[/g, ',')
    process.exit(askedAt(JSON.parse(raw || '[]'), argv0[2]) ? 0 : 1)
  }
  const argv = process.argv.slice(2)
  const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d)
  const limit = opt('--limit', '1000')
  const since = opt('--since', '2026-11-05')
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '')
  const out = opt('--out', `writeups/reports/qodo-score-${stamp}.md`)
  const prs = JSON.parse(gh(['pr', 'list', '--state', 'all', '--search', searchQuery(since), '--limit', limit, '--json', 'number,headRefName']))
  if (truncated(prs.length, limit)) {
    console.error(`qodo-score: hit the --limit ${limit} cap — results are truncated; narrow --since or raise --limit`)
    process.exit(1)
  }
  const rows = []
  const data = []
  let considered = 0
  for (const p of prs) {
    if (!/^work-\d+$/.test(p.headRefName)) continue
    considered++
    const comments = JSON.parse(gh(['api', '--paginate', `repos/{owner}/{repo}/issues/${p.number}/comments?per_page=100`]).replace(/\]\s*\[/g, ','))
    if (!asked(comments)) continue
    rows.push(row(p.number, comments))
    data.push({ pr: p.number, findings: qodoFindings(comments).length })
  }
  const md = [
    '# Qodo vs our build review (#3370)',
    '',
    `Generated ${new Date().toISOString()}. Pipeline PRs since ${since}: ${considered}. PRs Qodo was asked to review: ${rows.length}.`,
    'Mark each finding real / not real by hand; "our review caught it" = the build review raised the same point.',
    '',
    ...(unanswered(data).length
      ? [`> Note: Qodo has not answered on ${unanswered(data).map((n) => '#' + n).join(', ')}. If this is every PR, Qodo likely ignores \`/review\` posted by the app account — post it from the owner account instead.`, '']
      : []),
    '| PR | Build-review verdict | Qodo comments | First Qodo comment | Real? | Our review caught it? |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, md)
  console.log(`considered ${considered} pipeline PRs since ${since}; Qodo asked on ${rows.length}; wrote ${out}`)
}

if (import.meta.url === `file://${process.argv[1]}`) main()
