// chromium-launch.mjs — discover the CI-preinstalled chromium and launch it, or warn + skip.
// Extracted from smoke-deployed.mjs / capture-review-surfaces.mjs (the same discovery + launch +
// non-fatal warn-and-skip). A screenshot is EVIDENCE, never a gate, so a missing/un-launchable
// browser build (e.g. a fresh self-hosted runner cache, #1126) returns null rather than throwing.
import { existsSync } from 'node:fs'

/** The chromium builds we try, in order — the CI/sandbox pre-install, then env override. */
export function browserCandidates() {
  return [
    process.env.PLAYWRIGHT_CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  ].filter(Boolean)
}

/** Launch chromium (playwright-core, falling back to playwright). Returns the browser, or null
 *  (with a warn via `log`) when playwright or a launchable build is absent — never throws. */
export async function launchChromium(log = () => {}) {
  let chromium
  try {
    ({ chromium } = await import('playwright-core').catch(() => import('playwright')))
  } catch (e) {
    log(`no playwright available — skipping (${e.message.split('\n')[0]})`)
    return null
  }
  const execPath = browserCandidates().find((p) => p && existsSync(p))
  const opts = { args: ['--no-sandbox', '--disable-gpu'], ...(execPath ? { executablePath: execPath } : {}) }
  try {
    return await chromium.launch(opts)
  } catch (e) {
    log(`no launchable browser — skipping (non-fatal): ${e.message.split('\n')[0]}`)
    return null
  }
}
