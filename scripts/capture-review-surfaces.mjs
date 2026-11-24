#!/usr/bin/env node
// capture-review-surfaces.mjs — screenshot the app's DECLARED review surfaces, logged in, so the
// sign-off gate (#2171) can SHOW the owner the changed screen instead of just withholding (#2173).
//
// Runs in the DEPLOY environment on purpose: the pi worker is asked to screenshot its change
// (work-issue-pidev.yml) but runs where it often "could not typecheck the touched app" — it can't
// reliably boot the app, so it can't shoot it. The deploy already boots + logs in + screenshots
// (smoke-deployed.mjs, #293); this reuses that same auth + chromium (via the shared libs below).
//
// A blank/error page is NEVER kept: a decoy screenshot is worse than none — it would turn the
// #2172 *withhold* into a false pass. Every capture is validated (colorsAreFlat / looksLikeErrorPage
// from scripts/lib/capture-validate.mjs) before it counts as evidence.
//
// Surfaces come from the app's deploy.config.json:
//   "reviewSurfaces": [
//     { "name": "data-pane", "path": "/admin/test1/sales/events/x",
//       "do": ["click:[data-review=data-tab]", "wait:800", "click:[aria-label='Filters']"] }
//   ]
// A PR can name its own surface instead (`<!-- review-surface: <app> <path> -->`, #2433); without
// one the page is guessed from the changed files — a package page only on apps that use that
// package (#4201). A PR that changes a screen and names/guesses no page gets NO capture (the check
// goes red); only a PR that changes no screen (or carries `<!-- review-surface-none -->`) falls
// back to a single surface at reviewLogin.landing (or "/"). A named or guessed page must stay on
// its path: a redirect elsewhere (e.g. to login) is rejected (#4201). Sign-in pages (`/auth`, `/auth/…`)
// are opened in a second browser with no session; one that opens as a sign-in pop-up (a form in a
// dialog) over `/` counts as shown (#4235).
//
// Usage:
//   node scripts/capture-review-surfaces.mjs --url <deployedUrl> --pr <N> [--email <e> --password <p>] \
//        [--preview-token <t>] [--manifest apps/<app>/deploy.config.json] [--app <app>] [--team <slug>] [--out screenshots/review-captures] [--desktop]
//   --team: the review team the deploy seeded (preview-meta `team`, #4141); wins over the manifest's reviewTeam.
//   PR_BODY (env, optional): the PR body, read for review-surface markers (#2433); unset or empty → read
//   from the GitHub API by --pr (GH_TOKEN + REPO), and a failed read captures nothing (#3957).
//   CHANGED_FILES (env): newline-separated changed paths; with no declared surface the page to
//   shoot is derived from them (#2698).
//
// Output: screenshots/review-captures/pr<N>-<app>-<name>.png for each surface that captured a NON-blank page.
// Prints `captured=<file>` per kept shot (the workflow publishes them to a non-branch ref + PR comment, #3351). NEVER exits non-zero on a
// capture miss — a missing capture just means no evidence, and the sign-off gate withholds.

import { resolve, basename, dirname } from 'node:path'
import { readFileSync, existsSync, mkdirSync } from 'node:fs'
import { parseArgs } from './lib/cli-args.mjs'
import { signIn, previewSignIn, jarToContextCookies } from './lib/review-login.mjs'
import { launchChromium } from './lib/chromium-launch.mjs'
import { colorsAreFlat, looksLikeErrorPage, looksLikeLoadingScreen, sampleFlatness, landedWhereAsked, LOADING_MARKERS } from './lib/capture-validate.mjs'
import { resolveReviewTeam, DEFAULT_REVIEW_TEAM } from './review-team.mjs'
import { VISUAL_PATH } from './ui-touched.mjs'
import { loadApps } from './deploy-detect.mjs'

// ── pure helpers (unit-tested; no I/O) ───────────────────────────────────────

/** Kebab-slug a surface name so it is a safe, stable filename fragment. */
export function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'surface'
}

/**
 * The committed filename for one surface of one PR. With `app`, the app is part of the name:
 * a packages PR deploys several apps, and without it their captures overwrote each other
 * (#2420: kassa's replaced velo's) (#2433).
 */
export function outName(pr, name, app) {
  const prefix = `pr${String(pr).replace(/\D/g, '')}`
  return app ? `${prefix}-${slug(app)}-${slug(name)}.png` : `${prefix}-${slug(name)}.png`
}

