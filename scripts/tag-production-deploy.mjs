#!/usr/bin/env node
/**
 * tag-production-deploy — moves a git tag `deployed/<app>/production` to the SHA
 * that was just deployed to production (#2032). This is the missing "what did we
 * last ship" primitive #1600's aggregated changelog needs to compute "what changed
 * since the last prod deploy".
 *
 * Meant to be called as a step in .github/workflows/deploy-app.yml right after the
 * production deploy succeeds (see the issue's "Workflow patch" for the exact step —
 * this repo's pi lane can't edit .github/workflows/** directly, policy #1076).
 *
 *   node scripts/tag-production-deploy.mjs --app <app> --sha <sha>
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export class TagDeployError extends Error {}

// The app name always comes from a directory under apps/, but it ends up in a git ref
// and a CLI arg, so validate it rather than trust the caller.
const APP_NAME_RE = /^[a-z0-9][a-z0-9-]*$/i

export function tagNameFor(app) {
  if (!APP_NAME_RE.test(app || '')) {
    throw new TagDeployError(`invalid app name for a git tag: ${JSON.stringify(app)}`)
  }
  return `deployed/${app}/production`
}

export function shaIsValid(sha) {
  return /^[0-9a-f]{7,40}$/i.test(sha || '')
}

/**
 * Move (create or force-update) the tag to `sha` and push it. `git` is injected for
 * testing: { tag(name, sha, message), push(name) }.
 */
export function moveDeployTag({ app, sha, git }) {
  const tag = tagNameFor(app)
  if (!shaIsValid(sha)) throw new TagDeployError(`invalid sha: ${JSON.stringify(sha)}`)
  git.tag(tag, sha, `Deployed ${app} to production at ${sha}`)
  git.push(tag)
  return tag
}

function realGit() {
  const run = args => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  return {
    tag(name, sha, message) {
      // -f: move the tag if it already exists; annotated (-a/-m) so `git show` carries
      // the provenance message.
      run(['tag', '-f', '-a', name, sha, '-m', message])
    },
    push(name) {
      // Only this one ref is ever touched; -f because the tag moved locally above.
      run(['push', 'origin', `refs/tags/${name}`, '--force'])
    }
  }
}

function main() {
  const args = process.argv.slice(2)
  const get = flag => {
    const i = args.indexOf(flag)
    return i === -1 ? '' : args[i + 1]
  }
  const app = get('--app') || process.env.APP || ''
  const sha = get('--sha') || process.env.SHA || ''
  const tag = moveDeployTag({ app, sha, git: realGit() })
  console.log(`Moved ${tag} -> ${sha}`)
  const out = process.env.GITHUB_OUTPUT
  if (out) appendFileSync(out, `tag=${tag}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    main()
  } catch (err) {
    console.error(`::error::tag-production-deploy: ${err.message}`)
    process.exit(1)
  }
}
