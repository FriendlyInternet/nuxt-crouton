#!/usr/bin/env node
// Upsert the tagged review-capture comment on a PR (#3351). Found by its marker: PATCH if present,
// else POST. Exits 1 unless the write returned 2xx (so a caller never claims an image the PR lacks).
//   node scripts/comment-review-captures.mjs --pr 12 --key pr12 --sha <commit> --files a.png,b.png
//        [--artifact-url <u>] [--reasons <text>] [--repo o/r]
import { execFileSync } from 'node:child_process'
import { captureCommentBody, captureMarker } from './lib/review-captures.mjs'

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined }
const pr = arg('pr'), key = arg('key'), sha = arg('sha')
const repo = arg('repo') || process.env.GITHUB_REPOSITORY
const files = (arg('files') || '').split(',').map((s) => s.trim()).filter(Boolean)
if (!pr || !key || !repo || (files.length && !sha)) {
  console.error('usage: --pr N --key pr<N>|issue<N> --sha <commit> --files a.png,b.png [--artifact-url u] [--reasons t]')
  process.exit(1)
}
const body = captureCommentBody({ key, repo, sha, files, artifactUrl: arg('artifact-url'), reasons: arg('reasons') })
const gh = (args, input) => execFileSync('gh', ['api', ...args], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'inherit'] })
try {
  const existing = JSON.parse(gh(['--paginate', `repos/${repo}/issues/${pr}/comments?per_page=100`, '--jq', '[.[] | {id, body}]']).replace(/\]\s*\[/g, ','))
  const hit = existing.find((c) => String(c.body || '').startsWith(captureMarker(key)))
  const payload = JSON.stringify({ body })
  if (hit) gh(['-X', 'PATCH', `repos/${repo}/issues/comments/${hit.id}`, '--input', '-'], payload)
  else gh(['-X', 'POST', `repos/${repo}/issues/${pr}/comments`, '--input', '-'], payload)
  console.log(`review-capture comment ${hit ? 'updated' : 'posted'} on #${pr}`)
} catch (e) {
  console.error(`comment-review-captures: write failed: ${e.message}`)
  process.exit(1)
}