// The marker work-issue-pidev.yml puts on a PR held for visual sign-off (deploy-detect.mjs #2140).
const HOLD_MARKER = '<!-- deploy-preview: full-watch -->'
// The marker a PR carries when its plan says there is no page to look at (#4201).
const NONE_MARKER = '<!-- review-surface-none -->'

/**
 * The reason a PR gives for "no screen to check" (#4252): the text of
 * `<!-- review-surface-none: <reason> -->`, or '' for the bare marker, an empty reason or no marker.
 * Only the form with a reason wins over pages guessed from the changed files.
 */
export function noneReason(prBody) {
  const m = /<!--\s*review-surface-none:\s*(.*?)\s*-->/s.exec(String(prBody || ''))
  return m ? m[1].replace(/\s+/g, ' ').trim() : ''
}

/** True when the PR changes a screen file (VISUAL_PATH), ignoring fixtures/ and e2e/ (#4201). */
export function changesScreen(changedFiles) {
  return (changedFiles || []).some((raw) => {
    const file = String(raw ?? '').trim()
    return Boolean(file) && !/^(?:fixtures|e2e)\//.test(file) && VISUAL_PATH.test(file)
  })
}

/**
 * The `packages/<x>/**` watch paths of `app` as `x` (#4201), or undefined when the app isn't found.
 * Known limit: the watch list comes from the checked-out (main) package.json, so a PR that adds a
 * package dependency drops that package's guessed pages for that app.
 */
export function appPackages(app, workspace, apps = loadApps(workspace)) {
  const entry = (apps || []).find(a => a.app === app)
  if (!entry) return undefined
  return (entry.watchPaths || [])
    .map(p => /^packages\/([^/]+)\/\*\*$/.exec(p)?.[1])
    .filter(Boolean)
}

/** Why a named/guessed surface is not where it was asked to be, or null (#4201). */
export function landingRejection(surface, finalUrl) {
  if (!surface?.checkLanding || landedWhereAsked(surface.path, finalUrl)) return null
  let landed
  try { landed = new URL(finalUrl).pathname } catch { landed = String(finalUrl) }
  return `landed on ${landed} instead of ${surface.path}`
}

