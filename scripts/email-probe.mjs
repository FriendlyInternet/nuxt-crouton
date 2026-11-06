#!/usr/bin/env node
/**
 * #3418 — email-send probe helpers for deploy-app.yml (Node core only).
 *
 *   node scripts/email-probe.mjs detect <deploy.config.json>   → prints is_email=… / mode=…
 *   … wrangler secret list --format json | node scripts/email-probe.mjs has-key   (exit 0/1)
 *   … wrangler d1 execute … --json         | node scripts/email-probe.mjs verdict   (exit 0/1, reason on stdout)
 */
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
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

/** #3497 — backoff while a fresh preview Worker still answers 5xx (new auth secret not live yet). */
export const PROBE_RETRY_DELAYS_MS = [2000, 4000, 8000, 15000, 15000, 15000]

export function retryDelays(env = {}) {
  const raw = env.EMAIL_PROBE_RETRY_DELAYS_MS
  if (typeof raw !== 'string' || raw.trim() === '') return PROBE_RETRY_DELAYS_MS
  const parts = raw.split(',').map(x => x.trim())
  if (!parts.every(x => /^\d+$/.test(x))) return PROBE_RETRY_DELAYS_MS
  return parts.map(Number)
}

/** 'ok' | 'retry' | 'give-up' for one request attempt (attempt is 1-based). */
export function requestDecision({ status, threw, attempt, maxAttempts }) {
  const more = attempt < maxAttempts
  if (threw) return more ? 'retry' : 'give-up'
  if (status >= 200 && status < 300) return 'ok'
  if (status === 422) return 'ok'
  if (status >= 500) return more ? 'retry' : 'give-up'
  return 'give-up'
}

async function send(url, body) {
  const delays = retryDelays(process.env)
  const maxAttempts = delays.length + 1
  let last = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let status = 0
    let threw = false
    let text = ''
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(30000),
      })
      status = res.status
      text = (await res.text()).slice(0, 200)
    }
    catch (e) {
      threw = true
      text = String(e?.message || e).slice(0, 200)
    }
    last = threw ? 'network error' : String(status)
    const d = requestDecision({ status, threw, attempt, maxAttempts })
    if (d === 'ok') {
      console.log(`HTTP ${status}`)
      return 0
    }
    if (d === 'retry') {
      const wait = delays[attempt - 1]
      console.log(`→ HTTP ${last} (Worker not ready?) ${text} — retrying in ${wait / 1000}s (attempt ${attempt}/${maxAttempts})`)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    console.log(`HTTP ${last} ${text}`)
    return 1
  }
  return 1
}

/** Whole request phase for one mode: exit 0 when every request landed, else 1 (reason = last stdout line). */
async function requests(mode, base, email) {
  const post = (path, o) => send(`${base}/api/auth/${path}`, JSON.stringify(o))
  if (mode === 'magic-link') return post('sign-in/magic-link', { email, callbackURL: '/' })
  const pw = randomBytes(12).toString('hex')
  if (await post('sign-up/email', { email, password: pw, name: 'email-probe' }) !== 0) return 1
  return post('request-password-reset', { email, redirectTo: '/' })
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
  else if (cmd === 'send') {
    process.exit(await send(arg, process.argv[4] ?? '{}'))
  }
  else if (cmd === 'requests') {
    process.exit(await requests(arg, process.argv[4], process.argv[5]))
  }
  else {
    console.error('usage: email-probe.mjs detect <config> | has-key | bundle-has-key | verdict | send <url> <json> | requests <mode> <base> <email>')
    process.exit(2)
  }
}
