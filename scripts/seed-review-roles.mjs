#!/usr/bin/env node
/**
 * Seed the member + super-admin review logins next to the admin one (#3421).
 * Best-effort: always exits 0, prints no addresses or passwords (#2358).
 * Env: REVIEW_SEED_SECRET, APP, KEY, DEPLOY_URL, SEED_DB. Derivation (keep in sync with
 * pocs/status/server/utils/review-login.ts): sha256(secret:app:key:role)[0:24].
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const EXTRA_ROLES = ['member', 'superadmin']

export function roleLogin(secret, app, key, role) {
  return {
    email: `review+${app}-${key}-${role}@example.com`,
    password: createHash('sha256').update(`${secret}:${app}:${key}:${role}`).digest('hex').slice(0, 24)
  }
}

function main(env = process.env) {
  const { REVIEW_SEED_SECRET: secret, APP: app, KEY: key, DEPLOY_URL: url, SEED_DB: db } = env
  if (!secret || !app || !key || !url || !db) return
  const summary = env.GITHUB_STEP_SUMMARY
  for (const role of EXTRA_ROLES) {
    const { email, password } = roleLogin(secret, app, key, role)
    console.log(`::add-mask::${password}`)
    console.log(`::add-mask::${email}`)
    const r = spawnSync('node', [fileURLToPath(new URL('./seed-review-login.mjs', import.meta.url)),
      '--url', url, '--email', email, '--password', password, '--role', role, '--seed-team', 'test1', '--db', db], { stdio: 'inherit' })
    const ok = r.status === 0
    if (!ok) console.log(`::warning::${role} review login seed failed for ${app}`)
    if (summary) appendFileSync(summary, `- ${role} review login: ${ok ? '✅' : '⚠️ seed failed'}\n`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
