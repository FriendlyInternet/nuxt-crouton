// Discovers every apps/*/ and pocs/*/ deploy.config.json and writes the
// staging-URL lookup the owner sign-in route imports (server/utils/app-urls.generated.json).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '../../..')
export const outFile = resolve(here, '../server/utils/app-urls.generated.json')

export function discoverApps(root = repoRoot) {
  const apps = {}
  for (const dir of ['apps', 'pocs']) {
    const base = join(root, dir)
    if (!existsSync(base)) continue
    for (const name of readdirSync(base).sort()) {
      const file = join(base, name, 'deploy.config.json')
      if (!existsSync(file)) continue
      const cfg = JSON.parse(readFileSync(file, 'utf8'))
      apps[name] = {
        ...(cfg.stagingUrl ? { stagingUrl: cfg.stagingUrl } : {}),
        ...(cfg.reviewLogin === false ? { reviewLogin: false } : {})
      }
    }
  }
  return apps
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(outFile, `${JSON.stringify(discoverApps(), null, 2)}\n`)
  console.log(`[gen-app-urls] wrote ${outFile}`)
}
