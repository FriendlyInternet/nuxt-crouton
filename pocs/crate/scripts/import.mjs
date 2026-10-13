#!/usr/bin/env node
// Crate import (#2206) — run on the Mac that holds the rekordbox XML.
//
//   node pocs/crate/scripts/import.mjs [--url http://localhost:3017] [--xml <path>] [--dry-run]
//
// Reads the rekordbox XML export, finds each track's audio in the Dropbox folder (#2214),
// and uploads tracks + the prototype's pile tree, re-tags and genre lookups to the app.
// Safe to re-run: tracks upsert by TrackID; tags edited in the app are kept.
//
// Env (pocs/crate/.env): CRATE_EMAIL, CRATE_PASSWORD (an app login),
// DROPBOX_APP_KEY, DROPBOX_REFRESH_TOKEN, DROPBOX_AUDIO_ROOT.
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

const here = dirname(fileURLToPath(import.meta.url))
const envFile = join(here, '..', '.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)

const { values: args } = parseArgs({
  options: {
    'url': { type: 'string', default: process.env.CRATE_URL || 'http://localhost:3017' },
    'xml': { type: 'string', default: '/Users/paulmcparty/DJ/exportForTagger.xml' },
    'data': { type: 'string', default: join(homedir(), 'Library/Application Support/CrateTagger') },
    'team': { type: 'string' },
    'dry-run': { type: 'boolean', default: false }
  }
})

const BATCH = 400

// ── rekordbox XML ──────────────────────────────────────────────────────────
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' }
const decode = s => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(Number.parseInt(e.slice(e[1] === 'x' ? 2 : 1), e[1] === 'x' ? 16 : 10)) : (ENTITIES[e] ?? m))

/** Collection TRACK elements → attribute maps. The file is 71 MB; one regex pass over the COLLECTION block. */
function readTracks(path) {
  const xml = readFileSync(path, 'utf8')
  const start = xml.indexOf('<COLLECTION')
  const end = xml.indexOf('</COLLECTION>', start)
  const tracks = []
  for (const m of xml.slice(start, end).matchAll(/<TRACK\s([^>]*?)\/?>/g)) {
    const attrs = {}
    for (const a of m[1].matchAll(/(\w+)="([^"]*)"/g)) attrs[a[1]] = decode(a[2])
    if (attrs.TrackID) tracks.push(attrs)
  }
  return tracks
}

const splitComments = c => (c ?? '').split(',').map(t => t.trim()).filter(Boolean)
const num = v => (v === undefined || v === '' ? null : Number(v))
const int = v => (v === undefined || v === '' || Number(v) === 0 ? null : Math.round(Number(v)))

// ── Dropbox audio (#2214) ───────────────────────────────────────────────────
// Files live at <root>/<artist>/<album>/<artist> - <title>.<ext>, lowercased and truncated,
// so match on the normalised basename, or a ≥12-char prefix of it.
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')

