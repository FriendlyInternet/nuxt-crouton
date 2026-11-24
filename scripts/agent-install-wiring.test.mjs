/** #3199 — the two agent workflows install fast (`--ignore-scripts`) but still build every dependency
 * the repo allows to build. Reads the real workflow files. node --test scripts/agent-install-wiring.test.mjs */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
const allowedBuilds = JSON.parse(read('package.json')).pnpm.onlyBuiltDependencies

for (const wf of ['work-issue-pidev.yml', 'decompose-on-issue-pidev.yml']) {
  const y = read(`.github/workflows/${wf}`)

  // covers: T1
  test(`${wf}: Install skips workspace scripts and never runs the plain install`, () => {
    const installs = [...y.matchAll(/^\s+run: (pnpm install --frozen-lockfile[^\n]*)$/gm)].map(m => m[1])
    assert.deepEqual(installs, ['pnpm install --frozen-lockfile --ignore-scripts'])
  })

  // covers: T1
  test(`${wf}: rebuilds every dependency in pnpm.onlyBuiltDependencies right after Install`, () => {
    const after = y.slice(y.indexOf('run: pnpm install --frozen-lockfile --ignore-scripts'))
    const m = after.match(/^\s+run: pnpm rebuild ([^\n]+)$/m)
    assert.ok(m, 'a pnpm rebuild step follows the install')
    const between = after.slice(0, after.indexOf(m[0]))
    assert.equal(between.match(/- name:/g)?.length, 1, 'rebuild is the very next step')
    assert.deepEqual(m[1].trim().split(/\s+/).sort(), [...allowedBuilds].sort())
  })

  // covers: T1
  test(`${wf}: keeps the per-job pnpm folder (#1255)`, () => {
    assert.match(y, /dest: \$\{\{ runner\.temp \}\}\/setup-pnpm/)
  })
}