/** True for a page under `/auth` (`/auth` or `/auth/…`) — only these get a signed-out second try (#4235, #4248). */
export function isAuthPath(path) {
  let p = String(path ?? '').split(/[?#]/)[0]
  if (!p.startsWith('/')) p = `/${p}`
  return p === '/auth' || p.startsWith('/auth/')
}

function pathOf(url) {
  try { return new URL(url, 'http://x').pathname } catch { return String(url) }
}

/**
 * True when a `/api/auth/get-session` answer shows a signed-in user (#4265): a 2xx status and
 * a body whose `user` is a non-null object. `body` is `undefined` when the answer is not JSON.
 */
export function sessionFromResponse(status, body) {
  return status >= 200 && status < 300 && body?.user != null && typeof body.user === 'object'
}

/** Ask the app whether this browser context has a session (its own cookies). Never throws (#4265). */
async function hasSession(context, origin) {
  try {
    const res = await context.request.get(`${origin}/api/auth/get-session`)
    return sessionFromResponse(res.status(), await res.json().catch(() => undefined))
  } catch {
    return false
  }
}

/**
 * Decide what to do with a surface after its signed-in try, or after both tries (#4248).
 * `tries` is `[{ url, session? }]` (signed in) or `[{ url, session? }, { url, dialogForm }]`;
 * `session` says whether the signed-in browser had a session (#4265), `dialogForm` whether the
 * signed-out try showed a `[role="dialog"] form`. Returns `{ keep: 'signed-in' }`,
 * `{ retry: 'signed-out' }`, `{ keep: 'signed-out', popup? }` or `{ reject: <reason> }`.
 * A sign-in pop-up on `/` counts only for a real sign-in page: one that, signed in with a
 * session, sent the visitor outside `/auth/`. A sign-in form on the signed-in try proves
 * nothing — a slow session check shows it to signed-in visitors too (#4265).
 */
export function authTryDecision(surface, tries) {
  const [first, second] = tries || []
  const off1 = landingRejection(surface, first?.url)
  if (!off1) return { keep: 'signed-in' }
  if (!isAuthPath(surface?.path)) return { reject: off1 }
  if (!second) return { retry: 'signed-out' }
  const off2 = landingRejection(surface, second.url)
  if (!off2) return { keep: 'signed-out' }
  const path1 = pathOf(first.url)
  const popupShape = pathOf(second.url) === '/' && second.dialogForm === true
  if (!popupShape) return { reject: off2 }
  if (isAuthPath(path1)) return { reject: `a sign-in pop-up on / is not ${surface.path} (signed in it landed on ${path1})` }
  if (first.session !== true) return { reject: `the review login did not work (no session on the signed-in try), so a sign-in pop-up on / cannot stand in for ${surface.path}` }
  return { keep: 'signed-out', popup: true }
}

/**
 * Surfaces a PR declares for one app (#2433), copied there from its issue:
 *   <!-- review-surface: <app> <path> [name:<x>] [wait:<ms>] [click:<selector>] -->
 * The worker knows which screen it changed; the app's fixed landing page usually doesn't show it.
 * Every `{team}` in the path becomes the app's review team (#4141).
 */
export function parsePrSurfaces(prBody, app, team = DEFAULT_REVIEW_TEAM) {
  const out = []
  for (const m of String(prBody || '').matchAll(/<!--\s*review-surface:\s*(.+?)\s*-->/g)) {
    const [forApp, path, ...rest] = m[1].split(/\s+/)
    if (forApp !== app || !path) continue
    const nameTok = rest.find(t => t.startsWith('name:'))
    const steps = rest.filter(t => !t.startsWith('name:'))
    const base = nameTok ? nameTok.slice(5) : (path.split('?')[0].split('/').filter(Boolean).pop() || 'surface')
    let name = slug(base)
    while (out.some(s => s.name === name)) name = `${name}-${out.length + 1}`
    const filled = path.replaceAll('{team}', team)
    out.push({ name, path: filled.startsWith('/') ? filled : `/${filled}`, do: steps })
  }
  return out
}

/**
 * Review surfaces derived from the PR's changed files (#2698), used when the PR declares none:
 *  - a page file (`…/app/pages/**.vue`) → its route; a page under `apps/<x>/` or `pocs/<x>/` only for
 *    app `<x>` (#3794), a `packages/<pkg>/` page only for apps whose `packages` list has `<pkg>`
 *    (every app when `packages` is undefined, #4201); with a `[team]`, `[teamSlug]` or `[team-slug]` segment → the app's review team (`team`, default test1, #4141) (never `[slug]`, #3886);
 *    pages with any other dynamic segment are skipped (no data to open them with);
 *    pages under `fixtures/` and `e2e/` are never shot (not deployed, #4084);
 *  - a shared component (`packages/crouton-*\/app/components/**.vue`) → the gallery's
 *    `/__review?file=<path>` page, only for the gallery app (other apps have no such page).
 */
// The route + label a changed page file opens at for `app`, or null when it isn't reviewable there.
function pageSurface(file, pagePath, app, team, packages) {
  if (/^(?:fixtures|e2e)\//.test(file)) return null
  const owner = /^(?:apps|pocs)\/([^/]+)\//.exec(file)
  if (owner && owner[1] !== app) return null
  const pkg = /^packages\/([^/]+)\//.exec(file)
  if (pkg && Array.isArray(packages) && !packages.includes(pkg[1])) return null
  if (pagePath.startsWith('__review')) return null
  const segs = pagePath.split('/').filter(s => s !== 'index')
  const dynamic = segs.filter(s => /^\[.*\]$/.test(s))
  if (dynamic.some(s => !/^\[(team|teamSlug|team-slug)\]$/i.test(s) || dynamic.indexOf(s) > 0)) return null
  const route = '/' + segs.map(s => /^\[.*\]$/.test(s) ? team : s).join('/')
  return { route, label: segs.join('-') || 'index' }
}

export function deriveSurfaces({ changedFiles, app, team = DEFAULT_REVIEW_TEAM, packages }) {
  const out = []
  const add = (path, label) => {
    if (out.some(s => s.path === path)) return
    let name = slug(label)
    while (out.some(s => s.name === name)) name = `${name}-${out.length + 1}`
    out.push({ name, path, do: [] })
  }
  for (const raw of changedFiles || []) {
    const file = String(raw).trim()
    if (!file.endsWith('.vue')) continue
    const page = /(?:^|\/)app\/pages\/(.+)\.vue$/.exec(file)
    if (page) {
      const surface = pageSurface(file, page[1], app, team, packages)
      if (surface) add(surface.route, surface.label)
    } else if (app === 'gallery' && /^packages\/crouton-[^/]+\/app\/components\/.+\.vue$/.test(file)) {
      add(`/__review?file=${encodeURIComponent(file)}`, file.split('/').pop().replace(/\.vue$/, ''))
    }
  }
  return out
}

/**
 * What to capture for one app on one PR (#2433):
 *  - surfaces the PR declares for this app win;
 *  - `<!-- review-surface-none: <reason> -->` comes next (#4252): the start page, named `no-screen-…`;
 *    the marker without a reason does not beat a guessed page;
 *  - a PR held for visual sign-off that declares none gets NOTHING: the landing page would pass
 *    the gate while showing nothing of the change (#2045), so the PR shows evidence as missing;
 *  - a PR that changes a screen and names/guesses no page gets NOTHING either (#4201): the start
 *    page is not proof of the change (unless the PR carries `<!-- review-surface-none -->`);
 *  - any other PR keeps the manifest's surfaces / landing, as before.
 * Declared and derived surfaces are tagged `checkLanding` (the browser must stay on their path);
 * the manifest / start page is not (a logged-in `/` redirects on purpose on crate and kassa).
 */
export function resolveSurfaces({ manifest, prBody, app, changedFiles, team: deployedTeam, packages }) {
  // The team the DEPLOY seeded wins (preview-meta `team`, passed as --team, #4141): the screenshot
  // job checks out main, so its manifest misses a `reviewTeam` the PR adds or changes. The manifest
  // key (no nuxt.config text) is only the fallback for a record written before that field existed.
  const team = (typeof deployedTeam === 'string' && deployedTeam.trim()) || resolveReviewTeam({ manifest }).team
  const declared = parsePrSurfaces(prBody, app, team)
  const tag = list => list.map(s => ({ ...s, checkLanding: true }))
  if (declared.length) return { surfaces: tag(declared), reason: 'declared on the PR' }
  // A reasoned "no screen to check" beats the guesses below (#4252); the picture names say so.
  const why = noneReason(prBody)
  if (why) return { surfaces: parseSurfaces(manifest).map(sf => ({ ...sf, name: `no-screen-${sf.name}` })), reason: `no screen to check: ${why}` }
  const derived = deriveSurfaces({ changedFiles, app, team, packages })
  if (derived.length) return { surfaces: tag(derived), reason: 'derived from the changed files (#2698)' }
  const body = String(prBody || '')
  if (body.includes(HOLD_MARKER)) {
    return { surfaces: [], reason: `held for visual sign-off but declares no review-surface for ${app} — not capturing the start page (#2433)` }
  }
  if (changesScreen(changedFiles) && !body.includes(NONE_MARKER)) {
    return { surfaces: [], reason: 'no screenshot of the changed screen — the PR names no page (add <!-- review-surface: <app> <path> -->)' }
  }
  return { surfaces: parseSurfaces(manifest), reason: 'start page — this PR changes no screen' }
}

/**
 * The PR body to read markers from (#3957). The workflow_run capture has no pull_request event,
 * so PR_BODY is usually unset: read it from the GitHub API by PR number. A failed read THROWS —
 * an empty body would silently drop the declared surface and shoot the app default instead.
 */
export async function readPrBody({ env, pr, fetchFn = fetch }) {
  if (env.PR_BODY) return env.PR_BODY
  const repo = env.REPO || env.GITHUB_REPOSITORY
  const token = env.GH_TOKEN
  const prefix = `cannot read the body of PR #${pr}`
  if (!repo || !token) throw new Error(`${prefix}: no repo/token`)
  let res
  try {
    res = await fetchFn(`https://api.github.com/repos/${repo}/pulls/${pr}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    })
  } catch (e) {
    throw new Error(`${prefix}: ${e.message}`)
  }
  if (!res.ok) throw new Error(`${prefix}: HTTP ${res.status}`)
  return (await res.json()).body ?? ''
}

/** Read the PR body, then resolve what to capture for this app (#3957). */
export async function pickSurfaces({ env, args, manifest, fetchFn = fetch }) {
  const prBody = await readPrBody({ env, pr: args.pr, fetchFn })
  // The workflow passes --manifest $WORKSPACE/$APP/deploy.config.json, so the workspace is its grandparent folder.
  const packages = (args.manifest && args.app)
    ? appPackages(args.app, basename(dirname(dirname(String(args.manifest)))))
    : undefined
  return resolveSurfaces({ manifest, prBody, app: args.app || '', changedFiles: (env.CHANGED_FILES || '').split('\n'), team: args.team, packages })
}

/**
 * Resolve the surfaces to capture from a parsed deploy.config.json. Declared `reviewSurfaces`
 * win; otherwise ONE surface at reviewLogin.landing (or "/"). A surface needs a string `path`;
 * `do` (interaction steps) defaults to []. Names are sluggified + de-duped so two surfaces never
 * fight over the same file.
 */
export function parseSurfaces(manifest) {
  const declared = Array.isArray(manifest?.reviewSurfaces) ? manifest.reviewSurfaces : []
  const seen = new Set()
  const clean = []
  declared.forEach((s, i) => {
    if (!s || typeof s.path !== 'string' || !s.path) return
    let name = slug(s.name || `surface-${i + 1}`)
    while (seen.has(name)) name = `${name}-${i + 1}`
    seen.add(name)
    clean.push({ name, path: s.path, do: Array.isArray(s.do) ? s.do.map(String) : [] })
  })
  if (clean.length) return clean
  const landing = manifest?.reviewLogin?.landing
  return [{ name: 'preview', path: (typeof landing === 'string' && landing) ? landing : '/', do: [] }]
}

/** Parse one interaction step string into a structured action. */
export function parseAction(a) {
  const raw = String(a)
  const i = raw.indexOf(':')
  const verb = (i === -1 ? raw : raw.slice(0, i)).trim()
  const arg = i === -1 ? '' : raw.slice(i + 1)
  if (verb === 'click') return { verb: 'click', selector: arg.trim() }
  if (verb === 'wait') return { verb: 'wait', ms: Math.min(15000, Math.max(0, Number(arg) || 0)) }
  return { verb: 'unknown', raw }
}

// Band height = the phone viewport the capture runs at (one screen).
const BAND = 844
// A band "has content" when ≥0.5% of its pixels differ from the background. A 1-px full-width
// line is 1/844 ≈ 0.12% of a band and a 1-px full-height line 1/780 ≈ 0.13% — both stay blank;
// real pages are far above it (#3841: 14.8% overall), and even a sparse login form at 390 px has
// borders, text and a button well over 0.5% of one screen.
const MIN_CONTENT = 0.005
// …OR when it holds a solid patch: ≥256 pixels that sit in a 2×2 block of differing pixels
// (#3854 review). 256 = a 16×16 patch — smaller than any real control (a 100×30 button has
// ~2,900), so a nearly empty page with one small button isn't called blank, while a 1-px line
// has no 2×2 block at all and contributes 0.
const MIN_SOLID = 256
// Same per-channel tolerance colorsAreFlat uses.
const TOLERANCE = 2

/**
 * True if a raw RGBA/RGB frame is blank — one flat colour (#2526). Scans EVERY pixel in
 * viewport-tall bands (#3854): the old 8×8 grid sat `height/8` apart on a full-page capture
 * (3,160 px on a 25,280 px page), so content between grid rows was never seen.
 * Background = the most common colour on a 16×16 sample grid (not pixel 0, so a 1-px line in the
 * top row can't become the background). The frame is flat only if NO band has content; the
 * denominator is always a full band so a short tail band or a tiny frame isn't over-weighted.
 */
export function isFlatFrame({ data, width, height, channels }) {
  const frame = { data, width, height, channels }
  const bg = dominantColor(frame)
  const threshold = width * Math.min(BAND, height) * MIN_CONTENT
  for (let y0 = 0; y0 < height; y0 += BAND) {
    if (bandHasContent(frame, bg, y0, threshold)) return false
  }
  return true
}

/** True once the band starting at `y0` has ≥threshold differing pixels or ≥MIN_SOLID solid ones. */
function bandHasContent({ data, width, height, channels }, bg, y0, threshold) {
  const y1 = Math.min(height, y0 + BAND)
  let diff = 0
  let solid = 0
  let prev = null
  for (let y = y0; y < y1; y++) {
    const cur = new Uint8Array(width)
    for (let x = 0, idx = y * width * channels; x < width; x++, idx += channels) {
      if (!pixelDiffers(data, idx, bg)) continue
      cur[x] = 1
      diff++
      if (inSolidBlock(cur, prev, x)) solid++
    }
    if (diff >= threshold || solid >= MIN_SOLID) return true
    prev = cur
  }
  return false
}

/** True if the pixel at `idx` differs from the background by more than TOLERANCE on any channel. */
function pixelDiffers(data, idx, bg) {
  return Math.abs(data[idx] - bg[0]) > TOLERANCE || Math.abs(data[idx + 1] - bg[1]) > TOLERANCE || Math.abs(data[idx + 2] - bg[2]) > TOLERANCE
}

/** True if pixel x closes a 2×2 block of differing pixels with its left/up/up-left neighbours. */
function inSolidBlock(cur, prev, x) {
  return Boolean(prev && x > 0 && cur[x - 1] && prev[x - 1] && prev[x])
}

/** The most common RGB colour on a 16×16 sample grid — the frame's background (#3854). */
function dominantColor({ data, width, height, channels }) {
  const counts = new Map()
  let bg = null
  let best = 0
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      const x = Math.floor((i + 0.5) * width / 16)
      const y = Math.floor((j + 0.5) * height / 16)
      const idx = (y * width + x) * channels
      const key = `${data[idx]},${data[idx + 1]},${data[idx + 2]}`
      const n = (counts.get(key) || 0) + 1
      counts.set(key, n)
      if (n > best) { best = n; bg = [data[idx], data[idx + 1], data[idx + 2]] }
    }
  }
  return bg
}

// ── runtime (skipped when imported, e.g. by the test) ────────────────────────
// One shared warm-up deadline (≤5 min, inside the 8-min step timeout): the first surface pays
// for the dev server's first build; later surfaces/widths reuse the warmed server.
// Declared before `await main()` below — a later `let` would be in its TDZ when main runs.
let warmDeadline = 0

const log = m => console.log(`[capture] ${m}`)

/** One machine-readable line per surface (#2572) — the deploy step quotes these on the PR. `reason` runs to end of line. */
export function resultLine(name, status, reason = '') {
  return `surface=${name} status=${status} reason=${String(reason).replace(/\s+/g, ' ').trim()}`
}
const report = (name, status, reason) => console.log(resultLine(name, status, reason))
if (import.meta.url === `file://${process.argv[1]}`) await main()

async function main() {
  const args = parseArgs(process.argv.slice(2), { boolean: ['desktop'] })
  if (!args.url || !args.pr) {
    console.error('Usage: capture-review-surfaces.mjs --url <deployedUrl> --pr <N> [--email <e> --password <p>] [--manifest <p>] [--out <dir>] [--desktop]')
    process.exit(2)
  }
  const origin = String(args.url).replace(/\/$/, '')
  const outDir = args.out || 'screenshots/review-captures'
  const viewport = args.desktop ? { width: 1280, height: 900 } : { width: 390, height: 844 } // phone-first (#722)
  const app = args.app || ''
  let surfaces, reason
  try {
    ({ surfaces, reason } = await pickSurfaces({ env: process.env, args, manifest: loadManifest(args.manifest) }))
  } catch (e) {
    log(`origin=${origin} app=${app || '-'} surfaces=0 (${e.message})`)
    report('-', 'error', e.message)
    return
  }
  log(`origin=${origin} app=${app || '-'} surfaces=${surfaces.length} (${reason}) viewport=${viewport.width}x${viewport.height}`)
  if (!surfaces.length) { report('-', 'none', reason); return }

  const kept = await captureAll({ origin, args, viewport, surfaces, outDir, app })

  // The workflow reads these lines to know what to commit. No captures ⇒ no output ⇒ the
  // sign-off gate withholds (honest), rather than a decoy.
  for (const f of kept) console.log(`captured=${f}`)
  if (!kept.length) log('no valid captures — the sign-off gate will withhold (nothing to show)')
}

/**
 * Open the signed-in context (with cookies when signed in) and warm up once on the first
 * surface. The signed-out context is made lazily, on the first `/auth/` retry (#4248).
 */
async function openContexts({ browser, viewport, origin, surfaces, cookies }) {
  const inContext = await browser.newContext({ viewport, deviceScaleFactor: 2 })
  if (cookies) await inContext.addCookies(cookies)
  if (surfaces.length) await warmUp(inContext, origin, surfaces[0])
  let outContext = null
  const signedOut = async () => (outContext ??= await browser.newContext({ viewport, deviceScaleFactor: 2 }))
  return { inContext, signedOut }
}

/** Sign in, open one browser, capture each surface. Returns the kept files (may be empty). */
async function captureAll({ origin, args, viewport, surfaces, outDir, app }) {
  // A link-only app has no password: it trades a derived preview-only token for a session (#2700).
  const { loggedIn, jar } = args['preview-token']
    ? await previewSignIn(origin, args['preview-token'], log)
    : await signIn(origin, args.email, args.password, log)
  const browser = await launchChromium(log)
  if (!browser) { for (const sf of surfaces) report(sf.name, 'error', 'no chromium browser available'); return [] } // evidence is not a gate — no browser ⇒ the sign-off gate withholds

  mkdirSync(resolve(outDir), { recursive: true })
  const kept = []
  try {
    // Every page is tried signed in first; an `/auth/` page that sends you away gets one
    // signed-out try, since a sign-in page sends a signed-in visitor elsewhere (#4235, #4248).
    const { inContext, signedOut } = await openContexts({ browser, viewport, origin, surfaces, cookies: loggedIn && jar.size ? jarToContextCookies(jar, origin) : null })
    for (const surface of surfaces) {
      const file = await captureWithTries(inContext, signedOut, origin, surface, `${outDir}/${outName(args.pr, surface.name, app)}`)
      if (file) kept.push(file)
    }
  } finally {
    await browser.close().catch(() => {})
  }
  return kept
}

/**
 * Open one surface in `context` and let it settle (navigate → loader wait → hydrate → idle).
 * Returns `{ page, status, url, dialogForm }` (`dialogForm` is read only on the signed-out try,
 * #4265), or null (page closed) after reporting a page stuck
 * on Nuxt's loading screen. May throw; the caller closes `page` on success.
 */
async function openSettled(context, origin, surface) {
  const page = await context.newPage()
  try {
    const url = origin + (surface.path.startsWith('/') ? surface.path : `/${surface.path}`)
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
    // The dev server serves Nuxt's loading template until its first build finishes (#2526):
    // wait for the draw, then reload only while still loading (#4134). The budget is per run.
    const settled = await settlePage(page, { deadline: warmDeadline, status: resp ? resp.status() : 0 })
    if (settled.loading) {
      log(`✗ ${surface.name}: capture timed out on Nuxt's loading screen — discarding`)
      report(surface.name, 'rejected', "stuck on Nuxt's loading screen")
      await page.close().catch(() => {})
      return null
    }
    await waitForHydration(page)
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(1200)
    const dialogForm = await page.locator('[role="dialog"] form').first().isVisible().catch(() => false)
    return { page, status: settled.status, url: page.url(), dialogForm }
  } catch (e) {
    await page.close().catch(() => {})
    throw e
  }
}

/**
 * Drive one surface: signed-in try, maybe one signed-out try (authTryDecision), then
 * interact → screenshot → validate. Returns the kept file, or null when the capture is
 * missing, elsewhere, an error page, or blank. Never throws.
 */
async function captureWithTries(inContext, signedOut, origin, surface, file) {
  const opened = []
  try {
    // Before the interactions: a `click:` step may navigate on purpose (#4201).
    const t1 = await openSettled(inContext, origin, surface)
    if (!t1) return null
    opened.push(t1.page)
    let decision = authTryDecision(surface, [t1])
    let kept = t1
    if (decision.retry) {
      t1.session = await hasSession(inContext, origin)
      await t1.page.close().catch(() => {})
      const t2 = await openSettled(await signedOut(), origin, surface)
      if (!t2) return null
      opened.push(t2.page)
      decision = authTryDecision(surface, [t1, t2])
      kept = t2
    }
    if (decision.reject) {
      log(`✗ ${surface.name}: ${decision.reject} — discarding`)
      report(surface.name, 'rejected', decision.reject)
      return null
    }
    if (decision.popup) log(`✓ ${surface.name}: sign-in page opens as a pop-up on / — keeping`)
    return await finishCapture(kept.page, kept.status, surface, file)
  } catch (e) {
    log(`⚠ ${surface.name}: capture failed (non-fatal): ${e.message.split('\n')[0]}`)
    report(surface.name, 'error', `capture failed: ${e.message.split('\n')[0]}`)
    return null
  } finally {
    for (const p of opened) await p.close().catch(() => {})
  }
}

/** Interact → screenshot → validate a page already where it should be. Never throws. */
async function finishCapture(page, status, surface, file) {
  try {
    await runInteractions(page, surface, log)
    await page.waitForTimeout(600)
    const title = await page.title().catch(() => '')
    const bodyText = await page.evaluate(() => document.body?.textContent?.slice(0, 400) || '').catch(() => '')
    await page.screenshot({ path: resolve(file), fullPage: true })
    const rejection = await captureRejection({ status, text: bodyText, title, file, browser: page.context().browser() })
    if (rejection) {
      log(`✗ ${surface.name}: ${rejection} — discarding`)
      report(surface.name, 'rejected', rejection)
      return null
    }
    log(`✓ ${surface.name} → ${file}`)
    report(surface.name, 'ok', okReason(file, surface))
    return file
  } catch (e) {
    log(`⚠ ${surface.name}: capture failed (non-fatal): ${e.message.split('\n')[0]}`)
    report(surface.name, 'error', `capture failed: ${e.message.split('\n')[0]}`)
    return null
  }
}

/** Why a screenshot is NOT evidence (loader, error page, blank frame), or null when it is. Fails closed: an undecodable frame is rejected (#2526). */
async function captureRejection({ status, text, title, file, browser }) {
  if (looksLikeLoadingScreen({ text, title })) return "stuck on Nuxt's loading screen"
  if (looksLikeErrorPage({ status, text, title })) return `error page (status ${status}, title "${title}")`
  const flat = await frameIsFlat(file, browser)
  if (flat === true) return 'blank/flat capture'
  return flat === false ? null : 'could not verify the frame is not blank'
}

// A function declaration, not a const: main() runs at module top level before the
// declarations below it, so a const here threw "Cannot access 'okReason' before
// initialization" and turned every successful capture into an error (PR #2601).
function okReason(file, surface) {
  return file.split('/').pop() + (surface.clickFailed ? ` (click selector not found: ${surface.clickFailed} — captured as-is)` : '')
}

/** True while the page is Nuxt's dev loading template or no app content is visible yet. */
async function isLoading(page) {
  const html = await page.content().catch(() => '')
  const textLen = await page.evaluate(() => (document.body?.innerText || '').trim().length).catch(() => 0)
  return looksLikeLoadingScreen({ html }) || textLen <= 50
}

/** Wait (≤30s) until Nuxt has hydrated and the route rendered content, not just the SSR shell (#2699, #4134). Returns early on Nuxt's loader. Best-effort: a miss falls through to the rejection checks. */
export async function waitForHydration(page, { timeout = 30000 } = {}) {
  // Gives up early on Nuxt's loader markers (the same list looksLikeLoadingScreen uses) so a
  // real loader is reloaded after ~3s as before (#2526), not after the 30s bound (#4134).
  // An imported binding is initialised before main() runs, so there is no TDZ issue.
  await page.waitForFunction((markers) => {
    const html = (document.documentElement?.outerHTML || '').toLowerCase()
    if (markers.some(m => html.includes(m))) return true
    const root = document.querySelector('#__nuxt')
    if (!root || (root.innerText || '').trim().length <= 50) return false
    const nuxt = window.useNuxtApp?.()
    return nuxt ? !nuxt.isHydrating : true
  }, LOADING_MARKERS, { timeout }).catch(() => {})
}

/**
 * Navigate result → settled page. Waits for the draw FIRST, then reloads only a page still
 * loading after that wait (#4134 — a short SSR shell drawn client-side was reloaded forever;
 * keeps the #2526 cold-start reload). Injectable so it is testable without a browser.
 */
export async function settlePage(page, { deadline, now = Date.now, sleep = ms => page.waitForTimeout(ms),
  waitDrawn = waitForHydration, loading = isLoading, status = 0 } = {}) {
  let reloads = 0
  await waitDrawn(page)
  while (await loading(page) && now() < deadline) {
    await sleep(3000)
    const again = await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => null)
    reloads++
    if (again) status = again.status()
    await waitDrawn(page)
  }
  return { loading: await loading(page), status, reloads }
}

/** Request the first surface until the server answers with the app, not the loader. */
async function warmUp(context, origin, surface) {
  warmDeadline = Date.now() + 300_000
  const page = await context.newPage()
  try {
    await page.goto(origin + (surface.path.startsWith('/') ? surface.path : `/${surface.path}`), { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {})
    await settlePage(page, { deadline: warmDeadline })
  } finally {
    await page.close().catch(() => {})
  }
}

/** Run a surface's `do` steps (click a selector to open a behind-a-tap screen, or wait). */
async function runInteractions(page, surface, logFn) {
  for (const step of surface.do.map(parseAction)) {
    if (step.verb === 'click') {
      try {
        await page.click(step.selector, { timeout: 6000 })
      } catch (e) {
        logFn(`⚠ ${surface.name}: click '${step.selector}' failed (${e.message.split('\n')[0]}) — capturing as-is`)
        surface.clickFailed = step.selector
      }
    } else if (step.verb === 'wait') {
      await page.waitForTimeout(step.ms)
    }
  }
}

function loadManifest(path) {
  if (!path || !existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}

/** true = flat/blank, false = real content, null = could not decode (treated as NOT evidence). */
async function frameIsFlat(file, browser) {
  const raw = await loadPng(file)
  if (raw) return isFlatFrame(raw)
  try {
    return colorsAreFlat(await sampleFlatness(readFileSync(resolve(file)), browser))
  } catch { return null }
}

async function loadPng(file) {
  try {
    const { default: sharp } = await import('sharp')
    const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return { data, width: info.width, height: info.height, channels: info.channels }
  } catch { return null }
}