async function dropboxFiles() {
  const { DROPBOX_APP_KEY: key, DROPBOX_REFRESH_TOKEN: refresh, DROPBOX_AUDIO_ROOT: root } = process.env
  if (!key || !refresh || !root) throw new Error('Missing DROPBOX_APP_KEY / DROPBOX_REFRESH_TOKEN / DROPBOX_AUDIO_ROOT in pocs/crate/.env')
  const tok = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: key })
  }).then(r => r.json())
  if (!tok.access_token) throw new Error(`Dropbox token refresh failed: ${JSON.stringify(tok)}`)
  const call = (ep, body) => fetch(`https://api.dropboxapi.com/2/files/${ep}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(r => r.json())
  let page = await call('list_folder', { path: root, recursive: true, limit: 2000 })
  const files = []
  for (;;) {
    if (page.error_summary) throw new Error(`Dropbox list_folder: ${page.error_summary}`)
    files.push(...page.entries.filter(e => e['.tag'] === 'file'))
    if (!page.has_more) break
    page = await call('list_folder/continue', { cursor: page.cursor })
  }
  return files
}

function audioMatcher(files) {
  // Prefer the plain file over rekordbox's "(2)" duplicates.
  const byKey = new Map()
  for (const f of files.sort((a, b) => a.name.length - b.name.length)) {
    const key = norm(f.name.replace(/\.[^.]+$/, ''))
    if (!byKey.has(key)) byKey.set(key, f.path_display)
  }
  const prefixes = [...byKey.keys()].filter(k => k.length >= 12).sort((a, b) => b.length - a.length)
  return (location) => {
    const base = norm(decodeURIComponent(location).split('/').pop().replace(/\.[^.]+$/, ''))
    return byKey.get(base) ?? byKey.get(prefixes.find(p => base.startsWith(p))) ?? null
  }
}

// ── App API ────────────────────────────────────────────────────────────────
async function signIn() {
  const { CRATE_EMAIL: email, CRATE_PASSWORD: password } = process.env
  if (!email || !password) throw new Error('Set CRATE_EMAIL and CRATE_PASSWORD (an app login) in pocs/crate/.env')
  const res = await fetch(`${args.url}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': args.url },
    body: JSON.stringify({ email, password })
  })
  if (!res.ok) throw new Error(`Sign-in failed (${res.status}): ${await res.text()}`)
  const cookie = res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  const api = async (path, init = {}) => {
    const r = await fetch(`${args.url}${path}`, { ...init, headers: { 'Content-Type': 'application/json', 'Origin': args.url, cookie, ...init.headers } })
    if (!r.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${r.status}: ${(await r.text()).slice(0, 500)}`)
    return r.json()
  }
  const teams = await api('/api/auth/organization/list')
  const team = args.team ? teams.find(t => t.slug === args.team || t.id === args.team) : teams[0]
  if (!team) throw new Error(`No team found for ${email}${args.team ? ` matching "${args.team}"` : ''} — create one in the app first`)
  return { api, team }
}

const readJson = (file, fallback) => {
  const p = join(args.data, file)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback
}

// ── Run ────────────────────────────────────────────────────────────────────
const xmlTracks = readTracks(args.xml)
const edits = readJson('edits.json', {})
const layout = readJson('layout.json', { piles: {} })
const lookups = readJson('lookups.json', {})
const audioFor = audioMatcher(await dropboxFiles())

const tracks = xmlTracks.map(t => ({
  rekordboxId: t.TrackID,
  name: t.Name || '(untitled)',
  artist: t.Artist || null,
  album: t.Album || null,
  genre: t.Genre || null,
  year: int(t.Year),
  bpm: num(t.AverageBpm),
  tonality: t.Tonality || null,
  durationSec: int(t.TotalTime),
  label: t.Label || null,
  dateAdded: t.DateAdded || null,
  location: t.Location,
  audioPath: audioFor(t.Location),
  originalComments: t.Comments ?? '',
  tags: edits[t.TrackID] ?? splitComments(t.Comments)
}))
const piles = Object.entries(layout.piles).map(([key, p]) => ({ key, name: p.name, parentKey: p.parent ?? null, order: p.order ?? 0 }))
const lookupRows = Object.entries(lookups).map(([rekordboxId, l]) => ({ rekordboxId, fetchedAt: new Date(l.at * 1000).toISOString(), results: l.results }))

const inbox = tracks.filter(t => t.tags.every(tag => tag === 'NEW'))
const withAudio = tracks.filter(t => t.audioPath)
console.log(`XML: ${tracks.length} tracks · ${inbox.length} need tags · audio found for ${withAudio.length} (${inbox.filter(t => t.audioPath).length}/${inbox.length} of the inbox)`)
console.log(`Prototype: ${piles.length} piles · ${Object.keys(edits).length} re-tags · ${lookupRows.length} lookups`)

if (args['dry-run']) {
  console.log('Dry run — nothing uploaded.')
  process.exit(0)
}

const { api, team } = await signIn()
const endpoint = `/api/teams/${team.id}/crate/import`
const totals = {}
const add = r => Object.entries(r).forEach(([k, v]) => { totals[k] = (totals[k] ?? 0) + v })

add(await api(endpoint, { method: 'POST', body: JSON.stringify({ piles }) }))
for (let i = 0; i < tracks.length; i += BATCH) {
  add(await api(endpoint, { method: 'POST', body: JSON.stringify({ tracks: tracks.slice(i, i + BATCH) }) }))
  process.stdout.write(`\rTracks ${Math.min(i + BATCH, tracks.length)}/${tracks.length}`)
}
process.stdout.write('\n')
for (let i = 0; i < lookupRows.length; i += BATCH) {
  add(await api(endpoint, { method: 'POST', body: JSON.stringify({ lookups: lookupRows.slice(i, i + BATCH) }) }))
}
console.log(`Imported into "${team.name}" at ${args.url}:`, totals)
