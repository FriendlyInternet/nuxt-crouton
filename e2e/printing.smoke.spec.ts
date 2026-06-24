/**
 * Sales/printing smoke (#355) — proves a generated sales app still boots, takes
 * an order, and drives the full print loop, all WITHOUT hardware (a fake :9100
 * TCP printer stood up in-test). Fixture-scoped: only runs when the active
 * fixture is `with-sales` (like maps.smoke is gated on a `maps` manifest block).
 *
 * Two tiers:
 *
 *   TIER 1 (enqueue + wiring) — seed → PIN-redeem → create an order → assert
 *     print-status returns a PENDING ('0') job. Proves layer extends +
 *     auto-imports + schema generation + the status read path all boot together.
 *
 *   TIER 2 (transport + hook end-to-end) — a fake `:9100` server replies to the
 *     drainer's DLE-EOT status queries with "online, paper present"
 *     ([0x12,0x00,0x00] → classifyStatus '' healthy), so the in-process ESC/POS
 *     drainer (CROUTON_PRINTING_DRAINER=1, set for this fixture in
 *     playwright.config.ts) flips the job to DONE ('2') and the sales
 *     printing-subscriber auto-completes the order. This is the test that would
 *     have caught a broken hook wiring after the printing extraction (#325).
 *
 * Contracts (verified against the code, see the issue):
 *   - PIN redeem:   POST /api/auth/scoped-access/redeem
 *   - create order: POST /api/crouton-sales/events/{eventId}/orders
 *   - print status: GET  /api/crouton-sales/events/{eventId}/orders/{orderId}/print-status
 *   - order status: a generic collection GET on sales-orders
 *
 * CJS-safe (repo root is CommonJS; Playwright transpiles to CJS): uses
 * `__dirname`, never `import.meta.url`. Very generous first-hit timeouts mirror
 * the other specs (cold `nuxt dev` compile on CI).
 */
import { test, expect } from '@playwright/test'
import net from 'node:net'
import type { AddressInfo } from 'node:net'
import {
  FIXTURE,
  ensureAuthed,
  activeTeamId
} from './helpers'

// Only the with-sales fixture exercises sales/printing. Any other fixture skips
// the whole file (mirrors maps.smoke gating on its manifest block).
const isSalesFixture = FIXTURE === 'with-sales'

// Generous budgets — the sales layer is heavy and compiles slowly cold on CI.
const FIRST_HIT = 180000
// The drainer polls every 2s; a cold first drain compiles the escpos util too.
const DRAIN_TIMEOUT = 120000

/** Better-auth blocks state-changing requests without an Origin header (CSRF). */
function authHeaders(base: string) {
  return { Origin: base, Referer: `${base}/` }
}

/**
 * A fake ESC/POS printer on 127.0.0.1: answers every DLE-EOT status query the
 * drainer sends. `faultBytes` are the 2nd/3rd response bytes — default
 * [0x00,0x00] = online, paper present (job → '2'); [0x00,0x20] = paper out
 * (job → '9'). The first byte is always 0x12 so (b1 & 0x93) === 0x12 passes
 * classifyStatus's "is an ESC/POS printer" check.
 */
function startFakePrinter(faultBytes: [number, number] = [0x00, 0x00]) {
  const server = net.createServer((socket) => {
    socket.on('data', () => {
      socket.write(Buffer.from([0x12, faultBytes[0], faultBytes[1]]))
    })
    socket.on('error', () => { /* client reset — ignore */ })
  })
  return server
}

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port))
  })
}

