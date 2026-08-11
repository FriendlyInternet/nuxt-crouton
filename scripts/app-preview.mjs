#!/usr/bin/env node
/**
 * app-preview — one command to LOOK AT a change (#1777).
 *
 *   pnpm preview kassa
 *
 * Boots the app's dev server, seeds the demo content, mints a disposable review
 * login attached to the seeded `test1` team, and prints the PREFILLED one-click
 * URL. The dev server stays in the foreground — Ctrl-C stops everything.
 *
 * Why this exists: an ordinary `packages/*` PR gets NO deploy preview by design
 * (scripts/deploy-detect.mjs matches only `apps/<app>/**` on a pull_request, unless
 * the PR carries the UI-sign-off marker — #2140), so the only way to see most
 * package changes was four manual steps — boot, seed, create a user, attach it to
 * the seeded team. Sessions skipped them and fell back on a stale fixed account
 * plus hand-written SQL test data.
 *
 * Deliberately reuses the deploy path's pieces rather than re-implementing them:
 * the app's own `db:seed` script (crouton-seed writes `.data/db/sqlite.db`, the
 * file `nuxt dev` reads — #1612), `seed-review-login.mjs` (real HTTP auth, so
 * better-auth hashes the password exactly like a signup) and its `buildLoginUrl`
 * (URL-encoding included). Same `reviewLogin.landing` key from deploy.config.json
 * as CI, so local and preview land on the same surface.
 *
 * Flags:
 *   --no-seed        skip the content seed (faster re-runs on an already-seeded DB)
 *   --no-login       skip minting the review login (just boot + seed)
 *   --email/--password/--landing   override the defaults
 */

import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { buildLoginUrl } from './seed-review-login.mjs'

const APP_DIRS = ['apps', 'pocs']
// Deterministic + obviously disposable. Local-only: this account exists in a
// gitignored sqlite file on one laptop, so a fixed password is not a secret.
const DEFAULT_EMAIL = 'review+local@example.com'
const DEFAULT_PASSWORD = 'ReviewLocal2026'
const SEED_TEAM = 'test1'
const BOOT_TIMEOUT_MS = 180_000
// Nuxt prints its URL before the first route is compiled, so the port can refuse
// a moment longer — the seed + login steps need it answering.
const READY_TIMEOUT_MS = 20_000

function parseArgs(argv) {
  const out = { app: null, seed: true, login: true }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--no-seed') out.seed = false
    else if (a === '--no-login') out.login = false
    else if (a === '--email') out.email = argv[++i]
    else if (a === '--password') out.password = argv[++i]
    else if (a === '--landing') out.landing = argv[++i]
    else if (!a.startsWith('-')) out.app ||= a
  }
  return out
}

const log = msg => console.log(`\x1b[36m[preview]\x1b[0m ${msg}`)
const warn = msg => console.warn(`\x1b[33m[preview] ⚠\x1b[0m ${msg}`)

/** Locate <workspace>/<app> across the app-bearing workspaces. */
export function resolveApp(app, exists = existsSync) {
  for (const ws of APP_DIRS) {
    if (exists(`${ws}/${app}/package.json`)) return { workspace: ws, dir: `${ws}/${app}` }
  }
  return null
}

/** `reviewLogin.landing` from the app's deploy.config.json — the surface worth reviewing. */
export function readLanding(dir, read = p => readFileSync(p, 'utf8')) {
  try {
    return JSON.parse(read(`${dir}/deploy.config.json`)).reviewLogin?.landing || ''
  } catch {
    return ''
  }
}

/**
 * Poll `check` until it returns something truthy or the timeout elapses; resolves
 * to the last value either way, so the caller decides what a timeout means.
 * (One helper for both waits here — waiting for the printed URL, then for the
 * port to actually answer.)
 */
export async function waitFor(check, { timeoutMs, intervalMs, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const deadline = now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value || now() >= deadline) return value
    await sleep(intervalMs)
  }
}

/** First dev-server URL Nuxt prints. The port is per-app (devServer in nuxt.config). */
export function findDevUrl(chunk) {
  return chunk.match(/https?:\/\/localhost:\d+/)?.[0] || null
}

