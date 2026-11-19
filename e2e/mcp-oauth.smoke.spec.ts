/**
 * MCP sign-in smoke (#4096) — crouton-auth as the OAuth provider for MCP apps
 * (Claude, ChatGPT, …), next to crouton-mcp-toolkit's own `/.well-known/*` 404s.
 *
 * Only for the with-mcp-oauth fixture (flag on). The flag-off checks (T2) boot
 * a second dev server of the same fixture with `CROUTON_MCP_OAUTH=0`, on its
 * own port and build dir, so both ways run against the toolkit's real handlers.
 *
 *   E2E_FIXTURE=with-mcp-oauth pnpm test:e2e e2e/mcp-oauth.smoke.spec.ts
 *
 * The MCP client is played by the spec: it registers through DCR, opens the
 * authorize URL in the browser, and catches its callback
 * (https://claude.example/cb, intercepted with page.route) to read the code.
 */
import { expect, request as pwRequest, type Browser, type Page, type APIRequestContext } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { test, FIXTURE, config, createTeam, ensureAuthed, SIGN_IN_BUTTON } from './helpers'

const CALLBACK = 'https://claude.example/cb'
const DISCOVERY_PATHS = [
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/api/auth',
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp'
]

/**
 * Register an MCP client the way Claude does: no cookie, no Origin, public client.
 * Its own request context — the `request` fixture carries the saved session
 * cookie, and a cookie turns on better-auth's Origin (CSRF) check.
 */
async function registerClient(_request: APIRequestContext, base: string, opts: { name?: string | null, redirect?: string } = {}) {
  const request = await pwRequest.newContext({ storageState: { cookies: [], origins: [] } })
  const body: Record<string, unknown> = {
    redirect_uris: [opts.redirect ?? CALLBACK],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code']
  }
  if (opts.name !== null) body.client_name = opts.name ?? 'Claude'
  try {
    const res = await request.post(`${base}/api/auth/oauth2/register`, { data: body })
    expect(res.status(), await res.text()).toBeLessThan(300)
    return (await res.json()) as { client_id: string }
  } finally {
    await request.dispose()
  }
}

