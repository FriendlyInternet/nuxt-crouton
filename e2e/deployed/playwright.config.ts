/**
 * Deployed-target Playwright config for the #3813 DIAGNOSTIC run — goes straight
 * at staging (no webServer, no fixture) and only picks up *.diag.spec.ts.
 *
 *   REVIEW_SEED_SECRET=… pnpm exec playwright test --config e2e/deployed/playwright.config.ts
 *
 * Engine: WebKit (the Safari engine) iPhone 13 by default. CAL_DIAG_ENGINE=chromium
 * runs the same tests on Chromium with iPhone emulation — the fallback for a runner
 * where WebKit never launches or hangs. Every DIAG3813 line names its engine.
 *
 * The main e2e/playwright.config.ts only matches *.smoke.spec.ts / *.setup.ts, so the
 * normal e2e run never picks these tests up.
 */
import { defineConfig, devices } from '@playwright/test'

const engine = process.env.CAL_DIAG_ENGINE === 'chromium' ? 'chromium' : 'webkit'

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.diag\.spec\.ts/,
  fullyParallel: false,
  retries: 0,
  workers: 1,
  // Hard limit per test: a hung browser must not eat the job.
  timeout: 120_000,
  globalTimeout: 14 * 60_000,
  reporter: [['list'], ['json', { outputFile: 'test-results/calendar-diag-results.json' }]],
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
