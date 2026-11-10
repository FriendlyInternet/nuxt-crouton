#!/usr/bin/env node
/**
 * fetch-artifacts.mjs — list + download this repo's recent Actions artifacts (#3672).
 *
 *   node scripts/fetch-artifacts.mjs --prefix loop-station-trace- --prefix pi-telemetry- --days 7 --out traces
 *
 * Replaces the inline `gh api --paginate` + sequential download in weekly.yml, which
 * listed ALL ~11k artifacts (one cut-off page killed the step) and downloaded one by one.
 * The API returns artifacts newest-first, so listing stops once a page is entirely older
 * than the cutoff (minus a safety margin). Each page is retried; a page that keeps failing
 * exits 1 — a listing outage must never read as a quiet week. Needs GH_TOKEN + GITHUB_REPOSITORY.
 */
import { pathToFileURL } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const MARGIN_MS = 24 * 3600 * 1000

/** True when every artifact on the page is older than the cutoff minus the margin. */
export function shouldStop(page, cutoff) {
  if (!page.length) return true
  const limit = cutoff.getTime() - MARGIN_MS
  return page.every(a => new Date(a.created_at).getTime() < limit)
}

/** In-window, non-expired, prefix-matched artifacts of one page. */
export function selectArtifacts(page, prefixes, cutoff) {
  return page.filter(a =>
    !a.expired
    && prefixes.some(p => a.name.startsWith(p))
    && new Date(a.created_at).getTime() >= cutoff.getTime())
}

/** List matching artifacts. `fetchPage(n)` resolves to an array of artifacts or throws. */
export async function listArtifacts({ fetchPage, cutoff, prefixes, retries = 3 }) {
  const found = []
  let seen = 0
  for (let n = 1; ; n++) {
    let page
    for (let attempt = 1; ; attempt++) {
      try {
        page = await fetchPage(n)
        break
      } catch (err) {
        if (attempt >= retries) {
          throw new Error(`listed ${n - 1} pages / ${seen} artifacts, failed at page ${n}: ${err.message}`)
        }
      }
    }
    seen += page.length
    found.push(...selectArtifacts(page, prefixes, cutoff))
    if (shouldStop(page, cutoff)) break
  }
  return found
}

async function api(path, { raw = false } = {}) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json' }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`)
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json()
}

async function download(a, out) {
  let last
  for (let i = 0; i < 2; i++) {
    try {
      const zip = await api(`/actions/artifacts/${a.id}/zip`, { raw: true })
      mkdirSync(join(out, a.name), { recursive: true })
      const zipPath = join(out, `${a.name}.zip`)
      writeFileSync(zipPath, zip)
      execFileSync('unzip', ['-o', '-q', zipPath, '-d', join(out, a.name)])
      return true
    } catch (err) { last = err }
  }
  console.log(`::warning::could not fetch artifact ${a.name} (${a.id}): ${last.message}`)
  return false
}

async function main() {
  const argv = process.argv.slice(2)
  const prefixes = []
  let days = 7
  let out = 'artifacts'
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--prefix') prefixes.push(argv[++i])
    else if (argv[i] === '--days') days = Number(argv[++i])
    else if (argv[i] === '--out') out = argv[++i]
  }
  if (!prefixes.length || !process.env.GH_TOKEN || !process.env.GITHUB_REPOSITORY) {
    console.error('usage: GH_TOKEN=… GITHUB_REPOSITORY=o/r fetch-artifacts.mjs --prefix <p> [--prefix <p>] --days N --out <dir>')
    process.exit(1)
  }
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000)
  const list = await listArtifacts({
    fetchPage: async n => (await api(`/actions/artifacts?per_page=100&page=${n}`)).artifacts,
    cutoff,
    prefixes
  })
  console.log(`${list.length} artifact(s) in window (cutoff ${cutoff.toISOString()})`)
  mkdirSync(out, { recursive: true })
  let ok = 0
  let next = 0
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < list.length) {
      if (await download(list[next++], out)) ok++
    }
  }))
  console.log(`downloaded ${ok}, dropped ${list.length - ok} of ${list.length}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`fetch-artifacts failed: ${err.message}`)
    process.exit(1)
  })
}
