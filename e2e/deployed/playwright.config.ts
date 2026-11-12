/**
 * Deployed-target Playwright config (#3813) — runs against a DEPLOYED staging
 * or PR preview, so there is no webServer and no fixture.
 *
 *   CAL_SCROLL_TARGET=staging pnpm exec playwright test --config e2e/deployed/playwright.config.ts
 *   CAL_SCROLL_TARGET=pr PR_NUMBER=123 BUILDER_URL=… BOOKING_DEMO_URL=… pnpm exec playwright test --config e2e/deployed/playwright.config.ts
 *
 * Engine: WebKit (the Safari engine) iPhone 13 by default. CAL_SCROLL_ENGINE=chromium
 * runs the same tests on Chromium with the same iPhone emulation — the owner's
 * fallback for a runner where WebKit hangs (#3813, 2026-11-12 15:26). The bug only
 * shows in WebKit, so a Chromium run cannot go red on main; the CALSCROLL lines
 * name the engine so the proof always says which one it ran on.
 */
import { defineConfig, devices } from '@playwright/test'

const engine = process.env.CAL_SCROLL_ENGINE === 'chromium' ? 'chromium' : 'webkit'

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.deployed\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  // Hard limit per test (owner, 2026-11-12 15:26): a hung browser must not eat the job.
  timeout: 120_000,
  globalTimeout: 25 * 60_000,
  reporter: [['list'], ['json', { outputFile: 'test-results/calendar-scroll-results.json' }]],
  use: {
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    launchOptions: { timeout: 60_000 },
  },
  projects: [
    engine === 'webkit'
      ? { name: 'webkit-iphone', use: { ...devices['iPhone 13'] } }
      : { name: 'chromium-iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
})
