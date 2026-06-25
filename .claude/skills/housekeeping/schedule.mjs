#!/usr/bin/env node
/**
 * Cadence-as-data reader for the recurring digests (#637).
 *
 *   node schedule.mjs <report-name>
 *
 * Reads .github/digests.yml, decides whether TODAY is a send day for the named report, and
 * emits the delivery selection. The workflow cron fires daily (cheap wake-up) and this gate
 * exits the run early on non-send days — so changing cadence is a one-line YAML edit, never
 * a `cron` change. Writes GitHub Actions step outputs (send / deliver / recipients) to
 * $GITHUB_OUTPUT when set, and always prints a human-readable line.
 *
 * Env:
 *   FORCE=1               treat as a send regardless of cadence (manual workflow_dispatch)
 *   DIGESTS_FILE          default ".github/digests.yml"
 *   SCHEDULE_TODAY_DOW    override today's weekday (mon..sun) for testing
 *   SCHEDULE_TODAY_DOM    override today's day-of-month (1..31) for testing
 *   SCHEDULE_TODAY        override today's date (YYYY-MM-DD) for testing — drives both
 *                         the weekday and the month-length used to clamp `monthly:<dom>`
 */

import { readFileSync, existsSync, appendFileSync } from 'node:fs'

const report = process.argv[2]
if (!report) {
  console.error('schedule.mjs: pass the report name, e.g. `node schedule.mjs housekeeping`')
  process.exit(1)
}
const file = process.env.DIGESTS_FILE || '.github/digests.yml'

// Minimal parser for this 2-level shape (report → schedule/deliver/to). No YAML dep.
function parse(text) {
  const out = {}
  let cur = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').replace(/\s+$/, '')
    if (!line.trim()) continue
    const top = line.match(/^(\S[^:]*):\s*$/)
    if (top) {
      cur = top[1].trim()
      out[cur] = {}
      continue
    }
    const field = line.match(/^\s+([\w-]+):\s*(.+)$/)
    if (field && cur) {
      const [, k, vRaw] = field
      const v = vRaw.trim()
      const list = v.match(/^\[(.*)\]$/)
      out[cur][k] = list
        ? list[1].split(',').map((s) => s.trim()).filter(Boolean)
        : v
    }
  }
  return out
}

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
// Today's date: a SCHEDULE_TODAY override (YYYY-MM-DD) drives weekday, day-of-month, AND the
// month length used to clamp `monthly:<dom>`; otherwise use the real UTC date. Per-field
// overrides (SCHEDULE_TODAY_DOW / _DOM) still win for targeted tests.
const now = process.env.SCHEDULE_TODAY ? new Date(`${process.env.SCHEDULE_TODAY}T00:00:00Z`) : new Date()
const todayDow = process.env.SCHEDULE_TODAY_DOW || DOW[now.getUTCDay()]
const todayDom = Number(process.env.SCHEDULE_TODAY_DOM || now.getUTCDate())
// Last day of the current UTC month (28..31) — day 0 of next month rolls back to it.
const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()

let cfg = {}
if (existsSync(file)) {
  try {
    cfg = parse(readFileSync(file, 'utf8'))[report] || {}
  } catch (e) {
    console.error(`schedule.mjs: failed to parse ${file}: ${e.message}`)
  }
} else {
  console.error(`schedule.mjs: ${file} not found — defaulting to send.`)
}

const schedule = cfg.schedule || 'weekly:wed'
const deliver = Array.isArray(cfg.deliver) ? cfg.deliver : ['issue']
const to = Array.isArray(cfg.to) ? cfg.to : []
const forced = process.env.FORCE === '1'

let send = forced
let reason
if (forced) {
  reason = 'forced (manual dispatch)'
} else if (schedule === 'daily') {
  send = true
  reason = 'daily'
} else {
  const weekly = schedule.match(/^weekly:(\w+)$/)
  const monthly = schedule.match(/^monthly:(\d{1,2})$/)
  if (weekly) {
    send = weekly[1].toLowerCase() === todayDow
    reason = `weekly:${weekly[1]} vs today=${todayDow}`
  } else if (monthly) {
    // Clamp the configured day-of-month to the last valid day, so `monthly:31` still fires
    // in a 30-day month (and `monthly:30` in February) rather than silently never sending.
    const wanted = Math.min(Math.max(Number(monthly[1]), 1), daysInMonth)
    send = wanted === todayDom
    reason = `monthly:${monthly[1]}→${wanted} (month has ${daysInMonth}d) vs today=${todayDom}`
  } else {
    // Unknown cadence — fail safe by sending (a misconfig shouldn't silence the report).
    send = true
    reason = `unrecognised schedule "${schedule}" — defaulting to send`
  }
}

console.log(
  `[schedule] ${report}: send=${send} (${reason}) · deliver=[${deliver.join(', ')}]` +
    (to.length ? ` · to=[${to.join(', ')}]` : '')
)

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `send=${send}\ndeliver=${deliver.join(',')}\nrecipients=${to.join(',')}\n`
  )
}
