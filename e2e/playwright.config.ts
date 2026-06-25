/**
 * Crouton E2E Playwright Configuration
 *
 * Target: the fixture app fixtures/minimal (pkg "e2e-fixture-minimal"),
 * a dedicated minimal crouton app used to verify a generated app still
 * boots + authenticates + does CRUD (e.g. after dependency bumps).
 */
import { defineConfig, devices } from '@playwright/test'
import { join } from 'node:path'

const storageState = join(__dirname, '.auth', 'user.json')

// Which fixture app to boot/test (default: minimal). See e2e/helpers.ts.
const fixture = process.env.E2E_FIXTURE || 'minimal'

export default defineConfig({
  testDir: '.',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // CI emits the self-contained HTML report (bundles video + trace + screenshots)
  // alongside the line reporter, so each run uploads one reviewable artifact (#356).
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'html',
  // Generous per-test budget: a fixture's first hit on a route/modal compiles it
  // on demand (nuxt dev), which is markedly slower on CI runners than locally.
  // Generous per-test budget. `nuxt dev` compiles each route on first hit, and CI
  // runners are far slower at this than locally (heavy package routes can take
  // 2-3 min to compile cold). High timeouts are ~free for passing tests — they
  // only cap how long a slow-but-valid first compile may take — so we set them
  // well above the worst observed CI compile rather than chase a tight value.
  timeout: 240000,
  expect: { timeout: 30000 },

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    // Escape hatch for sandboxes that block the Playwright browser download
    // (egress allowlist) and only ship a slightly-off chromium build: point
    // PW_EXECUTABLE_PATH at an installed binary (e.g. one under /opt/pw-browsers)
    // to launch it instead of the version Playwright would otherwise fetch.
    ...(process.env.PW_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PW_EXECUTABLE_PATH } }
      : {}),
    // Visual-QA capture (#356): record on every run so each PR yields reviewable
    // proof, not just a green check. trace = a step-by-step timeline with a
    // before/after screenshot of every action plus DOM snapshots and console logs
    // (the part that matters most for a UI-library bump); video = a watchable clip;
    // screenshot = a final shot per test. The CI HTML report bundles all three.
    trace: 'on',
    video: 'on',
    screenshot: 'on',
    actionTimeout: 20000,
    navigationTimeout: 120000
  },

  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/
    },
    {
      name: 'chromium',
      testMatch: /.*\.smoke\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState
      },
      dependencies: ['setup']
    }
  ],

  // Boots the active fixture app if it isn't already running on :3000.
  webServer: {
    command: `pnpm --filter e2e-fixture-${fixture} dev`,
    cwd: '..',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    // Self-contained auth env so the harness no longer silently depends on the
    // caller exporting BETTER_AUTH_SECRET (the #1 "why won't the fixture boot"
    // foot-gun). A real value still wins; otherwise fall back to the dev secret.
    env: {
      ...process.env,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'dev',
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
      // The with-sales fixture (#355) exercises the in-process ESC/POS drainer:
      // turn it on so a placed order's print job is delivered to the in-test fake
      // :9100 printer and driven to done. Harmless for other fixtures (no
      // print_jobs to drain). node:net is imported lazily by the drainer, so this
      // is a no-op until a job exists.
      ...(fixture === 'with-sales' ? { CROUTON_PRINTING_DRAINER: '1' } : {})
    },
    // Generous: a cold `nuxt dev` first build in CI can take a while.
    timeout: 180000
  }
})