function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function authorizeUrl(base: string, clientId: string, challenge: string, opts: { scope?: string, redirect?: string } = {}) {
  const url = new URL(`${base}/api/auth/oauth2/authorize`)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: opts.redirect ?? CALLBACK,
    scope: opts.scope ?? 'pages offline_access',
    state: 'e2e-state',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${base}/mcp`
  }).toString()
  return url.toString()
}

/** The MCP client's callback: answer it with a stub page so the browser lands there. */
async function catchCallback(page: Page) {
  await page.route('https://claude.example/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>callback</p>' }))
}

/**
 * Count full loads of the consent page (a reload loop shows up as more than one).
 * Counts document requests, not `framenavigated`: hydration rewrites the URL in
 * place (same-document), which is not a reload.
 */
function countConsentLoads(page: Page) {
  const counter = { loads: 0 }
  page.on('request', (req) => {
    if (req.resourceType() === 'document' && req.frame() === page.mainFrame() && new URL(req.url()).pathname === '/auth/consent') counter.loads++
  })
  return counter
}

async function waitForCallback(page: Page) {
  await page.waitForURL(url => url.toString().startsWith(CALLBACK), { timeout: 60000 })
  return new URL(page.url())
}

/** POST /oauth2/token from a cookieless context, as the MCP client's own server does. */
async function tokenRequest(base: string, form: Record<string, string>) {
  const request = await pwRequest.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const res = await request.post(`${base}/api/auth/oauth2/token`, { form })
    return { status: res.status(), text: await res.text() }
  } finally {
    await request.dispose()
  }
}

async function exchangeCode(_request: APIRequestContext, base: string, clientId: string, code: string, verifier: string) {
  const res = await tokenRequest(base, { grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: verifier, resource: `${base}/mcp` })
  expect(res.status, res.text).toBe(200)
  return JSON.parse(res.text) as { access_token: string, refresh_token?: string, scope?: string }
}

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split('.')[1]
  expect(payload, 'access token is a JWT').toBeTruthy()
  return JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))
}

const teamClaims = (claims: Record<string, unknown>) => Object.keys(claims).filter(k => /team|org/i.test(k))

/** A browser context with NO session: the sign-in must happen inside the flow. */
async function freshPage(browser: Browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  return { context, page: await context.newPage() }
}

/** Authorized context → straight to the consent page for a fresh client. */
async function openConsent(page: Page, base: string, clientId: string) {
  const { challenge } = pkce()
  await gotoConsent(page, authorizeUrl(base, clientId, challenge))
}

/**
 * Go to an authorize URL and wait until the consent page is HYDRATED: the heading
 * is server-rendered, so it shows before the buttons work. The page's own
 * client-side `/oauth2/public-client` lookup finishing is the hydration signal.
 */
async function gotoConsent(page: Page, url: string) {
  const lookup = page.waitForResponse(res => res.url().includes('/api/auth/oauth2/public-client'), { timeout: 120000 })
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForURL(u => u.pathname === '/auth/consent', { timeout: 120000 })
  await lookup
  await expect(page.getByTestId('consent-title')).toBeVisible({ timeout: 120000 })
}

// Only the with-mcp-oauth fixture turns the MCP sign-in on; other fixtures don't register this suite
// (same shape as bookings-fullscreen.smoke.spec.ts — no skipped tests).
test.describe(FIXTURE === 'with-mcp-oauth' ? 'MCP sign-in (#4096)' : 'MCP sign-in (not this fixture)', () => {
  if (FIXTURE !== 'with-mcp-oauth') return
  test.describe.configure({ mode: 'serial' })

  // Claim names of a one-team user's token (T4), compared with a two-team user's (T7).
  let oneTeamClaimKeys: string[] = []

  test.describe('T2 — flag off', () => {
    const port = Number(process.env.E2E_PORT || 3000) + 100
    const offBase = `http://localhost:${port}`
    let server: ChildProcess | undefined
    let log = ''

    test.beforeAll(async () => {
      test.setTimeout(300000)
      server = spawn('pnpm', ['--filter', 'e2e-fixture-with-mcp-oauth', 'dev', '--port', String(port)], {
        cwd: join(__dirname, '..'),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CROUTON_MCP_OAUTH: '0',
          E2E_BUILD_DIR: '.nuxt-off',
          BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'dev',
          BETTER_AUTH_URL: offBase
        }
      })
      server.stdout?.on('data', (d) => { log = (log + d).slice(-4000) })
      server.stderr?.on('data', (d) => { log = (log + d).slice(-4000) })
      const deadline = Date.now() + 280000
      for (;;) {
        const ok = await fetch(`${offBase}/`).then(r => r.status < 500).catch(() => false)
        if (ok) break
        if (Date.now() > deadline || server.exitCode !== null) throw new Error(`flag-off fixture did not boot:\n${log}`)
        await new Promise(resolve => setTimeout(resolve, 2000))
      }
    })

    test.afterAll(() => {
      if (server?.pid) {
        try { process.kill(-server.pid, 'SIGTERM') } catch {}
      }
    })

    test('all four discovery paths answer 404 (the toolkit\'s own answer stays)', async ({ request }) => {
      for (const path of DISCOVERY_PATHS) {
        const res = await request.get(`${offBase}${path}`)
        expect(res.status(), path).toBe(404)
      }
      // And no OAuth routes behind /api/auth either.
      const reg = await request.post(`${offBase}/api/auth/oauth2/register`, { data: { redirect_uris: [CALLBACK] } })
      expect(reg.status()).toBe(404)
    })
  })

  test('T3 — flag on: discovery JSON at both paths names the endpoints and the resource <base>/mcp', async ({ request, baseURL }) => {
    const base = baseURL!
    for (const path of DISCOVERY_PATHS.slice(0, 2)) {
      const res = await request.get(`${base}${path}`)
      expect(res.status(), path).toBe(200)
      const meta = await res.json() as Record<string, unknown>
      for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint', 'jwks_uri']) {
        expect(meta[key], `${path} ${key}`).toBeTruthy()
      }
    }
    for (const path of DISCOVERY_PATHS.slice(2)) {
      const res = await request.get(`${base}${path}`)
      expect(res.status(), path).toBe(200)
      expect(((await res.json()) as { resource?: string }).resource, path).toBe(`${base}/mcp`)
    }
  })

  test('T4 — code + PKCE through /auth/login with the signed query, Autoriser on first consent, refresh works', async ({ browser, request, baseURL }) => {
    const base = baseURL!
    const { client_id: clientId } = await registerClient(request, base)
    const { verifier, challenge } = pkce()
    const { context, page } = await freshPage(browser)
    try {
      await catchCallback(page)
      const consent = countConsentLoads(page)

      // No session: the provider sends us to /auth/login?…&sig=….
      await page.goto(authorizeUrl(base, clientId, challenge), { waitUntil: 'domcontentloaded' })
      await page.waitForURL(url => url.pathname === '/auth/login' && url.searchParams.has('sig'), { timeout: 120000 })
      const email = page.locator('input[type="email"]')
      await email.waitFor({ state: 'visible', timeout: 120000 })
      // The signed query is still in the URL for the auth client to send.
      expect(new URL(page.url()).searchParams.get('sig')).toBeTruthy()
      await email.fill(config.testUser.email)
      await page.locator('input[type="password"]').first().fill(config.testUser.password)
      await page.getByRole('button', { name: SIGN_IN_BUTTON }).first().click()

      // Back in the flow without a manual step: the consent page.
      await page.waitForURL(url => url.pathname === '/auth/consent', { timeout: 120000 })
      await expect(page.getByTestId('consent-title')).toBeVisible({ timeout: 120000 })
      // Stays put (no reload loop).
      await page.waitForTimeout(3000)
      expect(consent.loads).toBe(1)

      await page.getByTestId('consent-allow').click()
      const back = await waitForCallback(page)
      expect(consent.loads).toBe(1)
      expect(back.searchParams.get('state')).toBe('e2e-state')
      const code = back.searchParams.get('code')
      expect(code, back.toString()).toBeTruthy()

      const tokens = await exchangeCode(request, base, clientId, code!, verifier)
      const claims = decodeJwt(tokens.access_token)
      const session = await (await page.request.get(`${base}/api/auth/get-session?disableCookieCache=true`)).json()
      expect(claims.sub).toBe(session.user.id)
      expect([claims.aud].flat()).toContain(`${base}/mcp`)
      expect(String(claims.scope).split(' ')).toContain('pages')
      expect(teamClaims(claims)).toEqual([])
      oneTeamClaimKeys = Object.keys(claims).sort()

      expect(tokens.refresh_token, 'offline_access gives a refresh token').toBeTruthy()
      const refreshed = await tokenRequest(base, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token!, client_id: clientId, resource: `${base}/mcp` })
      expect(refreshed.status, refreshed.text).toBe(200)
      const next = JSON.parse(refreshed.text) as { access_token?: string }
      expect(next.access_token).toBeTruthy()
      expect(next.access_token).not.toBe(tokens.access_token)
    } finally {
      await context.close()
    }
  })

  test('T5 — Refuser returns error=access_denied to the client', async ({ page, request, baseURL }) => {
    const base = baseURL!
    await ensureAuthed(page, base)
    const { client_id: clientId } = await registerClient(request, base, { name: 'Refused app' })
    await catchCallback(page)
    await openConsent(page, base, clientId)
    await page.getByTestId('consent-deny').click()
    const back = await waitForCallback(page)
    expect(back.searchParams.get('error')).toBe('access_denied')
    expect(back.searchParams.get('code')).toBeNull()
  })

  test('T6 — the heading names the client; a nameless client is "Une application"', async ({ page, request, baseURL }) => {
    const base = baseURL!
    await ensureAuthed(page, base)
    const headings: string[] = []
    for (const name of ['Claude', 'ChatGPT']) {
      const { client_id: clientId } = await registerClient(request, base, { name })
      await openConsent(page, base, clientId)
      const heading = (await page.getByTestId('consent-title').innerText()).trim()
      expect(heading).toContain(name)
      headings.push(heading)
    }
    expect(headings[0]).not.toBe(headings[1])

    const { client_id: nameless } = await registerClient(request, base, { name: null })
    await openConsent(page, base, nameless)
    await expect(page.getByTestId('consent-title')).toHaveText('Une application veut accéder à vos équipes')
  })

  test('T7 — a user in two teams connects once: no team picker, same token shape, no team claim', async ({ page, request, baseURL }) => {
    const base = baseURL!
    await ensureAuthed(page, base)
    const suffix = Date.now().toString(36)
    await createTeam(page, base, `E2E Second ${suffix}`, `e2e-second-${suffix}`)
    const orgs = await (await page.request.get(`${base}/api/auth/organization/list`)).json() as unknown[]
    expect(orgs.length).toBeGreaterThanOrEqual(2)

    const { client_id: clientId } = await registerClient(request, base, { name: 'Two-team app' })
    const { verifier, challenge } = pkce()
    await catchCallback(page)
    await gotoConsent(page, authorizeUrl(base, clientId, challenge))
    // No team picker of any kind.
    await expect(page.getByRole('combobox')).toHaveCount(0)
    await expect(page.getByRole('listbox')).toHaveCount(0)
    await expect(page.getByRole('radio')).toHaveCount(0)
    // The second team is not offered anywhere on the page. (The route announcer
    // — role=status, "Consent | <active team>" — is the page title, not a choice.)
    await expect(page.getByText(`E2E Second ${suffix}`).and(page.locator(':not([role="status"])'))).toHaveCount(0)

    await page.getByTestId('consent-allow').click()
    const code = (await waitForCallback(page)).searchParams.get('code')
    expect(code).toBeTruthy()
    const claims = decodeJwt((await exchangeCode(request, base, clientId, code!, verifier)).access_token)
    expect(teamClaims(claims)).toEqual([])
    expect(oneTeamClaimKeys.length, 'T4 ran first and recorded a one-team token').toBeGreaterThan(0)
    expect(Object.keys(claims).sort()).toEqual(oneTeamClaimKeys)
  })

  test('T9 — the consent page shows the host of the registered redirect URI', async ({ page, request, baseURL }) => {
    const base = baseURL!
    await ensureAuthed(page, base)
    const { client_id: clientId } = await registerClient(request, base, { name: 'Claude', redirect: CALLBACK })
    await openConsent(page, base, clientId)
    await expect(page.getByTestId('consent-host')).toContainText('claude.example')
  })
})
