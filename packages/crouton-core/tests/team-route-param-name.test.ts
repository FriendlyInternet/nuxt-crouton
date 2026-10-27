import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// h3 v1 / radix3 keeps ONE param node per path position: the first route inserted
// under `/api/teams/` names it, and any sibling using another name silently stops
// matching (404 "Page Not Found"). crouton-events once used `[teamId]` and took down
// every `/api/teams/[id]/*` list route on velo staging (#2752, same class as #116).
const packagesDir = resolve(__dirname, '../..')

function teamsDirs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (!statSync(full).isDirectory()) continue
    if (name === 'teams' && dir.endsWith(join('server', 'api'))) out.push(full)
    else teamsDirs(full, out)
  }
  return out
}

describe('/api/teams/<param> directory name', () => {
  it('is [id] in every package and collection layer', () => {
    const offenders: string[] = []
    let scanned = 0
    for (const pkg of readdirSync(packagesDir)) {
      const root = join(packagesDir, pkg)
      if (!statSync(root).isDirectory()) continue
      for (const teams of teamsDirs(root)) {
        scanned++
        for (const entry of readdirSync(teams)) {
          if (/^\[.+\]$/.test(entry) && entry !== '[id]') offenders.push(join(teams, entry))
        }
      }
    }
    expect(scanned).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
