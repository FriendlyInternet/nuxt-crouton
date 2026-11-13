/**
 * DIAGNOSTIC (#3813) — why does swiping the calendar to another month make the page
 * jump up on an iPhone (WebKit)? This file changes nothing and fixes nothing: it
 * swipes one month left on staging and records, every animation frame from 100 ms
 * before the swipe until 1000 ms after the touchend, the scroll position, the page /
 * scroller / calendar heights, the focused element, and whether the calendar and its
 * ancestors are still the same DOM nodes. Between frames it logs scroll events, DOM
 * mutations on the calendar's pane, and calls to scrollIntoView / focus / scrollTo /
 * scrollBy / the scrollTop setter (logging-only wrappers: each calls the original).
 *
 * The jump itself is DATA, never a failure. A test fails only when the run did
 * nothing (month did not move by one, <20 frames, or <100 px of scroll room), so a
 * no-op can never read as "no jump".
 *
 * Output: `DIAG3813 …` lines on stdout (the job log) and
 * test-results/calendar-diag/<app>-run<N>.json.
 *
 * Env: REVIEW_SEED_SECRET (required), CAL_DIAG_ENGINE=webkit|chromium,
 * BUILDER_URL / BOOKING_DEMO_URL (default: each app's stagingUrl), BOOKING_DEMO_TEAM.
 */
import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const ENGINE = process.env.CAL_DIAG_ENGINE === 'chromium' ? 'chromium' : 'webkit'
const KEY = 'main'
const SECRET = process.env.REVIEW_SEED_SECRET || ''
const BD_TEAM = process.env.BOOKING_DEMO_TEAM || 'test1'
const OUT_DIR = join(ROOT, 'test-results', 'calendar-diag')

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
  return (env || stagingUrl(app)).replace(/\/+$/, '')
}

/** Same derivation as scripts/staging-get.mjs reviewAccount(). */
function reviewAccount(app: string) {
  return {
    email: `review+${app}-${KEY}@example.com`,
    password: createHash('sha256').update(`${SECRET}:${app}:${KEY}`).digest('hex').slice(0, 24),
  }
}

/** Sign in through the API (password never logged) and hand the session to the browser context. */
async function login(context: BrowserContext, app: string, origin: string) {
  expect(SECRET, 'REVIEW_SEED_SECRET is required').not.toBe('')
  const { email, password } = reviewAccount(app)
  const res = await context.request.post(`${origin}/api/auth/sign-in/email`, {
    headers: { origin, 'content-type': 'application/json' },
    data: { email, password },
  })
  expect(res.ok(), `${app} review sign-in → HTTP ${res.status()}`).toBe(true)
}

type Measure = { top: number, max: number, scroller: string, gridTop: number, gridH: number }

/** Find the visible month calendar and its scroller (same finder as #3869). */
async function install(page: Page): Promise<Measure> {
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLElement>('.overflow-hidden.touch-pan-y')]
    .some(e => e.getBoundingClientRect().width > 100 && e.querySelector('[data-value]')), null, { timeout: 45_000 })
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
    const scTop = isWindow ? 0 : sc.getBoundingClientRect().top
    w.__diag = { swipe, track, sc, isWindow, month }
    return {
      top: sc.scrollTop,
      max: sc.scrollHeight - sc.clientHeight,
      scroller: isWindow ? 'window' : `${sc.tagName}.${[...sc.classList].slice(0, 3).join('.')}`,
      gridTop: swipe.getBoundingClientRect().top - scTop + sc.scrollTop,
      gridH: swipe.getBoundingClientRect().height,
    }
  })
}

/** The test's own scroll write — happens BEFORE the logging wrappers are installed. */
const scrollTo = (page: Page, y: number) => page.evaluate(async (y) => {
  const d = (window as any).__diag
  d.sc.scrollTop = y
  await new Promise(r => setTimeout(r, 300))
  return d.sc.scrollTop as number
}, y)

