import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

// Runs the real `nuxt prepare` (via scripts/component-names.mjs) on the layer and reads
// the components Nuxt registers from it. Before #2611 the list was empty: the relative
// components path resolved under app/app/components, which does not exist.
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../..')

describe('crouton-email component registration (#2611)', () => {
  // covers: T1
  it('registers exactly its 4 Email* components', () => {
    const r = spawnSync('node', ['scripts/component-names.mjs', '--list', 'crouton-email', '--fresh'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000
    })
    expect(r.status, r.stderr).toBe(0)
    const lines = r.stdout.trim().split('\n').filter(Boolean)
    expect(lines).toEqual([
      'EmailInput\tapp/components/Email/Input.vue',
      'EmailMagicLinkSent\tapp/components/Email/MagicLinkSent.vue',
      'EmailResendButton\tapp/components/Email/ResendButton.vue',
      'EmailVerificationFlow\tapp/components/Email/VerificationFlow.vue'
    ])
  }, 150_000)
})
