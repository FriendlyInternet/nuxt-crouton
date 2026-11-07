#!/usr/bin/env node
// Visual sign-off hold decision (#3531). A visual diff is held for the owner ONLY when the work
// names one page + one expected sight on an app this PR actually previews. Otherwise it is
// reviewed as a normal PR. Pure helpers are exported; the workflow only calls the CLI.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { computeMatrix, loadApps } from './deploy-detect.mjs'

const LINE = /^[ \t>*-]*👁\s*\*{0,2}What to look at:?\*{0,2}:?\s*(.+)$/mu
const STATUS = 'https://status.pmcp.dev/api/status/login'
const MARKER = '<!-- deploy-preview: full-watch -->'

// Same rule as pocs/status/server/utils/totest-core.ts isSafePath.
function isSafePath(to) {
  return typeof to === 'string' && to.length <= 500 && /^\/(?!\/)/.test(to) && !/[\\\u0000-\u001f\u007f]/.test(to)
}

export function parseLookAt(text) {
  const m = LINE.exec(String(text ?? ''))
  if (!m) return null
  const rest = m[1].trim()
  const none = /^none\b\s*(?:[—–-]+\s*(.*))?$/iu.exec(rest)
  if (none) return { none: true, why: (none[1] || '').trim() }
  const parts = /^(\S+)\s+(\S+)(?:\s*[—–]+\s*(?:you should see\s*)?(.*))?$/iu.exec(rest)
  if (!parts) return null
  const app = parts[1]
  let path = parts[2]
  if (!/^[a-z0-9-]+$/.test(app)) return null
  if (!path.startsWith('/') && !/[\\\u0000-\u001f\u007f]/.test(path)) path = `/${path}`
  if (!isSafePath(path)) return null
  return { app, path, sight: (parts[3] || '').trim() }
}

export function previewApps(changedFiles) {
  const out = new Set()
  for (const ws of ['apps', 'pocs']) {
    const { include } = computeMatrix({ event: 'pull_request', changedFiles, apps: loadApps(ws), workspace: ws })
    for (const i of include) out.add(i.app)
  }
  return [...out]
}

export function fillPr(body, pr) {
  return String(body ?? '').split('pr{{PR}}').join(`pr${pr}`)
}

export function decideSignoff({ uiTouched, planText = '', issueBody = '', previewApps: previews = [] }) {
  if (Number(uiTouched) !== 1) return { hold: false, lookAt: null, link: '', note: '', reason: 'not-visual' }
  const lookAt = parseLookAt(planText) ?? parseLookAt(issueBody)
  const noHold = (reason, why) => ({
    hold: false, lookAt, link: '', reason,
    note: `\n\n👁 No visual surface on a preview (${why || 'the plan names no page to look at'}) — not held for sign-off; reviewed as a normal PR.`
  })
  if (!lookAt) return noHold('none-named')
  if (lookAt.none) return noHold('none', lookAt.why)
  if (!lookAt.sight) return noHold('no-sight')
  if (!previews.includes(lookAt.app)) {
    return {
      hold: false, lookAt, link: '', reason: 'no-preview',
      note: `\n\n👁 The page named for review (${lookAt.app} ${lookAt.path}) gets no preview on this PR — not held for sign-off; reviewed as a normal PR.`
    }
  }
  const link = `${STATUS}/${lookAt.app}?key=pr{{PR}}&to=${encodeURIComponent(lookAt.path)}`
  return {
    hold: true, lookAt, link, reason: 'named',
    note: `\n\n👁 **What to look at:** [${lookAt.app} ${lookAt.path}](${link}) — you should see ${lookAt.sight}\n\nHeld for your sign-off: reply \`ok\` to release it, or \`not ok: what is wrong\`.\n\n${MARKER}`
  }
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
const read = f => { try { return f ? readFileSync(f, 'utf8') : '' } catch { return '' } }

function main() {
  if (arg('fill-pr')) {
    process.stdout.write(fillPr(read(arg('body')), arg('fill-pr')))
    return
  }
  try {
    const files = execFileSync('git', ['diff', '--name-only', `${arg('base')}..HEAD`], { encoding: 'utf8' })
      .split('\n').filter(Boolean)
    const d = decideSignoff({
      uiTouched: arg('ui'), planText: read(arg('plan')), issueBody: read(arg('issue')), previewApps: previewApps(files)
    })
    console.log(`HOLD=${d.hold ? 1 : 0}`)
    console.log(`REASON=${d.reason}`)
    console.log(`NOTE_B64=${Buffer.from(d.note).toString('base64')}`)
    if (d.hold) console.log(`SURFACE=<!-- review-surface: ${d.lookAt.app} ${d.lookAt.path} -->`)
  } catch (e) {
    console.error(`signoff-surface failed: ${e.message}`)
    const note = `\n\n👁 **Visual change — held for sign-off.** This PR touches a surface you have to LOOK at, so it opens as a draft. Reply \`ok\` to release it, or \`not ok: what is wrong\`.\n\n${MARKER}`
    console.log('HOLD=1')
    console.log('REASON=error')
    console.log(`NOTE_B64=${Buffer.from(note).toString('base64')}`)
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main()
