/**
 * The rule (#3813): changing the month (swipe, or the « » buttons) does not move
 * the page, and no frame shows the wrong month.
 *
 * Runs against DEPLOYED apps on a phone profile (see ./playwright.config.ts):
 *  - crouton-builder: a page made from a committed copy of staging /site/page-5's
 *    layout (calendar under other blocks, the window scrolls), created through the
 *    API in beforeAll and deleted in afterAll.
 *  - booking-demo `/admin/test1/blocks`: the calendar sits in an inner scroll pane.
 *
 * Without the fix this fails in WebKit (the page jumps up, e.g. 220 → 0). Each test
 * prints one `CALSCROLL …` line the workflow collects into the PR body.
 *
 * Env: CAL_SCROLL_TARGET=staging|pr, PR_NUMBER (pr), BUILDER_URL / BOOKING_DEMO_URL
 * (default: each app's stagingUrl), REVIEW_SEED_SECRET. Missing inputs FAIL, never skip.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const TARGET = process.env.CAL_SCROLL_TARGET === 'pr' ? 'pr' : 'staging'
const ENGINE = process.env.CAL_SCROLL_ENGINE === 'chromium' ? 'chromium' : 'webkit'
const KEY = TARGET === 'pr' ? `pr${process.env.PR_NUMBER || ''}` : 'main'
const SECRET = process.env.REVIEW_SEED_SECRET || ''
// The seeded team on staging + previews; overridable for a local run.
const BD_TEAM = process.env.BOOKING_DEMO_TEAM || 'test1'

function stagingUrl(app: string) {
  for (const dir of ['apps', 'pocs']) {
    try {
      const url = JSON.parse(readFileSync(join(ROOT, dir, app, 'deploy.config.json'), 'utf8')).stagingUrl
      if (url) return String(url).replace(/\/+$/, '')
    }
    catch { /* next workspace */ }
  }
  return ''
}

function baseUrl(app: 'crouton-builder' | 'booking-demo') {
  const env = app === 'crouton-builder' ? process.env.BUILDER_URL : process.env.BOOKING_DEMO_URL
  if (env) return env.replace(/\/+$/, '')
  return TARGET === 'staging' ? stagingUrl(app) : ''
}

/** Same derivation as scripts/staging-get.mjs reviewAccount() / preview-screenshot.yml. */
function reviewAccount(app: string) {
  return {
    email: `review+${app}-${KEY}@example.com`,
    password: createHash('sha256').update(`${SECRET}:${app}:${KEY}`).digest('hex').slice(0, 24),
  }
}

/** Sign in through the API (password never logged) and hand the session to the browser context. */
async function login(context: BrowserContext, app: string, origin: string) {
  expect(SECRET, 'REVIEW_SEED_SECRET is required').not.toBe('')
  if (TARGET === 'pr') expect(process.env.PR_NUMBER, 'PR_NUMBER is required for a pr target').toBeTruthy()
  const { email, password } = reviewAccount(app)
  const res = await context.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin, 'content-type': 'application/json' },
    data: { email, password },
  })
  expect(res.ok(), `${app} review sign-in → HTTP ${res.status()}`).toBe(true)
}

async function activeTeam(context: BrowserContext, origin: string) {
  const sess = await (await context.request.get(`${origin}/api/auth/get-session`)).json().catch(() => null)
  let team = sess?.session?.activeOrganizationId as string | undefined
  if (!team) {
    const orgs = await (await context.request.get(`${origin}/api/auth/organization/list`)).json().catch(() => [])
    team = Array.isArray(orgs) ? orgs[0]?.id : undefined
    if (team) {
      await context.request.post(`${origin}/api/auth/organization/set-active`, {
        headers: { origin, 'content-type': 'application/json' },
        data: { organizationId: team },
      })
    }
  }
  expect(team, 'review login has a team').toBeTruthy()
  return team as string
}

type Measure = { top: number, max: number, scroller: string, gridTop: number, gridH: number, btnTop: number }

