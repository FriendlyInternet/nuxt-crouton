#!/usr/bin/env node
// layer: stack
/**
 * ci-detect — what kind of change is this, and which CI jobs does it need? (#2894)
 *
 * The first workflow consumer of the stage model (harness.config.mjs, via harness-stages.mjs).
 * ci.yml's `changes` job calls this once and every other job gates on its outputs instead of
 * running the same 14 jobs for every code change. Node core only — no pnpm install needed.
 *
 * Outputs (appended to $GITHUB_OUTPUT, JSON for lists):
 *   stage         poc | app | package | infra | none   (highest wins: infra > package > app > poc)
 *   apps          JSON list of apps/* that must be re-checked: the changed apps PLUS every app that
 *                 depends (transitively, @fyit/*) on a changed package. infra, or a push to main,
 *                 means all apps.
 *   packages      JSON list of changed packages/*
 *   pocs          JSON list of changed pocs/*
 *   mcp           'true' when packages/crouton-mcp changed (or infra)
 *   workflows     'true' when .github/(workflows|actions) changed
 *   base_is_epic  'true' when the PR base branch starts with epic/
 *
 *   EVENT=pull_request BASE_REF=main FILES="$(git diff --name-only …)" node scripts/ci-detect.mjs
 */
import { readdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { loadStages, stageForPath } from './harness-stages.mjs'
import { deriveWatchPaths, fileMatchesAny } from './deploy-detect.mjs'

// Code paths outside any stage that still change what CI must prove.
const INFRA = [/^scripts\//, /^pnpm-lock\.yaml$/, /^\.github\/workflows\/ci\.yml$/, /^\.github\/actions\/warm-packages\//]

const RANK = { none: 0, poc: 1, app: 2, package: 3, infra: 4 }

const top = (file, root) => file.startsWith(root) ? file.slice(root.length).split('/')[0] : null

const stageOf = (file, model) => {
  if (INFRA.some(re => re.test(file))) return 'infra'
  const { name } = stageForPath(file, model)
  return name && RANK[name] !== undefined ? name : 'none'
}

const topNames = (files, root) => new Set(files.map(f => top(f, root)).filter(Boolean))

function affectedApps({ files, stage, event, apps, readPkg }) {
  if (stage === 'infra' || event === 'push') return apps.map(a => a.name)
  const changed = topNames(files, 'apps/')
  const pkgFiles = files.filter(f => f.startsWith('packages/'))
  const dependsOnChange = (a) => {
    const watch = deriveWatchPaths({ app: a.name, pkg: a.pkg, readPkg: n => readPkg(n.slice('@fyit/'.length)) })
    return pkgFiles.some(f => fileMatchesAny(f, watch))
  }
  return apps.filter(a => changed.has(a.name) || dependsOnChange(a)).map(a => a.name)
}

/**
 * PURE. `apps` = [{ name, pkg }] for every apps/* dir; `readPkg(shortName)` returns a package's
 * package.json (null if unknown) — injected so the dependency walk stays testable.
 */
export function detect({ files = [], event = '', baseRef = '', apps = [], readPkg = () => null, model }) {
  const stage = files.map(f => stageOf(f, model)).reduce((hi, s) => RANK[s] > RANK[hi] ? s : hi, 'none')
  const packages = topNames(files, 'packages/')

  return {
    stage,
    apps: affectedApps({ files, stage, event, apps, readPkg }),
    packages: [...packages].sort(),
    pocs: [...topNames(files, 'pocs/')].sort(),
    mcp: stage === 'infra' || packages.has('crouton-mcp'),
    workflows: files.some(f => /^\.github\/(workflows|actions)\//.test(f)),
    base_is_epic: baseRef.startsWith('epic/')
  }
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return null }
}

function main() {
  return loadStages().then((model) => {
    const apps = existsSync('apps')
      ? readdirSync('apps').filter(n => existsSync(`apps/${n}/package.json`)).map(n => ({ name: n, pkg: readJson(`apps/${n}/package.json`) || {} }))
      : []
    const files = (process.env.FILES || '').split('\n').map(f => f.trim()).filter(Boolean)
    const out = detect({
      files,
      event: process.env.EVENT || '',
      baseRef: process.env.BASE_REF || '',
      apps,
      readPkg: n => readJson(`packages/${n}/package.json`),
      model
    })
    const lines = Object.entries(out).map(([k, v]) => `${k}=${Array.isArray(v) ? JSON.stringify(v) : v}`)
    console.log(lines.join('\n'))
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n')
  })
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
