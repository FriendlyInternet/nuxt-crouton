// The `--is-source` CLI that scripts/lib/owner-screens.mjs carried until #3620, kept ONLY so the
// frozen old-step.sh can still run live in scripts/pi-run.test.mjs. pi-run.mjs now calls
// isOwnerScreenSource() directly. REAL_SCRIPTS is the real scripts/ dir (set by the test).
const { isOwnerScreenSource } = await import(new URL('lib/owner-screens.mjs', process.env.REAL_SCRIPTS).href)
const [flag, file, slug] = process.argv.slice(2)
if (flag !== '--is-source' || !file) {
  console.error('usage: owner-screens.mjs --is-source <body-file> <app-slug>')
  process.exit(2)
}
const { readFileSync } = await import('node:fs')
let body = ''
try { body = readFileSync(file, 'utf8') } catch { process.exit(1) }
process.exit(isOwnerScreenSource({ comment: { body, appSlug: slug || null } }) ? 0 : 1)
