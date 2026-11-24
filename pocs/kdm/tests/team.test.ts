// #4488 — kdm's one team is `kdm`: the review team in deploy.config.json, the
// app's croutonAuth.teams.defaultTeamSlug and both check scripts all name it,
// and the deploy's own resolver (scripts/review-team.mjs) agrees with no error.
// Reads the real committed files the deploy pipeline reads.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
// @ts-expect-error — plain .mjs script without type declarations
import { resolveReviewTeam, teamForAppDir } from '../../../scripts/review-team.mjs'

const ROOT = resolve(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const deployConfig = JSON.parse(read('deploy.config.json'))
const nuxtConfigText = read('nuxt.config.ts')

describe('kdm team is kdm (#4488)', () => {
  // covers: T2
  it('sets reviewTeam to kdm in deploy.config.json', () => {
    expect(deployConfig.reviewTeam).toBe('kdm')
  })

  // covers: T2
  it('sets croutonAuth.teams.defaultTeamSlug to kdm, not test1', () => {
    expect(nuxtConfigText).toContain("defaultTeamSlug: 'kdm'")
    expect(nuxtConfigText).not.toContain("defaultTeamSlug: 'test1'")
  })

  // covers: T2
  it('defaults TEAM to kdm in both check scripts', () => {
    for (const script of ['scripts/check-public-routes.mjs', 'scripts/check-browser-cases.mjs']) {
      expect(read(script)).toContain("const TEAM = process.env.TEAM || 'kdm'")
    }
  })

  // covers: T2
  it('resolves the review team to kdm with no mismatch error', () => {
    expect(resolveReviewTeam({ manifest: deployConfig, nuxtConfigText })).toEqual({ team: 'kdm' })
    expect(teamForAppDir(ROOT)).toEqual({ team: 'kdm' })
  })
})
