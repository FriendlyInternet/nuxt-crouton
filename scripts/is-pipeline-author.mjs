/**
 * Is this PR author the pipeline bot? `gh pr view --json author` reports a GitHub App as
 * `app/<slug>`, REST `user.login` as `<slug>[bot]` — accept both (and the bare slug).
 *
 *   node scripts/is-pipeline-author.mjs <login>   # exit 0 = pipeline bot, 1 = not
 */
import { fileURLToPath } from 'node:url'

const PIPELINE_AUTHOR = /^(app\/)?(claude|nuxt-harness)(\[bot\])?$/

export function isPipelineAuthor(login) {
  return typeof login === 'string' && PIPELINE_AUTHOR.test(login)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(isPipelineAuthor(process.argv[2]) ? 0 : 1)
}
