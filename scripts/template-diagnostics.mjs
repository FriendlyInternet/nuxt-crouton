#!/usr/bin/env node
// template-diagnostics — list Nuxt 4.7 template diagnostics (NUXT_B4025 /
// NUXT_B3014 / NUXT_B3015) raised by .vue files in the app's packages/ layers
// (#4496).
//
// Why a script: in Nuxt 4.7 dev these warnings go ONLY to the in-process
// BroadcastChannel('nuxt:dev:error') (the browser error overlay) — never the
// terminal — and `nuxt build` has no publisher at all. So a `nuxt dev` log
// always shows zero. This boots Nuxt dev in-process, listens on that channel,
// compiles every package-layer .vue through the client Vite server, and prints
// what came back.
//
// Usage: node scripts/template-diagnostics.mjs <appDir>
// Exit 1 if nothing was compiled (it did nothing) or if a matching diagnostic
// comes from a packages/ file.
//
// Note: NUXT_B4025 (link to an unknown route) cannot fire in apps that extend
// crouton-pages — its catch-all page matches every static path.

import { resolve, relative } from 'node:path'
import { readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const appDir = resolve(process.argv[2] || '.')
const repoRoot = resolve(import.meta.dirname, '..')
const CODE_RE = /NUXT_B(4025|3014|3015)/

// Resolve @nuxt/kit from the app, so the app's own Nuxt is the one booted.
const kitPath = createRequire(resolve(appDir, 'package.json')).resolve('@nuxt/kit')
const { loadNuxt, buildNuxt } = await import(pathToFileURL(kitPath).href)

const reports = []
let lastMessageAt = Date.now()
const channel = new BroadcastChannel('nuxt:dev:error')
channel.onmessage = (e) => {
  lastMessageAt = Date.now()
  if (e.data?.type === 'nuxt:dev:error:warning') reports.push(e.data.report ?? e.data)
}

function walk (dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue
    const p = resolve(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}

function waitForQuiet (quietMs = 500, capMs = 10_000) {
  const start = Date.now()
  return new Promise((done) => {
    const tick = () => {
      const now = Date.now()
      if (now - lastMessageAt >= quietMs || now - start >= capMs) return done()
      setTimeout(tick, 100)
    }
    setTimeout(tick, quietMs)
  })
}

function codeOf (r) {
  for (const v of [r.code, r.name, r.message]) {
    const m = String(v ?? '').match(CODE_RE)
    if (m) return m[0]
  }
  return String(r.code ?? r.name ?? '')
}

function filesOf (r) {
  const out = []
  for (const v of [r.file, r.id, r.loc?.file, ...(Array.isArray(r.sources) ? r.sources : [r.sources])]) {
    if (typeof v === 'string') out.push(v)
  }
  for (const f of r.frames ?? []) if (f?.file) out.push(f.file)
  return [...new Set(out)]
}

let vite
const nuxt = await loadNuxt({ cwd: appDir, dev: true, ready: true, overrides: { devtools: { enabled: false } } })
nuxt.hook('vite:serverCreated', (server, ctx) => { if (ctx.isClient) vite = server })
await buildNuxt(nuxt)

let exitCode = 0
try {
  if (!vite) throw new Error('client Vite server was never created')
  const pkgRoot = resolve(repoRoot, 'packages') + '/'
  const layers = [...new Set(nuxt.options._layers.map(l => l.config.rootDir))].filter(d => d.startsWith(pkgRoot))
  let compiled = 0
  const failed = []
  for (const root of layers) {
    let files = []
    try { files = walk(resolve(root, 'app')) } catch { continue }
    for (const f of files) {
      try { await vite.transformRequest('/@fs' + f); compiled++ }
      catch (err) { failed.push({ file: relative(repoRoot, f), error: String(err?.message ?? err).split('\n')[0] }) }
    }
  }
  await waitForQuiet()

  const diagnostics = reports.map(r => ({
    code: codeOf(r),
    message: String(r.message ?? '').slice(0, 300),
    files: filesOf(r).map(f => f.startsWith(repoRoot) ? relative(repoRoot, f) : f)
  }))
  // Nuxt and modules log to stdout too; the marker line makes the summary findable.
  console.log('--- template-diagnostics summary ---')
  console.log(JSON.stringify({
    app: relative(repoRoot, appDir),
    layers: layers.map(d => relative(repoRoot, d)),
    compiled,
    compileFailures: failed,
    diagnostics
  }, null, 2))

  const bad = diagnostics.filter(d => CODE_RE.test(d.code) && d.files.some(f => f.includes('packages/')))
  if (compiled === 0) { console.error('template-diagnostics: compiled 0 files — did nothing'); exitCode = 1 }
  if (bad.length) { console.error(`template-diagnostics: ${bad.length} diagnostic(s) from packages/`); exitCode = 1 }
}
catch (err) {
  console.error('template-diagnostics:', err?.message ?? err)
  exitCode = 1
}
finally {
  channel.close()
  await nuxt.close()
}
process.exit(exitCode)