/** Mark the calendar + every ancestor, then start the frame loop, observers and wrappers. */
const arm = (page: Page, mark: string) => page.evaluate((mark) => {
  const d = (window as any).__diag
  const swipe = d.swipe as HTMLElement
  const track = d.track as HTMLElement
  const sc = d.sc as HTMLElement
  const now = () => performance.now()
  const stack = () => (new Error().stack || '').split('\n').map(s => s.trim()).filter(s => s && s !== 'Error').slice(2, 5).join(' | ')
  const desc = (el: Element | null) => {
    if (!el) return 'null'
    const h = el as HTMLElement
    let s = el.tagName
    if (h.id) s += `#${h.id}`
    const tid = el.getAttribute('data-testid')
    if (tid) s += `[data-testid=${tid}]`
    const al = el.getAttribute('aria-label')
    if (al) s += `[aria-label=${al.slice(0, 30)}]`
    return s
  }
  const cls = (el: Element) => `${el.tagName}.${[...el.classList].slice(0, 3).join('.')}`

  const marked: Element[] = []
  for (let el: Element | null = swipe; el; el = el.parentElement) {
    el.setAttribute('data-diag-mark', mark)
    marked.push(el)
  }
  const pane = (swipe.closest('[data-crouton-pane]') || swipe.closest('.croutonpane') || swipe.parentElement || swipe) as HTMLElement

  const events: Array<{ ts: number, kind: string, detail: string }> = []
  const log = (kind: string, detail: string) => events.push({ ts: now(), kind, detail })

  window.addEventListener('scroll', (e) => {
    const t = e.target as any
    const who = t === document || t === window ? 'document' : desc(t as Element)
    const y = t === document || t === window ? (document.scrollingElement?.scrollTop ?? 0) : (t as HTMLElement).scrollTop
    log('scroll', `${who} y=${Math.round(y)}`)
  }, { capture: true })
  if (!d.isWindow) sc.addEventListener('scroll', () => log('scroll', `scroller y=${Math.round(sc.scrollTop)}`), { capture: true })

  new MutationObserver((recs) => {
    let added = 0
    let removed = 0
    const tags = new Set<string>()
    for (const r of recs) {
      added += r.addedNodes.length
      removed += r.removedNodes.length
      r.addedNodes.forEach(n => n.nodeType === 1 && tags.add(`+${(n as Element).tagName}`))
      r.removedNodes.forEach(n => n.nodeType === 1 && tags.add(`-${(n as Element).tagName}`))
    }
    log('mutation', `records=${recs.length} added=${added} removed=${removed} tags=${[...tags].slice(0, 8).join(',')}`)
  }).observe(pane, { childList: true, subtree: true })
  if (pane !== document.body) {
    new MutationObserver(recs => log('mutation-body', `records=${recs.length}`)).observe(document.body, { childList: true })
  }

  // Logging-only wrappers: each calls the original unchanged.
  const wrap = (obj: any, name: string, label: string) => {
    const orig = obj[name]
    if (typeof orig !== 'function') return
    obj[name] = function (this: any, ...args: any[]) {
      log('call', `${label}(${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(',').slice(0, 60)}) on ${this === window ? 'window' : desc(this)} @ ${stack()}`)
      return orig.apply(this, args)
    }
  }
  wrap(Element.prototype, 'scrollIntoView', 'scrollIntoView')
  wrap(HTMLElement.prototype, 'focus', 'focus')
  wrap(window, 'scrollTo', 'window.scrollTo')
  wrap(window, 'scrollBy', 'window.scrollBy')
  wrap(window, 'scroll', 'window.scroll')
  wrap(Element.prototype, 'scrollTo', 'Element.scrollTo')
  wrap(Element.prototype, 'scrollBy', 'Element.scrollBy')
  const st = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')
  if (st?.set && st.get) {
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      enumerable: st.enumerable,
      get() { return st.get!.call(this) },
      set(v: number) {
        log('call', `scrollTop=${v} on ${desc(this as Element)} @ ${stack()}`)
        st.set!.call(this, v)
      },
    })
  }
  document.addEventListener('focusin', e => log('focusin', desc(e.target as Element)), { capture: true })

  const frames: any[] = []
  const rec = { frames, events, touchendAt: -1, stopAt: Number.POSITIVE_INFINITY }
  d.rec = rec
  const winY = () => window.scrollY
  const loop = () => {
    const ts = now()
    let lost = ''
    let ok = 0
    for (const el of marked) {
      if (el.isConnected && el.getAttribute('data-diag-mark') === mark) ok++
      else if (!lost) lost = cls(el)
    }
    frames.push({
      ts,
      winY: Math.round(winY() * 10) / 10,
      scY: Math.round((d.isWindow ? document.scrollingElement!.scrollTop : sc.scrollTop) * 10) / 10,
      vvTop: Math.round((window.visualViewport?.pageTop ?? -1) * 10) / 10,
      pageH: document.scrollingElement!.scrollHeight,
      scH: sc.scrollHeight,
      calH: Math.round(swipe.getBoundingClientRect().height * 10) / 10,
      trackH: Math.round(track.getBoundingClientRect().height * 10) / 10,
      active: desc(document.activeElement),
      marks: `${ok}/${marked.length}${lost ? ` lost=${lost}` : ''}`,
      month: d.month(),
    })
    if (ts < rec.stopAt) requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  return marked.length
}, mark)

/** Finger swipe left (→ next month): plain Events with touch lists, as WebKit has no Touch constructor. */
const swipeLeft = (page: Page) => page.evaluate(async () => {
  const d = (window as any).__diag
  const el = d.swipe as HTMLElement
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
  d.rec.touchendAt = performance.now()
  d.rec.stopAt = d.rec.touchendAt + 1000
  fire('touchend', x)
})