/** Install the frame recorder on the visible month calendar and report its scroller. */
async function install(page: Page): Promise<Measure> {
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.overflow-hidden.touch-pan-y')]
    .some(e => e.getBoundingClientRect().width > 100 && e.querySelector('[data-value]')), null, { timeout: 45_000 })
  // Let the panes settle: wait (max 10 s) until some ancestor of the calendar (or the
  // window) can scroll ≥100px; the max-scroll assertion below reports it if not.
  await page.waitForFunction(() => {
    const swipe = [...document.querySelectorAll<HTMLElement>('.overflow-hidden.touch-pan-y')]
      .find(e => e.getBoundingClientRect().width > 100)
    for (let el = swipe?.parentElement; el && el !== document.body; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight - el.clientHeight >= 100) return true
    }
    const d = document.scrollingElement!
    return d.scrollHeight - d.clientHeight >= 100
  }, null, { timeout: 10_000 }).catch(() => {})
  await page.waitForTimeout(500)
  return page.evaluate(() => {
    const w = window as any
    const swipe = [...document.querySelectorAll<HTMLElement>('.overflow-hidden.touch-pan-y')]
      .find(e => e.getBoundingClientRect().width > 100 && e.querySelector('[data-value]'))!
    const track = swipe.firstElementChild as HTMLElement
    let scroller: HTMLElement | null = swipe.parentElement
    while (scroller && scroller !== document.body) {
      const oy = getComputedStyle(scroller).overflowY
      if ((oy === 'auto' || oy === 'scroll') && scroller.scrollHeight - scroller.clientHeight >= 100) break
      scroller = scroller.parentElement
    }
    const isWindow = !scroller || scroller === document.body
    const sc = (isWindow ? document.scrollingElement : scroller) as HTMLElement
    const month = () => {
      const r = swipe.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const panel = [...track.children].find((p) => {
        const b = p.getBoundingClientRect()
        return b.left <= cx && b.right > cx
      })
      return panel?.querySelector('[data-value]:not([data-outside-view])')?.getAttribute('data-value')?.slice(0, 7) ?? '?'
    }
    const buttons = swipe.parentElement!.firstElementChild!.querySelectorAll<HTMLElement>('button')
    const scTop = isWindow ? 0 : sc.getBoundingClientRect().top
    const rec = { frames: [] as Array<{ t: number, m: string }>, snapAt: -1, sawSlide: false, month, sc, buttons, swipe }
    w.__cal = rec
    new MutationObserver(() => {
      const s = track.style
      if (s.transition && s.transition !== 'none') rec.sawSlide = true
      else if (rec.sawSlide && rec.snapAt < 0 && s.transform.includes('+ 0px')) rec.snapAt = performance.now()
    }).observe(track, { attributes: true, attributeFilter: ['style'] })
    const loop = () => { rec.frames.push({ t: performance.now(), m: month() }); requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
    return {
      top: sc.scrollTop,
      max: sc.scrollHeight - sc.clientHeight,
      scroller: isWindow ? 'window' : `${sc.tagName}.${[...sc.classList].slice(0, 3).join('.')}`,
      gridTop: swipe.getBoundingClientRect().top - scTop + sc.scrollTop,
      gridH: swipe.getBoundingClientRect().height,
      btnTop: buttons[2]!.getBoundingClientRect().top - scTop + sc.scrollTop,
    }
  })
}

const scrollTo = (page: Page, y: number) => page.evaluate(async (y) => {
  const rec = (window as any).__cal
  rec.sc.scrollTop = y
  await new Promise(r => setTimeout(r, 300))
  return rec.sc.scrollTop as number
}, y)

/** Finger swipe left (→ next month): plain Events with touch lists, as WebKit has no Touch constructor. */
const swipeLeft = (page: Page) => page.evaluate(async () => {
  const el = (window as any).__cal.swipe as HTMLElement
  const r = el.getBoundingClientRect()
  const y = r.top + r.height / 2
  const fire = (type: string, x: number) => {
    const t = { identifier: 1, target: el, clientX: x, clientY: y, pageX: x + scrollX, pageY: y + scrollY, screenX: x, screenY: y }
    const list = type === 'touchend' ? [] : [t]
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'touches', { value: list })
    Object.defineProperty(ev, 'targetTouches', { value: list })
    Object.defineProperty(ev, 'changedTouches', { value: [t] })
    el.dispatchEvent(ev)
  }
  let x = r.left + r.width * 0.8
  fire('touchstart', x)
  for (let i = 0; i < 10; i++) {
    x -= r.width * 0.06
    await new Promise(res => setTimeout(res, 16))
    fire('touchmove', x)
  }
  fire('touchend', x)
})

/** Real touch tap at the button's centre — never locator.click(), which scrolls it into view. */
async function tapButton(page: Page, index: 0 | 2) {
  const c = await page.evaluate((i) => {
    const b = (window as any).__cal.buttons[i] as HTMLElement
    const r = b.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const hit = document.elementFromPoint(x, y)
    return { x, y, onButton: !!hit && b.contains(hit) }
  }, index)
  expect(c.onButton, 'the month button is on screen and not covered').toBe(true)
  await page.touchscreen.tap(c.x, c.y)
}

