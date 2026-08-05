#!/usr/bin/env node
// provider-key-canary.mjs (#1327) — a provider-agnostic "is our agent key funded?" canary.
//
// WHY THIS EXISTS: the pi.dev harness runs on a metered provider key (PI_PROVIDER_KEY).
// It drained silently once (funded 2026-07-07, dry by 2026-07-10) and EVERY delegate run
// just failed at the agent step until a human noticed. Two facts from the #1327
// ecosystem-check shaped this:
//   1. Anthropic exposes NO balance / credits-remaining endpoint — you can read spend
//      (Admin cost_report), never remaining. So "poll the balance" is impossible.
//   2. We deliberately do NOT use Console auto-reload (top-ups stay manual — cost control).
// So the only proactive signal that a key is dead is to ACTUALLY CALL IT. This canary fires
// one tiny (max_tokens:1) request per configured provider and classifies the result.
//
// MULTI-PROVIDER BY DESIGN (#669): the harness is going multi-provider (OpenAI in the mix,
// etc.). Adding a provider is ONE entry in PROVIDERS below — the canary then reports which
// specific key is dry, so you top up the right one (and the harness can fail over to a
// funded provider instead of going dark).
//
// CONTRACT: prints a JSON summary to stdout, and — when run in CI — appends
// `any_alert` / `summary` to $GITHUB_OUTPUT for the workflow to branch on. Exits 0 even
// when a key is dry (detection succeeded → the run is green; the DRY key is surfaced via
// the standing issue + email, mirroring the digests' degrade-to-green philosophy). A
// non-zero exit means the canary itself broke.

import { appendFileSync } from 'node:fs'

// Add a provider here to cover it. `keyEnv` is the env var the workflow maps its secret to.
export const PROVIDERS = [
  {
    id: 'anthropic',
    keyEnv: 'ANTHROPIC_KEY', // ← secrets.PI_PROVIDER_KEY in CI
    probe: (key) =>
      fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      }),
  },
  {
    id: 'openai',
    keyEnv: 'OPENAI_KEY', // ← secrets.OPENAI_KEY (add when OpenAI joins the mix)
    probe: (key) =>
      fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_completion_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      }),
  },
]

// Pull a human-readable message out of a provider error body (best-effort).
function firstMsg(body) {
  try {
    const j = JSON.parse(body)
    return (j.error && (j.error.message || j.error.type)) || j.message || ''
  } catch {
    return (body || '').slice(0, 160)
  }
}

// Map an HTTP status + body to a state. ORDER MATTERS: the billing check runs before the
// 429 check because OpenAI's out-of-credit error is ALSO a 429 (insufficient_quota) — we
// must not misread a dry key as a transient rate-limit.
export function classify(status, body) {
  if (status === 200) return { state: 'ok' }
  const b = (body || '').toLowerCase()
  if (/credit balance is too low|insufficient_quota|billing|not enough|payment|purchase credits/.test(b))
    return { state: 'dry', status, detail: firstMsg(body) }
  if (status === 401 || status === 403 || /invalid.*api.?key|unauthorized|authentication_error/.test(b))
    return { state: 'auth', status, detail: firstMsg(body) }
  if (status === 429) return { state: 'ratelimited', status, detail: firstMsg(body) } // transient — NOT an alert
  return { state: 'error', status, detail: firstMsg(body) }
}

// States that warrant waking a human: the key is dead (dry) or misconfigured (auth).
export const ALERT_STATES = new Set(['dry', 'auth'])

async function checkProvider(p) {
  const key = process.env[p.keyEnv]
  if (!key) return { id: p.id, state: 'unconfigured' }
  try {
    const res = await p.probe(key)
    return { id: p.id, ...classify(res.status, await res.text()) }
  } catch (e) {
    // A network/DNS error is canary-infra noise, not a key problem — surface as 'error'.
    return { id: p.id, state: 'error', detail: e.message }
  }
}

export async function runCanary(providers = PROVIDERS) {
  const results = []
  for (const p of providers) results.push(await checkProvider(p))
  const alerting = results.filter((r) => ALERT_STATES.has(r.state))
  return { ok: alerting.length === 0, alerting: alerting.map((r) => r.id), results }
}

// Run only when invoked directly (not when imported by the test).
const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const summary = await runCanary()
  console.log(JSON.stringify(summary, null, 2))
  const out = process.env.GITHUB_OUTPUT
  if (out) {
    const line = summary.ok
      ? 'all provider keys OK'
      : `⚠️ provider key(s) need attention: ${summary.results
          .filter((r) => ALERT_STATES.has(r.state))
          .map((r) => `${r.id} (${r.state})`)
          .join(', ')}`
    appendFileSync(out, `any_alert=${summary.ok ? 'false' : 'true'}\n`)
    appendFileSync(out, `summary=${line}\n`)
  }
  // Exit 0 even on a dry key: detection worked. Only a thrown canary-infra fault is a red run.
  process.exit(0)
}
