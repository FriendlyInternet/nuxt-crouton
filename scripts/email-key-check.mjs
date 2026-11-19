#!/usr/bin/env node
/**
 * #3441 — the production email-key check, as tested code instead of workflow bash (#3437).
 * Presence only: messages name keys, never values.
 *
 *   … wrangler secret list --format json | SECRETS_JSON=… APP=… \
 *     node scripts/email-key-check.mjs <before|after> <deploy.config.json>
 *
 * Exit 0 on pass/skip (prints "✓ <message>"), 1 on stop (prints "::error::<message>"),
 * 2 on a bad phase or missing argument.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isEmailApp, bundleHasEmailKey, hasEmailKey } from './email-probe.mjs'

/** Decide the production email-key check. Returns { result: 'skip' | 'pass' | 'stop', message }. */
export function emailKeyDecision({ phase, isEmail, bundleJson, workerListJson, app }) {
  if (phase !== 'before' && phase !== 'after') throw new Error(`unknown phase "${phase}" (expected before | after)`)
  if (!isEmail) return { result: 'skip', message: 'not an email app' }
  if (phase === 'before') {
    if (bundleHasEmailKey(bundleJson ?? '')) return { result: 'pass', message: 'email key is in WORKER_SECRETS_JSON (will be synced)' }
    if (hasEmailKey(workerListJson ?? '')) return { result: 'pass', message: 'email key already on the production Worker' }
    return {
      result: 'stop',
      message: `email key missing for PRODUCTION — ${app} uses @fyit/crouton-email but NUXT_EMAIL_RESEND_API_KEY is neither in WORKER_SECRETS_JSON nor on its production Worker. Add the key to WORKER_SECRETS_JSON. Deploy stopped.`,
    }
  }
  if (hasEmailKey(workerListJson ?? '')) return { result: 'pass', message: 'email key present on the production Worker' }
  return {
    result: 'stop',
    message: `email key missing on PRODUCTION after secrets sync — ${app} has no NUXT_EMAIL_RESEND_API_KEY. Add it to WORKER_SECRETS_JSON.`,
  }
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
  const [phase, configPath] = process.argv.slice(2)
  if ((phase !== 'before' && phase !== 'after') || !configPath) {
    console.error('usage: email-key-check.mjs <before|after> <deploy.config.json>  (Worker list on stdin, SECRETS_JSON + APP in env)')
    process.exit(2)
  }
  const config = JSON.parse(readFileSync(configPath, 'utf8'))
  const d = emailKeyDecision({
    phase,
    isEmail: isEmailApp(config),
    bundleJson: process.env.SECRETS_JSON ?? '',
    workerListJson: readStdin(),
    app: process.env.APP ?? '',
  })
  if (d.result === 'stop') {
    console.log(`::error::${d.message}`)
    process.exit(1)
  }
  console.log(`✓ ${d.message}`)
}
