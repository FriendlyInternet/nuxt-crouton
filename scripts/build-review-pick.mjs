/**
 * Is this PR one the build reviewer should look at? (#2985)
 *
 * `gh pr view --json author` reports a GitHub App as `app/<slug>` (REST says `<slug>[bot]`),
 * so an author test written for one spelling silently skipped every pipeline PR. The whole
 * decision lives here so it can't drift from the workflow again.
 *
 *   gh pr view N --json headRefName,baseRefName,isDraft,author,state | node scripts/build-review-pick.mjs
 *   exit 0 = review it, exit 1 = skip
 */
const AUTHOR = /^(app\/)?(claude|nuxt-harness)(\[bot\])?$/

export function isPipelinePr(pr) {
  return (
    /^work-\d+$/.test(pr?.headRefName ?? '') &&
    /^epic\//.test(pr?.baseRefName ?? '') &&
    pr?.state === 'OPEN' &&
    pr?.isDraft !== true &&
    AUTHOR.test(pr?.author?.login ?? '')
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) raw += chunk
  process.exit(isPipelinePr(JSON.parse(raw)) ? 0 : 1)
}