function listApps() {
  return APP_DIRS.flatMap(ws => (existsSync(ws) ? readdirSync(ws) : []).filter(a => existsSync(`${ws}/${a}/package.json`)))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.app) {
    console.error('Usage: pnpm preview <app> [--no-seed] [--no-login]\n')
    console.error(`Apps: ${listApps().join(', ')}`)
    process.exit(2)
  }
  const target = resolveApp(args.app)
  if (!target) {
    console.error(`No such app "${args.app}" — looked in ${APP_DIRS.map(w => `${w}/`).join(', ')}`)
    process.exit(2)
  }

  // ── 1. Boot dev, wait for the URL it prints ──────────────────────────────────
  log(`booting ${target.dir}`)
  const dev = spawn('pnpm', ['--filter', args.app, 'dev'], { stdio: ['inherit', 'pipe', 'inherit'] })
  let devUrl = null
  let booted = false

  const onExit = () => { if (!dev.killed) dev.kill('SIGTERM') }
  process.on('SIGINT', () => { onExit(); process.exit(0) })
  process.on('exit', onExit)

  dev.stdout.on('data', (buf) => {
    const chunk = buf.toString()
    process.stdout.write(chunk) // stay a normal dev server — full log passthrough
    if (!devUrl) devUrl = findDevUrl(chunk)
  })
  dev.on('exit', code => process.exit(code ?? 0))

  await waitFor(() => devUrl, { timeoutMs: BOOT_TIMEOUT_MS, intervalMs: 250 })
  if (!devUrl) {
    warn(`no dev URL after ${BOOT_TIMEOUT_MS / 1000}s — leaving the server running, skipping seed + login.`)
  }
  else {
    // The route handler isn't necessarily ready the instant the URL is printed.
    booted = await waitFor(
      () => fetch(devUrl, { redirect: 'manual' }).then(() => true).catch(() => false),
      { timeoutMs: READY_TIMEOUT_MS, intervalMs: 500 }
    )

    // ── 2. Seed the demo content (crouton-seed → .data/db/sqlite.db) ───────────
    // AFTER boot on purpose: the local seed needs the DB dev creates + migrates on
    // its first run (crouton-cli asserts this and errors otherwise).
    if (args.seed) {
      log('seeding demo content')
      try {
        execFileSync('pnpm', ['--filter', args.app, 'db:seed'], { stdio: 'inherit' })
      } catch {
        warn('db:seed failed (or the app has no db:seed) — continuing; the login below still works.')
      }
    }

    // ── 3. Mint the disposable review login ───────────────────────────────────
    if (args.login) {
      const email = args.email || DEFAULT_EMAIL
      const password = args.password || DEFAULT_PASSWORD
      log(`minting review login ${email}`)
      try {
        execFileSync('node', [
          'scripts/seed-review-login.mjs',
          '--url', devUrl,
          '--email', email,
          '--password', password,
          '--seed-team', SEED_TEAM,
          '--sqlite', `${target.dir}/.data/db/sqlite.db`
        // NODE_NO_WARNINGS: the local attach uses node:sqlite, which prints an
        // ExperimentalWarning that would be the loudest line in this output.
        ], { stdio: 'inherit', env: { ...process.env, NODE_NO_WARNINGS: '1' } })
      } catch {
        warn('review-login seed failed — see the output above.')
      }

      const landing = args.landing ?? readLanding(target.dir)
      const loginUrl = buildLoginUrl({ url: devUrl, email, password, landing })
      console.log(`
  \x1b[32m\x1b[1m  ${target.dir} is up:\x1b[0m ${devUrl}

    \x1b[1mOne-click login\x1b[0m (prefilled, one click on Sign in):
    \x1b[36m${loginUrl}\x1b[0m
  ${landing ? `\n  Lands on: ${landing}` : ''}
    Ctrl-C to stop.
  `)
    }
  }
}

// Import-safe: the helpers above are unit-tested, so booting only happens as a CLI.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) await main()
