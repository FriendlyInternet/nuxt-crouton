import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'server')
const SCANNED = ['plugins', 'api', 'routes', 'middleware', 'tasks']

function walk(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap(f => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

describe('no devframe code in Nitro auto-scanned dirs', () => {
  it('server/{plugins,api,routes,middleware,tasks} never mention devframe', () => {
    const offenders = SCANNED.flatMap(d => walk(join(root, d))).filter(f => {
      const src = readFileSync(f, 'utf8')
      return /from ['"]devframe|__crouton_df|crouton-df/.test(src)
    })
    expect(offenders).toEqual([])
  })
})