const shift = (ym: string, by: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y!, m! - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type Action = 'swipe' | 'next' | 'prev'

async function runCase(page: Page, app: string, action: Action) {
  const m = await install(page)
  expect(m.max, `${app}: the page must scroll ≥100px to show the bug (scroller ${m.scroller}, max ${m.max})`).toBeGreaterThanOrEqual(100)
  // Scroll as far as possible while the grid's centre (where the finger goes) stays
  // on screen: the jump only shows when the page is scrolled well past the header.
  const swipeAt = Math.max(0, Math.min(m.max, Math.round(m.gridTop + m.gridH / 2 - 40)))
  const want = action === 'swipe' ? swipeAt : Math.max(0, Math.min(swipeAt, Math.round(m.btnTop - 10)))
  const before = await scrollTo(page, want)
  const from = await page.evaluate(() => (window as any).__cal.month() as string)

  if (action === 'swipe') await swipeLeft(page)
  else await tapButton(page, action === 'next' ? 2 : 0)
  await page.waitForTimeout(1500)

  const out = await page.evaluate(() => {
    const rec = (window as any).__cal
    return { after: rec.sc.scrollTop as number, to: rec.month() as string, snapAt: rec.snapAt as number, frames: rec.frames as Array<{ t: number, m: string }> }
  })
  const expected = shift(from, action === 'prev' ? -1 : 1)
  const wrongFrames = out.snapAt < 0 ? -1 : out.frames.filter(f => f.t > out.snapAt && f.m !== expected).length
  const moved = Math.abs(out.after - before)
  const pass = out.to === expected && moved <= 2 && wrongFrames === 0
  console.log(`CALSCROLL target=${TARGET} engine=${ENGINE} app=${app} case=${action} scroller=${m.scroller} before=${before} after=${out.after} month=${from}→${out.to} wrongFrames=${wrongFrames} result=${pass ? 'pass' : 'fail'}`)

  expect(out.to, 'the month changed by exactly one (else the action did not run)').toBe(expected)
  expect(moved, `the page scroll did not move (before ${before}, after ${out.after})`).toBeLessThanOrEqual(2)
  expect(wrongFrames, 'no frame after the snap-back shows another month (-1 = no snap-back seen)').toBe(0)
}

test.describe('builder served page: month change keeps the page scroll (#3813)', () => {
  const origin = baseUrl('crouton-builder')
  let slug = ''
  let pageId = ''
  let team = ''

  test.beforeAll(async ({ browser }) => {
    expect(origin, 'BUILDER_URL (or the staging url)').toBeTruthy()
    const context = await browser.newContext()
    await login(context, 'crouton-builder', origin)
    team = await activeTeam(context, origin)
    const layout = JSON.stringify(JSON.parse(readFileSync(join(__dirname, 'builder-calendar-page.layout.json'), 'utf8')), null, 2)
    slug = `e2e-3813-${Date.now()}`
    const res = await context.request.post(`${origin}/api/teams/${encodeURIComponent(team)}/builder-pages`, {
      headers: { origin, 'content-type': 'application/json' },
      data: { title: 'e2e 3813', slug, status: 'published', showInNavigation: false, board: { live: 'a', variants: [{ id: 'a', name: 'A', layout }], layout } },
    })
    expect(res.ok(), `create builder page → HTTP ${res.status()}`).toBe(true)
    const body = await res.json()
    pageId = (Array.isArray(body) ? body[0]?.id : body?.id) || ''
    expect(pageId, 'created page has an id').not.toBe('')
    await context.close()
  })

  test.afterAll(async ({ browser }) => {
    if (!pageId) return // never DELETE with an empty id
    const context = await browser.newContext()
    await login(context, 'crouton-builder', origin)
    const res = await context.request.delete(`${origin}/api/teams/${encodeURIComponent(team)}/builder-pages/${pageId}`, { headers: { origin } })
    console.log(`CALSCROLL cleanup builder page → HTTP ${res.status()}`)
    await context.close()
  })

  for (const action of ['swipe', 'next', 'prev'] as const) {
    test(`builder ${action}`, async ({ page, context }) => {
      await login(context, 'crouton-builder', origin)
      await page.goto(`${origin}/site/${slug}`)
      await runCase(page, 'crouton-builder', action)
    })
  }
})

test.describe('booking-demo blocks: month change keeps the page scroll (#3813)', () => {
  const origin = baseUrl('booking-demo')

  test('booking-demo swipe', async ({ page, context }) => {
    expect(origin, 'BOOKING_DEMO_URL (or the staging url)').toBeTruthy()
    await login(context, 'booking-demo', origin)
    await page.goto(`${origin}/admin/${BD_TEAM}/blocks`)
    await runCase(page, 'booking-demo', 'swipe')
  })

  // Keeps-working check only: here » is tappable just near the pane's top (the header
  // covers it lower down), and the jump only reaches scroll above ~65 — so this case
  // cannot go red on main (measured in the #3813 plan). It is not counted as proof.
  test('booking-demo next (keeps working; cannot go red on main)', async ({ page, context }) => {
    expect(origin, 'BOOKING_DEMO_URL (or the staging url)').toBeTruthy()
    await login(context, 'booking-demo', origin)
    await page.goto(`${origin}/admin/${BD_TEAM}/blocks`)
    await runCase(page, 'booking-demo', 'next')
  })
})