const shift = (ym: string, by: number) => {
  const [y, m] = ym.split('-').map(Number)
  const dt = new Date(y!, m! - 1 + by, 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

const FIELDS = ['winY', 'scY', 'vvTop', 'pageH', 'scH', 'calH', 'trackH', 'active', 'marks', 'month'] as const

async function runDiag(page: Page, app: string, run: number) {
  const m = await install(page)
  expect(m.max, `${app}: the scroller must scroll ≥100px (scroller ${m.scroller}, max ${m.max})`).toBeGreaterThanOrEqual(100)
  const want = Math.max(0, Math.min(m.max, Math.round(m.gridTop + m.gridH / 2 - 40)))
  const before = await scrollTo(page, want)
  const from = await page.evaluate(() => (window as any).__diag.month() as string)

  await arm(page, String(run))
  await page.waitForTimeout(100)
  await swipeLeft(page)
  await page.waitForTimeout(1300)

  const out = await page.evaluate(() => {
    const d = (window as any).__diag
    return {
      after: d.sc.scrollTop as number,
      to: d.month() as string,
      touchendAt: d.rec.touchendAt as number,
      frames: d.rec.frames as any[],
      events: d.rec.events as Array<{ ts: number, kind: string, detail: string }>,
    }
  })
  const t0 = out.touchendAt
  const rel = (ts: number) => Math.round(ts - t0)
  const frames = out.frames.map(f => ({ t: rel(f.ts), ...f }))
  const events = out.events.map(e => ({ t: rel(e.ts), ...e }))
  const drop = out.after < before - 2
  const tag = `app=${app} run=${run} engine=${ENGINE}`
  console.log(`DIAG3813 ${tag} scroller=${m.scroller} before=${before} after=${out.after} month=${from}→${out.to} frames=${frames.length} events=${events.length} drop=${drop ? 'yes' : 'no'}`)

  // The first frame where the scroll falls by more than 2px vs the frame before it.
  const di = frames.findIndex((f, i) => i > 0 && f.scY < frames[i - 1].scY - 2)
  let dropInfo: any = null
  if (di > 0) {
    const a = frames[di - 1]
    const b = frames[di]
    const between = events.filter(e => e.ts > a.ts && e.ts <= b.ts)
    const same = FIELDS.map(k => `${k} ${a[k]}→${b[k]}${a[k] !== b[k] ? '*' : ''}`).join(' · ')
    console.log(`DIAG3813 DROP ${tag} t=${b.t} scroll ${a.scY}→${b.scY}`)
    console.log(`DIAG3813 SAMEFRAME ${tag} t=${a.t}→${b.t} ${same}`)
    for (const e of between) console.log(`DIAG3813 BETWEEN ${tag} t=${e.t} ${e.kind} ${e.detail}`)
    if (!between.length) console.log(`DIAG3813 BETWEEN ${tag} (no events logged between the two frames)`)
    dropInfo = { index: di, from: a, to: b, between }
  }
  else if (drop) {
    console.log(`DIAG3813 DROP ${tag} t=? scroll ${before}→${out.after} (no single-frame drop >2px in the table)`)
  }
  for (const f of frames) {
    console.log(`DIAG3813 FRAME ${tag} t=${f.t} ${FIELDS.map(k => `${k}=${f[k]}`).join(' ')}`)
  }
  for (const e of events) console.log(`DIAG3813 EVENT ${tag} t=${e.t} ${e.kind} ${e.detail}`)

  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(join(OUT_DIR, `${app}-run${run}.json`), JSON.stringify({
    app, run, engine: ENGINE, scroller: m.scroller, max: m.max, before, after: out.after,
    from, to: out.to, drop, dropInfo, frames, events,
  }, null, 2))

  // No-op guards only — the jump itself is data, never a failure.
  expect(out.to, 'the month changed by exactly one (else the swipe did not run)').toBe(shift(from, 1))
  expect(frames.length, 'at least 20 frames were recorded').toBeGreaterThanOrEqual(20)
}

test.describe('builder /site/page-5: swipe diagnostics (#3813)', () => {
  const origin = baseUrl('crouton-builder')
  for (const run of [1, 2, 3]) {
    test(`builder swipe run ${run}`, async ({ page, context }) => {
      expect(origin, 'BUILDER_URL (or the staging url)').toBeTruthy()
      await login(context, 'crouton-builder', origin)
      await page.goto(`${origin}/site/page-5`)
      await runDiag(page, 'crouton-builder', run)
    })
  }
})

test.describe('booking-demo blocks: swipe diagnostics (#3813)', () => {
  const origin = baseUrl('booking-demo')
  for (const run of [1, 2, 3]) {
    test(`booking-demo swipe run ${run}`, async ({ page, context }) => {
      expect(origin, 'BOOKING_DEMO_URL (or the staging url)').toBeTruthy()
      await login(context, 'booking-demo', origin)
      await page.goto(`${origin}/admin/${BD_TEAM}/blocks`)
      await runDiag(page, 'booking-demo', run)
    })
  }
})
