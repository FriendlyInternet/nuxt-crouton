// Shared by scripts/import.mjs and scripts/export.mjs — run on the Mac that holds the rekordbox XML.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const envFile = join(dirname(fileURLToPath(import.meta.url)), '..', '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

export const DEFAULT_XML = '/Users/paulmcparty/DJ/exportForTagger.xml'
export const DEFAULT_URL = process.env.CRATE_URL || 'http://localhost:3017'

/** The rekordbox COLLECTION block of an export (the file is ~71 MB; read it once). */
export function readCollection(path) {
  const xml = readFileSync(path, 'utf8')
  const start = xml.indexOf('<COLLECTION')
  return { xml, collection: xml.slice(start, xml.indexOf('</COLLECTION>', start)) }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' }
export const decodeXml = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(Number.parseInt(e.slice(e[1] === 'x' ? 2 : 1), e[1] === 'x' ? 16 : 10)) : (ENTITIES[e] ?? m))
export const encodeXml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const attributes = attrText => Object.fromEntries([...attrText.matchAll(/(\w+)="([^"]*)"/g)].map(a => [a[1], decodeXml(a[2])]))
export const splitComments = c => (c ?? '').split(',').map(t => t.trim()).filter(Boolean)

/** Sign in with CRATE_EMAIL / CRATE_PASSWORD and return a cookie-carrying API caller + the team. */
export async function signIn(url, teamArg) {
  const { CRATE_EMAIL: email, CRATE_PASSWORD: password } = process.env
  if (!email || !password) throw new Error('Set CRATE_EMAIL and CRATE_PASSWORD (an app login) in pocs/crate/.env')
  const res = await fetch(`${url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': url },
    body: JSON.stringify({ email, password })
  })
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}): ${await res.text()}`)
  const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const api = async (path, init = {}) => {
    const r = await fetch(`${url}${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'Origin': url, cookie, ...init.headers } })
    if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${r.status}: ${(await r.text()).slice(0, 500)}`)
    return r.json()
  }
  const teams = await api('/api/auth/organization/list')
  const team = teamArg ? teams.find(t => t.slug === teamArg || t.id === teamArg) : teams[0]
  if (!team) throw new Error(`No team found for ${email}${teamArg ? ` matching "${teamArg}"` : ''} — create one in the app first`)
  return { api, team }
}