test.describe(`fixture "${FIXTURE}" sales/printing`, () => {
  test.skip(!isSalesFixture, 'fixture is not with-sales')

  /**
   * Resolve the CURRENTLY-active team as { id, slug }. We deliberately don't
   * read the saved TEAM_FILE: the auth smoke specs create + activate a SECOND
   * team, so by the time this spec runs the active team may differ from the one
   * setup saved. The seeded event's id is derived from the team slug and its row
   * is keyed `(teamId, slug)` UNIQUE — so teamId and teamSlug MUST come from the
   * same (active) team, or the seed collides. Fetching both from the live
   * session avoids that mismatch.
   */
  async function activeTeam(page: import('@playwright/test').Page, base: string): Promise<{ id: string, slug: string }> {
    const id = await activeTeamId(page, base)
    expect(id, 'active team id').toBeTruthy()
    const listRes = await page.request.get(`${base}/api/auth/organization/list`, { headers: authHeaders(base) })
    const orgs = listRes.ok() ? await listRes.json().catch(() => []) : []
    const org = (Array.isArray(orgs) ? orgs : []).find((o: any) => o.id === id)
    expect(org?.slug, 'active team slug').toBeTruthy()
    return { id: id as string, slug: org.slug as string }
  }

  /**
   * Seed the fixture (event vlaamsekermis, PIN 1234, products) + a kitchen
   * printer pointed at `printerPort`, redeem the helper PIN, and return
   * everything the order flow needs. Uses the page's authed request context.
   */
  async function setup(page: import('@playwright/test').Page, base: string, printerPort: number) {
    await ensureAuthed(page, base)
    const team = await activeTeam(page, base)
    const teamId = team.id
    const teamSlug = team.slug

    // Seed against the live DB the app reads (dev-only fixture route).
    const seedRes = await page.request.post(`${base}/api/_seed`, {
      headers: authHeaders(base),
      data: { teamId, teamSlug, printerIp: '127.0.0.1', printerPort }
    })
    expect(seedRes.ok(), `seed failed: ${seedRes.status()} ${await seedRes.text()}`).toBeTruthy()
    const seed = await seedRes.json()
    expect(seed.eventId, 'seeded event id').toBeTruthy()
    expect(Array.isArray(seed.products) && seed.products.length, 'seeded products').toBeTruthy()

    // Redeem the helper PIN — sales' before-redeem hook lazily syncs the event's
    // helperPin into a grant on first redeem, so no grant pre-seed is needed.
    const redeemRes = await page.request.post(`${base}/api/auth/scoped-access/redeem`, {
      headers: authHeaders(base),
      data: {
        teamId,
        resourceType: 'event',
        resourceId: seed.eventId,
        secret: '1234',
        displayName: 'E2E Helper'
      }
    })
    expect(redeemRes.ok(), `redeem failed: ${redeemRes.status()} ${await redeemRes.text()}`).toBeTruthy()
    const { token } = await redeemRes.json()
    expect(token, 'scoped token').toBeTruthy()

    return { teamId: teamId as string, eventId: seed.eventId as string, products: seed.products, token: token as string }
  }

  /** Place a one-product order; returns the order id + the enqueued job ids. */
  async function placeOrder(page: import('@playwright/test').Page, base: string, ctx: { eventId: string, products: any[], token: string }) {
    const product = ctx.products[0]
    const res = await page.request.post(`${base}/api/crouton-sales/events/${ctx.eventId}/orders`, {
      headers: { 'x-scoped-token': ctx.token },
      data: { items: [{ productId: product.id, quantity: 1, price: product.price }], total: product.price }
    })
    expect(res.ok(), `order failed: ${res.status()} ${await res.text()}`).toBeTruthy()
    const body = await res.json()
    expect(body.order?.id, 'order id').toBeTruthy()
    return { orderId: body.order.id as string, printQueueIds: (body.printQueueIds ?? []) as string[] }
  }

  /** Read the per-order print-status array (helper-token authed). */
  async function printStatus(page: import('@playwright/test').Page, base: string, ctx: { eventId: string, token: string }, orderId: string) {
    const res = await page.request.get(`${base}/api/crouton-sales/events/${ctx.eventId}/orders/${orderId}/print-status`, {
      headers: { 'x-scoped-token': ctx.token }
    })
    expect(res.ok(), `print-status failed: ${res.status()}`).toBeTruthy()
    return (await res.json()) as Array<{ id: string, status: string, printerTitle?: string }>
  }

  /**
   * Read one order's status via the generic team-scoped list endpoint
   * (`?ids=` → getSalesOrdersByIds). There is no single-item GET on the
   * generated orders collection, so we filter by id. Returns the status string
   * (or a diagnostic string), so `expect.poll` can wait on it.
   */
  async function orderStatus(page: import('@playwright/test').Page, base: string, teamId: string, orderId: string): Promise<string> {
    const res = await page.request.get(`${base}/api/teams/${teamId}/sales-orders`, {
      headers: authHeaders(base),
      params: { ids: orderId }
    })
    if (!res.ok()) return `http ${res.status()}`
    const rows = await res.json()
    const order = Array.isArray(rows) ? rows[0] : rows?.items?.[0]
    return order?.status ?? 'unknown'
  }

  // ── TIER 1 ────────────────────────────────────────────────────────────────
  test('tier 1: order enqueues a print job that the status endpoint reads back', async ({ page, baseURL }) => {
    test.setTimeout(FIRST_HIT + 60000)
    const base = baseURL || 'http://localhost:3000'

    // Point at an unbound port so the global in-process drainer can't deliver
    // this job: its pre-flight to 127.0.0.1:65000 is refused. We read status
    // straight after the POST to catch it PENDING ('0'). Because the drainer
    // ticks every ~2s, a slow box may have already flipped it to printing ('1')
    // or — once the refused pre-flight resolves — failed ('9'); all three prove
    // the same Tier-1 claim (layer extends + auto-imports + schema gen + the
    // status read path booted together and an order produced a real job row).
    const ctx = await setup(page, base, 65000)
    const { orderId } = await placeOrder(page, base, ctx)

    const jobs = await printStatus(page, base, ctx, orderId)
    expect(Array.isArray(jobs), 'print-status returns an array').toBeTruthy()
    expect(jobs.length, 'at least one print job enqueued (source sales / order)').toBeGreaterThan(0)
    // The job carries the seeded kitchen printer title (denormalized onto the
    // generic print_jobs row at enqueue time — proves the enqueue path ran).
    expect(jobs[0].printerTitle, 'denormalized printer title').toBeTruthy()
    // A valid print-job status code (pending/printing/failed — see PRINT_STATUS).
    expect(['0', '1', '9']).toContain(jobs[0].status)
  })

  // ── TIER 2 ────────────────────────────────────────────────────────────────
  test('tier 2: a healthy fake :9100 printer drives the job to done + auto-completes the order', async ({ page, baseURL }) => {
    test.setTimeout(FIRST_HIT + DRAIN_TIMEOUT + 60000)
    const base = baseURL || 'http://localhost:3000'

    const printer = startFakePrinter([0x00, 0x00]) // online, paper present
    const port = await listen(printer)

    try {
      const ctx = await setup(page, base, port)
      const { orderId } = await placeOrder(page, base, ctx)

      // The in-process drainer (CROUTON_PRINTING_DRAINER=1) polls every 2s; it
      // pre-flights the fake printer, prints, and confirms healthy → job '2'.
      await expect.poll(async () => {
        const jobs = await printStatus(page, base, ctx, orderId)
        return jobs.length > 0 && jobs.every(j => j.status === '2')
      }, {
        message: 'all print jobs reach DONE (2) via the fake printer',
        timeout: DRAIN_TIMEOUT,
        intervals: [1000, 2000, 2000]
      }).toBe(true)

      // The completion hook → sales printing-subscriber → onJobCompleted should
      // have flipped the order to 'completed'. Read it back via the generic
      // collection GET (team-scoped, uses the saved admin session).
      await expect.poll(
        () => orderStatus(page, base, ctx.teamId, orderId),
        {
          message: 'order auto-completes once all its tickets print',
          timeout: 30000,
          intervals: [1000, 2000]
        }
      ).toBe('completed')
    } finally {
      await new Promise<void>(r => printer.close(() => r()))
    }
  })

  // ── TIER 2 (fail variant, optional) ─────────────────────────────────────────
  test('tier 2 (fail): a paper-out fake printer fails the job and flags the order', async ({ page, baseURL }) => {
    test.setTimeout(FIRST_HIT + DRAIN_TIMEOUT + 60000)
    const base = baseURL || 'http://localhost:3000'

    const printer = startFakePrinter([0x00, 0x20]) // paper out → classifyStatus 'Paper out'
    const port = await listen(printer)

    try {
      const ctx = await setup(page, base, port)
      const { orderId } = await placeOrder(page, base, ctx)

      await expect.poll(async () => {
        const jobs = await printStatus(page, base, ctx, orderId)
        return jobs.length > 0 && jobs.some(j => j.status === '9')
      }, {
        message: 'the paper-out job reaches FAILED (9)',
        timeout: DRAIN_TIMEOUT,
        intervals: [1000, 2000, 2000]
      }).toBe(true)

      await expect.poll(
        () => orderStatus(page, base, ctx.teamId, orderId),
        {
          message: 'order is flagged print_failed',
          timeout: 30000,
          intervals: [1000, 2000]
        }
      ).toBe('print_failed')
    } finally {
      await new Promise<void>(r => printer.close(() => r()))
    }
  })
})
