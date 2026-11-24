#!/usr/bin/env node
// review-team.mjs — the ONE rule for which seeded team a preview's review login lands in (#4141).
//
// An app may set `"reviewTeam": "<slug>"` in its deploy.config.json; absent → `test1` (every app
// but `pocs/kdm`). The deploy's demo seed (`crouton-seed --team`), the review login (`--seed-team`), the
// screenshot's `{team}` / `[team]` routes and local `pnpm preview` all read it from here, so they
// can never disagree.
//
// Cross-check: a `croutonAuth.teams.defaultTeamSlug` app makes every sign-up join the org with that
// slug, so a review team that differs from it would put the reviewer in two teams. When the key is
// set and nuxt.config.ts names a literal different slug, that is an ERROR naming both. With no key
// and a different slug it is only a warning — apps that say nothing keep working as today.
// nuxt.config is only cross-checked, never the source: a computed value simply skips the check.
//
// Usage:  node scripts/review-team.mjs <appDir>   → prints the team on stdout
//         a warning goes to stderr as `::warning::…`; an error prints `::error::…` and exits 1.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const DEFAULT_REVIEW_TEAM = 'test1'
const SLUG = /^[a-z0-9][a-z0-9-]*$/
const DEFAULT_TEAM_SLUG = /defaultTeamSlug:\s*['"]([^'"]+)['"]/

/** The literal `defaultTeamSlug` in a nuxt.config text, or null (absent or computed). */
export function readDefaultTeamSlug(nuxtConfigText) {
  return DEFAULT_TEAM_SLUG.exec(String(nuxtConfigText || ''))?.[1] ?? null
}

/** `{ team, warning?, error? }` for a parsed deploy.config.json + its app's nuxt.config text. */
export function resolveReviewTeam({ manifest, nuxtConfigText } = {}) {
  const key = manifest?.reviewTeam
  const team = key ?? DEFAULT_REVIEW_TEAM
  if (typeof team !== 'string' || !SLUG.test(team)) {
    return { team: DEFAULT_REVIEW_TEAM, error: `reviewTeam "${team}" is not a valid team slug` }
  }
  const slug = readDefaultTeamSlug(nuxtConfigText)
  if (slug && slug !== team) {
    if (key !== undefined) {
      return {
        team,
        error: `deploy.config.json reviewTeam "${key}" ≠ croutonAuth.teams.defaultTeamSlug "${slug}" in nuxt.config.ts — set them to the same team`
      }
    }
    return {
      team,
      warning: `croutonAuth.teams.defaultTeamSlug is "${slug}" but the review team is "${team}" — set "reviewTeam": "${slug}" in deploy.config.json so the review login lands in one team`
    }
  }
  return { team }
}

/** Resolve the review team for an app directory. A missing or unreadable file counts as empty. */
export function teamForAppDir(dir, read = p => readFileSync(p, 'utf8')) {
  const tryRead = (p) => { try { return read(p) } catch { return '' } }
  let manifest = {}
  const raw = tryRead(`${dir}/deploy.config.json`)
  if (raw) {
    try { manifest = JSON.parse(raw) } catch { manifest = {} }
  }
  return resolveReviewTeam({ manifest, nuxtConfigText: tryRead(`${dir}/nuxt.config.ts`) })
}

function main(argv) {
  const dir = argv[0]
  if (!dir) {
    console.error('Usage: node scripts/review-team.mjs <appDir>')
    return 2
  }
  const { team, warning, error } = teamForAppDir(dir)
  if (error) {
    console.error(`::error::${error}`)
    return 1
  }
  if (warning) console.error(`::warning::${warning}`)
  process.stdout.write(`${team}\n`)
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(main(process.argv.slice(2)))
