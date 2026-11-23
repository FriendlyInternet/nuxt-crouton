// Detect Nuxt routeRules that shadow parameterised API routes (#4300).
//
// For every swr/isr/cache rule, Nuxt registers its page renderer as a real
// handler on the rule's path, rewriting each `*` as a named parameter. If the
// same prefix also has a `[param]` handler folder, radix3 sees two `:param`
// children and can route deeper requests down the renderer branch, which
// answers "Page Not Found". velo's `/api/crouton-bookings/teams/*/availability`
// rule broke bookings update/cancel, resend-email and every charts/* endpoint.
//
// Node built-ins only: the CI job that runs scripts tests installs nothing.
import { readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const RULE_RE = /["'](\/api\/[^"']*)["']\s*:\s*\{([^}]*)\}/g
const CACHE_KEY_RE = /\b(swr|isr|cache)\s*:/
const PARAM_DIR_RE = /^\[[^.\]]/

function stripLineComments(text) {
  return text
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n')
}

function listParamDirs(dir) {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter(name => PARAM_DIR_RE.test(name) && statSync(join(dir, name)).isDirectory())
  }
  catch {
    return []
  }
}

/**
 * @param {{ configText: string, serverRoots: string[] }} input
 * @returns {{ rule: string, paramDirs: string[] }[]}
 */
export function findShadowingRules({ configText, serverRoots }) {
  const text = stripLineComments(configText)
  const hits = []
  for (const match of text.matchAll(RULE_RE)) {
    const [, rule, body] = match
    const segments = rule.split('/')
    const starAt = segments.indexOf('*')
    if (starAt === -1) continue
    if (!CACHE_KEY_RE.test(body)) continue
    const prefix = segments.slice(0, starAt).join('/')
    const paramDirs = []
    for (const root of serverRoots) {
      const dir = join(root, 'server', prefix)
      for (const name of listParamDirs(dir)) paramDirs.push(join(dir, name))
    }
    if (paramDirs.length) hits.push({ rule, paramDirs })
  }
  return hits
}

/**
 * Every `{apps,pocs,packages}/<name>/nuxt.config.ts` plus the server roots
 * whose handlers could share its routes (all packages + the config's own dir).
 * @param {string} repoRoot
 * @returns {{ config: string, serverRoots: string[] }[]}
 */
export function repoTargets(repoRoot) {
  const subdirs = (group) => {
    const base = join(repoRoot, group)
    if (!existsSync(base)) return []
    return readdirSync(base)
      .map(name => join(base, name))
      .filter(p => { try { return statSync(p).isDirectory() } catch { return false } })
  }
  const packageDirs = subdirs('packages')
  const targets = []
  for (const group of ['apps', 'pocs', 'packages']) {
    for (const dir of subdirs(group)) {
      const config = join(dir, 'nuxt.config.ts')
      if (!existsSync(config)) continue
      const serverRoots = [...new Set([...packageDirs, dir])]
      targets.push({ config, serverRoots })
    }
  }
  return targets
}
