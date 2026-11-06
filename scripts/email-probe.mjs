#!/usr/bin/env node
/**
 * #3418 — email-send probe helpers for deploy-app.yml (Node core only).
 *
 *   node scripts/email-probe.mjs detect <deploy.config.json>   → prints is_email=… / mode=…
 *   … wrangler secret list --format json | node scripts/email-probe.mjs has-key   (exit 0/1)
 *   … wrangler d1 execute … --json         | node scripts/email-probe.mjs verdict   (exit 0/1, reason on stdout)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MODES = ['password-reset', 'magic-link']

/** True when the app's layerPackages names @fyit/crouton-email exactly (not a lookalike). */
export function isEmailApp(config) {
  const lp = config?.layerPackages
  if (typeof lp !== 'string') return false
  return lp.split(/\s+/).includes('@fyit/crouton-email')
}

/** Which send path to probe. Unknown values throw — never fall back silently. */
export function probeMode(config) {
  const m = config?.emailProbe ?? 'password-reset'
  if (!MODES.includes(m)) throw new Error(`unknown emailProbe "${m}" (expected ${MODES.join(' | ')})`)
  return m
}

/** Resend test inbox, labelled per app so log rows stay separate. */
export function probeAddress(app) {
  return `delivered+${app}@resend.dev`
}

/** Does `wrangler secret list --format json` output contain a Resend key? */
export function hasEmailKey(secretListJson) {
  try {
    const list = JSON.parse(secretListJson)
    return Array.isArray(list) && list.some(s => s?.name === 'NUXT_EMAIL_RESEND_API_KEY' || s?.name === 'RESEND_API_KEY')
  }
  catch {
    return false
  }
}

/** Does a WORKER_SECRETS_JSON bundle (JSON object) carry a Resend key? Names only. */
export function bundleHasEmailKey(bundleJson) {
  try {
    const o = JSON.parse(bundleJson)
    return !!o && typeof o === 'object' && !Array.isArray(o)
      && ['NUXT_EMAIL_RESEND_API_KEY', 'RESEND_API_KEY'].some(k => typeof o[k] === 'string' && o[k] !== '')
  }
  catch {
    return false
  }
}

/** Verdict from `wrangler d1 execute --json` output for the latest auth_email_log row. */
export function verdict(d1Json) {
  let rows
  try {
    rows = JSON.parse(d1Json)?.[0]?.results
  }
  catch {
    return { ok: false, reason: 'no send recorded' }
  }
  const row = Array.isArray(rows) ? rows[0] : undefined
  if (!row) return { ok: false, reason: 'no send recorded' }
  if (row.status === 'sent' || row.status === 'delivered') return { ok: true }
  if (row.status === 'failed') return { ok: false, reason: row.error || 'failed' }
  return { ok: false, reason: 'never confirmed' }
}

function readStdin() {
  try {
    return readFileSync(0, 'utf8')
  }
  catch {
    return ''
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2)
  if (cmd === 'detect') {
    const config = JSON.parse(readFileSync(arg, 'utf8'))
    const is = isEmailApp(config)
    console.log(`is_email=${is}`)
    console.log(`mode=${is ? probeMode(config) : 'password-reset'}`)
  }
  else if (cmd === 'has-key') {
    process.exit(hasEmailKey(readStdin()) ? 0 : 1)
  }
  else if (cmd === 'bundle-has-key') {
    process.exit(bundleHasEmailKey(readStdin()) ? 0 : 1)
  }
  else if (cmd === 'verdict') {
    const v = verdict(readStdin())
    console.log(v.ok ? 'sent' : v.reason)
    process.exit(v.ok ? 0 : 1)
  }
  else {
    console.error('usage: email-probe.mjs detect <config> | has-key | verdict')
    process.exit(2)
  }
}
