#!/usr/bin/env node
// Crate export (#2213) — write the app's tags back into rekordbox via an XML round-trip.
//
//   node pocs/crate/scripts/export.mjs --url https://crate-staging.pmcp.dev [--genre keep|first|all] [--dry-run]
//
// Builds an XML with ONLY the changed tracks, each a verbatim copy of its TRACK element from the
// local rekordbox export (cues, beatgrid, every attribute) with Comments replaced, plus a
// "Tagged <date>" playlist. Import it in rekordbox (see README) to apply the tags.
import { writeFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { DEFAULT_URL, DEFAULT_XML, attributes, encodeXml, readCollection, signIn } from './lib.mjs'

const today = new Date().toISOString().slice(0, 10)
const { values: args } = parseArgs({
  options: {
    'url': { type: 'string', default: DEFAULT_URL },
    'xml': { type: 'string', default: DEFAULT_XML },
    'out': { type: 'string', default: `/Users/Shared/crate-export-${today}.xml` },
    'team': { type: 'string' },
    // rekordbox Genre: keep it, set it to the first (top-level) pile, or to every pile tag
    'genre': { type: 'string', default: 'keep' },
    'dry-run': { type: 'boolean', default: false }
  }
})
if (!['keep', 'first', 'all'].includes(args.genre)) throw new Error('--genre must be keep, first or all')

/** Set (or add) one attribute on a raw element's opening tag, leaving everything else byte-identical. */
function setAttr(element, name, value) {
  const open = element.slice(0, element.indexOf('>'))
  const encoded = `${name}="${encodeXml(value)}"`
  const pattern = new RegExp(`\\s${name}="[^"]*"`)
  const nextOpen = pattern.test(open) ? open.replace(pattern, ` ${encoded}`) : open.replace(/\s*\/?$/, m => ` ${encoded}${m}`)
  return nextOpen + element.slice(open.length)
}

const { api, team } = await signIn(args.url, args.team)
const { tracks, genres } = await api(`/api/teams/${team.id}/crate/export`)
const tagsById = new Map(tracks.map(t => [t.rekordboxId, t.tags]))
const genreSet = new Set(genres.map(g => g.toLowerCase()))

const { xml, collection } = readCollection(args.xml)
const product = xml.match(/<PRODUCT\s[^>]*\/>/)?.[0] ?? '<PRODUCT Name="rekordbox" Company="AlphaTheta"/>'
const elements = []
for (const m of collection.matchAll(/<TRACK\s[^>]*?(?:\/>|>[\s\S]*?<\/TRACK>)/g)) {
  const id = attributes(m[0].slice(0, m[0].indexOf('>'))).TrackID
  const tags = tagsById.get(id)
  if (!tags) continue
  let el = setAttr(m[0], 'Comments', tags.join(', '))
  const genreTags = tags.filter(t => genreSet.has(t.toLowerCase()))
  if (args.genre === 'first' && genreTags[0]) el = setAttr(el, 'Genre', genreTags[0])
  if (args.genre === 'all' && genreTags.length) el = setAttr(el, 'Genre', genreTags.join(', '))
  elements.push({ id, el })
}

const missing = tracks.length - elements.length
const out = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<DJ_PLAYLISTS Version="1.0.0">',
  `  ${product}`,
  `  <COLLECTION Entries="${elements.length}">`,
  ...elements.map(e => `    ${e.el}`),
  '  </COLLECTION>',
  '  <PLAYLISTS>',
  '    <NODE Type="0" Name="ROOT" Count="1">',
  `      <NODE Name="Tagged ${today}" Type="1" KeyType="0" Entries="${elements.length}">`,
  ...elements.map(e => `        <TRACK Key="${e.id}"/>`),
  '      </NODE>',
  '    </NODE>',
  '  </PLAYLISTS>',
  '</DJ_PLAYLISTS>',
  ''
].join('\n')

console.log(`${tracks.length} changed in "${team.name}" · ${elements.length} found in ${args.xml}${missing ? ` · ${missing} not in this XML (skipped)` : ''} · Genre: ${args.genre}`)
if (args['dry-run']) {
  elements.slice(0, 5).forEach(e => console.log(`  ${e.id}: ${tagsById.get(e.id).join(', ')}`))
  console.log('Dry run — nothing written.')
}
else {
  writeFileSync(args.out, out)
  console.log(`Wrote ${args.out}`)
}
