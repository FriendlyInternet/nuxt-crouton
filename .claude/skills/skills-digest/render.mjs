#!/usr/bin/env node
/**
 * Render the monthly skills digest to email-safe HTML + plain text (#841).
 *
 *   node render.mjs <data.json> [--out-dir writeups/reports] [--date YYYYMMDD]
 *
 * Dependency-free (no npm deps, no network). Reads the JSON from gather.mjs and writes:
 *
 *   <out-dir>/skills-digest-<YYYYMMDD>.html         email-safe HTML (inline styles, tables)
 *   <out-dir>/skills-digest-<YYYYMMDD>.txt          plain-text mirror
 *   <out-dir>/skills-digest-<YYYYMMDD>.subject.txt  the email subject (read verbatim by CI)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { BRAND_NAME, BRAND_URL, PRIMARY_COLOR } from '../../../packages/crouton-email/brand/email-brand.mjs'
// The trigger→skill flow lanes — same declarative source as skills-and-triggers.html (#843),
// so the email's "the flow" section and the doc page can never disagree.
import { FLOWS, flowSkillName } from '../../../scripts/gen-skills-doc.mjs'

// ── args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const input = args.filter((a) => !a.startsWith('--'))[0]
if (!input) {
  console.error('Usage: render.mjs <data.json> [--out-dir DIR] [--date YYYYMMDD]')
  process.exit(1)
}
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i !== -1 ? args[i + 1] : dflt
}

const data = JSON.parse(readFileSync(resolve(input), 'utf8'))
const generated = data.generatedAt ? new Date(data.generatedAt) : new Date()
const stamp = flag('date', generated.toISOString().slice(0, 10).replace(/-/g, ''))
const outDir = flag('out-dir', 'writeups/reports')
const repo = data.repo || 'repo'
const total = data.total ?? (data.groups || []).reduce((n, g) => n + g.skills.length, 0)
const changed = data.changed || { firstRun: true, added: [], updated: [], removed: [] }

// ── helpers ─────────────────────────────────────────────────────────────────
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const monthYear = generated.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
const prettySince = data.since
  ? new Date(`${data.since}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : ''

// Trigger badge palette — colour carries the one real meaning here (how it fires).
const TRIG = {
  auto: { label: 'auto', fg: '#0f766e', bg: '#d3eeea', bd: '#9fd6cf' },
  ask: { label: 'on ask', fg: '#1d4ed8', bg: '#dde6fb', bd: '#b6c8f4' },
  flow: { label: 'in flow', fg: '#6d28d9', bg: '#e8e0fb', bd: '#cbb8f2' },
  cron: { label: 'on a schedule', fg: '#b45309', bg: '#fdecd2', bd: '#f4d29b' }
}
const badge = (t) => {
  const c = TRIG[t] || TRIG.ask
  return `<span style="display:inline-block;font:700 10.5px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:${c.fg};background:${c.bg};border:1px solid ${c.bd};border-radius:999px;padding:1px 8px;margin-left:4px;white-space:nowrap;">${c.label}</span>`
}

// ── HTML ──────────────────────────────────────────────────────────────────
const changeRow = (label, items, color, withDesc) => {
  if (!items.length) return ''
  const lis = items
    .map(
      (s) =>
        `<li style="margin:0 0 6px;"><code style="font:700 13px ui-monospace,Menlo,Consolas,monospace;color:#0f172a;">/${esc(s.name)}</code>` +
        (withDesc && s.desc ? `<span style="color:#64748b;font-size:12.5px;"> — ${esc(s.desc.split('. ')[0])}.</span>` : '') +
        `</li>`
    )
    .join('')
  return `<tr><td style="padding:10px 14px;border-left:3px solid ${color};background:#fff;">
    <div style="font:700 13px -apple-system,Segoe UI,Roboto,sans-serif;color:${color};margin-bottom:6px;">${label} <span style="color:#94a3b8;font-weight:600;">· ${items.length}</span></div>
    <ul style="margin:0;padding-left:18px;list-style:disc;">${lis}</ul>
  </td></tr>`
}

const changedBand = () => {
  if (changed.firstRun) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;"><tr><td style="padding:12px 14px;background:#f1f5f9;border-radius:10px;color:#64748b;font:13px -apple-system,Segoe UI,Roboto,sans-serif;">📋 <strong style="color:#334155;">First digest</strong> — no prior snapshot to compare against. Next month's mail will show what changed.</td></tr></table>`
  }
  const { added = [], updated = [], removed = [] } = changed
  if (!added.length && !updated.length && !removed.length) {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 26px;"><tr><td style="padding:12px 14px;background:#f1f5f9;border-radius:10px;color:#64748b;font:13px -apple-system,Segoe UI,Roboto,sans-serif;">📋 <strong style="color:#334155;">No skill changes</strong> since ${esc(prettySince)} — the set held steady. 🎉</td></tr></table>`
  }
  return `<h2 style="font:700 17px -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:0 0 4px;">📋 What changed since ${esc(prettySince)}</h2>
  <p style="color:#64748b;font-size:13px;margin:0 0 12px;">${added.length} added · ${updated.length} updated · ${removed.length} removed</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate;overflow:hidden;margin:0 0 28px;">
    ${changeRow('✨ Added', added, '#0f766e', true)}
    ${changeRow('✏️ Updated', updated, '#1d4ed8', false)}
    ${changeRow('🗑️ Removed', removed, '#b91c1c', false)}
  </table>`
}

// ── the flow ("when each skill fires") — email-safe lane table ──────────────
const flowChip = (s) => {
  const name = flowSkillName(s)
  const cad =
    typeof s === 'object' && s.at
      ? `<span style="font:700 9px/1 -apple-system,Segoe UI,Roboto,sans-serif;text-transform:uppercase;letter-spacing:.04em;color:#b45309;background:#fdecd2;border:1px solid #f4d29b;border-radius:999px;padding:1px 5px;margin-left:5px;">${esc(s.at)}</span>`
      : ''
  return `<span style="display:inline-block;font:700 12px ui-monospace,Menlo,Consolas,monospace;color:#0f172a;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:2px 7px;margin:2px 0;">/${esc(name)}${cad}</span>`
}
const flowLane = (lane) => {
  const t = TRIG[lane.kind] || TRIG.ask
  const chips = lane.skills.map(flowChip).join('<span style="color:#94a3b8;font-weight:700;">&nbsp;→&nbsp;</span>')
  return `<tr>
    <td style="padding:11px 12px;border-bottom:1px solid #eef2f7;vertical-align:top;width:38%;">
      <div style="font:700 13px -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;">${lane.icon} ${esc(lane.trigger)}</div>
      <div style="margin-top:3px;"><span style="display:inline-block;font:700 10px -apple-system,Segoe UI,Roboto,sans-serif;color:${t.fg};background:${t.bg};border:1px solid ${t.bd};border-radius:999px;padding:1px 7px;">${t.label}</span></div>
      <div style="color:#94a3b8;font-size:11.5px;margin-top:4px;line-height:1.4;">${esc(lane.when)}</div>
    </td>
    <td style="padding:11px 12px;border-bottom:1px solid #eef2f7;vertical-align:top;line-height:1.9;">${chips}</td>
  </tr>`
}
const flowSection = () =>
  `<h2 style="font:700 17px -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:4px 0 4px;">🔀 When each skill fires — the flow</h2>
  <p style="color:#64748b;font-size:13px;margin:0 0 12px;">Which event sets off which skills, in order. The grouped list below is the same skills by job.</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px;border-collapse:separate;overflow:hidden;margin:0 0 30px;">${FLOWS.map(flowLane).join('')}</table>`

const skillCard = (s) =>
  `<tr><td style="padding:11px 0;border-bottom:1px solid #eef2f7;">
    <div style="margin-bottom:3px;"><code style="font:700 14px ui-monospace,Menlo,Consolas,monospace;color:#0f172a;">/${esc(s.name)}</code>${(s.triggers || ['ask']).map(badge).join('')}</div>
    <div style="color:#64748b;font:12.5px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;">${esc(s.desc)}</div>
  </td></tr>`

const groupSection = (g, i) =>
  `<h2 style="font:700 16px -apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;margin:30px 0 2px;">${i + 1}. ${esc(g.title)} <span style="color:#94a3b8;font-weight:600;font-size:13px;">· ${g.skills.length}</span></h2>
  <p style="color:#94a3b8;font-size:12.5px;margin:0 0 8px;">${esc(g.sub)}</p>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${g.skills.map(skillCard).join('')}</table>`

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Skills digest — ${esc(monthYear)}</title></head>
<body style="margin:0;background:#f8fafc;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;"><tr><td align="center" style="padding:28px 14px 60px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
  <tr><td style="padding:24px 26px;background:${PRIMARY_COLOR};">
    <div style="font:700 11px -apple-system,Segoe UI,Roboto,sans-serif;letter-spacing:.16em;text-transform:uppercase;color:#9fe9df;">${esc(repo)} · agent flow</div>
    <div style="font:800 24px -apple-system,Segoe UI,Roboto,sans-serif;color:#ffffff;margin-top:4px;">🧩 Skills digest — ${esc(monthYear)}</div>
    <div style="color:#cdeee9;font-size:14px;margin-top:5px;"><strong style="color:#fff;">${total}</strong> skills in <code style="color:#eafcf8;">.claude/skills/</code> · grouped by job, with how each one triggers</div>
  </td></tr>
  <tr><td style="padding:24px 26px;">
    ${changedBand()}
    ${flowSection()}
    ${(data.groups || []).map(groupSection).join('')}
    <p style="margin:34px 0 0;padding-top:16px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px;">
      <a href="${BRAND_URL}" style="color:${PRIMARY_COLOR};text-decoration:none;">${BRAND_NAME}</a> · generated ${generated.toISOString().slice(0, 10)} by the <code>/skills-digest</code> skill ·
      list + trigger map sourced from <code>scripts/gen-skills-doc.mjs</code>. No JS · renders offline.
    </p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`

// ── plain-text mirror ─────────────────────────────────────────────────────
const txtChanged = () => {
  if (changed.firstRun) return '📋 First digest — no prior snapshot to compare against.\n'
  const { added = [], updated = [], removed = [] } = changed
  if (!added.length && !updated.length && !removed.length) return `📋 No skill changes since ${prettySince}.\n`
  const block = (label, items) => (items.length ? `${label} (${items.length}):\n` + items.map((s) => `  - /${s.name}`).join('\n') + '\n' : '')
  return (
    `📋 WHAT CHANGED since ${prettySince} — ${added.length} added · ${updated.length} updated · ${removed.length} removed\n` +
    block('  Added', added) +
    block('  Updated', updated) +
    block('  Removed', removed)
  )
}
const txtFlow =
  `🔀 WHEN EACH SKILL FIRES — THE FLOW\n` +
  FLOWS.map(
    (lane) =>
      `  ${lane.icon} ${lane.trigger} [${(TRIG[lane.kind] || TRIG.ask).label}]\n` +
      `     ${lane.skills.map((s) => `/${flowSkillName(s)}${typeof s === 'object' && s.at ? ` (${s.at})` : ''}`).join(' → ')}`
  ).join('\n') +
  '\n'

const txt =
  `🧩 SKILLS DIGEST — ${monthYear}\n${repo} · ${total} skills\n\n` +
  txtChanged() +
  '\n' +
  txtFlow +
  '\n' +
  (data.groups || [])
    .map(
      (g, i) =>
        `${i + 1}. ${g.title.toUpperCase()} (${g.skills.length})\n   ${g.sub}\n` +
        g.skills.map((s) => `   /${s.name}  [${(s.triggers || ['ask']).join(', ')}]\n     ${s.desc}`).join('\n')
    )
    .join('\n\n') +
  `\n\n${BRAND_NAME} · generated ${generated.toISOString().slice(0, 10)} by /skills-digest\n`

// ── subject (read verbatim by the CI email step) ───────────────────────────
const bits = [`${total} skills`]
if (!changed.firstRun) {
  const a = (changed.added || []).length
  const u = (changed.updated || []).length
  const r = (changed.removed || []).length
  if (a) bits.push(`+${a} new`)
  if (u) bits.push(`${u} updated`)
  if (r) bits.push(`-${r} removed`)
  if (!a && !u && !r) bits.push('no changes')
}
const subject = `Skills digest — ${bits.join(' · ')}`

// ── write ──────────────────────────────────────────────────────────────────
mkdirSync(resolve(outDir), { recursive: true })
const htmlPath = join(outDir, `skills-digest-${stamp}.html`)
const txtPath = join(outDir, `skills-digest-${stamp}.txt`)
const subjectPath = join(outDir, `skills-digest-${stamp}.subject.txt`)
writeFileSync(resolve(htmlPath), html)
writeFileSync(resolve(txtPath), txt)
writeFileSync(resolve(subjectPath), subject + '\n')
console.log(`✓ HTML    → ${htmlPath}`)
console.log(`✓ Text    → ${txtPath}`)
console.log(`✓ Subject → ${subject}`)
console.log(`  ${total} skills · ${(changed.added || []).length} added / ${(changed.updated || []).length} updated / ${(changed.removed || []).length} removed since ${data.since}`)
