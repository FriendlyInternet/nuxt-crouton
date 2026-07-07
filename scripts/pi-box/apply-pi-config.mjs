#!/usr/bin/env node
// apply-pi-config.mjs — reconcile the mac-mini's pi.dev box to the committed manifest (#1060).
//
// Config-as-code for the pi box: the manifest pins an opinionated INSTALLER as the base
// (@robzolkos/lazypi) and our DELTAS + settings on top. This applies it idempotently:
//   1. base   — run `npx <installer>@<version>` only when the recorded base version differs
//               (it overwrites ~/.pi/agent/settings.json, backing up the old)
//   2. add    — `pi install <spec> --no-approve` any manifest delta not already present
//               (the manifest PR IS the supply-chain review, so apply doesn't re-prompt)
//   3. remove — `pi remove <spec>` anything in manifest.remove
//   4. settings — merge manifest.settings (otel/subagents/theme) into the live settings.json
//
// Usage (on the mini):
//   node scripts/pi-box/apply-pi-config.mjs --dry-run     # print the plan, change nothing
//   node scripts/pi-box/apply-pi-config.mjs               # apply
//   --skip-base            reconcile deltas+settings only (don't touch the base installer)
//   --force-base          run the base installer even if the recorded version matches
//   --manifest <path>     default scripts/pi-box/pi-config.manifest.json
//   --settings <path>     default ~/.pi/agent/settings.json  (override for safe testing)
//   --base-marker <path>  default ~/.pi/agent/.pi-box-base   (records the applied base version)
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOME = process.env.HOME || ''
const args = parseArgs(process.argv.slice(2))
const dry = 'dry-run' in args
const manifestPath = str(args.manifest, join(ROOT, 'scripts/pi-box/pi-config.manifest.json'))
const settingsPath = str(args.settings, join(HOME, '.pi/agent/settings.json'))
const markerPath = str(args['base-marker'], join(HOME, '.pi/agent/.pi-box-base'))

const manifest = loadJson(manifestPath)
if (!manifest) die(`cannot read manifest ${manifestPath}`)
const live = loadJson(settingsPath) || { packages: [] }
const livePkgs = Array.isArray(live.packages) ? live.packages : []

log(`\n\x1b[1mpi box config apply\x1b[0m ${dry ? '(DRY RUN — no changes)' : ''}`)
log(`manifest ${rel(manifestPath)} · settings ${rel(settingsPath)}`)

const basePlan = planBase()
const addPlan = manifest.add?.filter(spec => !hasPkg(livePkgs, spec)) || []
const removePlan = manifest.remove?.filter(spec => hasPkg(livePkgs, spec)) || []
const settingsChanged = changedSettingKeys()

printPlan()
if (dry) { log('\n(dry run — nothing applied)'); process.exit(0) }
applyBase()
for (const spec of removePlan) sh(`pi remove ${shq(spec)}`)
for (const spec of addPlan) sh(`pi install ${shq(spec)} --no-approve`)
applySettings()
log('\n✅ applied. Verify: `pi list` + `node scripts/pi-box/apply-pi-config.mjs --dry-run` (should be a no-op).')

// ── planning ────────────────────────────────────────────────────────────────────────────
const wantBase = manifest.base ? manifest.base.version : null
function readBaseMarker() { return existsSync(markerPath) ? readFileSync(markerPath, 'utf8').trim() : null }
function runReason(have) { return have ? `version ${have}→${wantBase}` : 'no recorded base' }
function planBase() {
  const have = readBaseMarker()
  if ('skip-base' in args) return { action: 'skip', have, want: wantBase, reason: '--skip-base' }
  if ('force-base' in args) return { action: 'run', have, want: wantBase, reason: '--force-base' }
  if (have === wantBase) return { action: 'up-to-date', have, want: wantBase }
  return { action: 'run', have, want: wantBase, reason: runReason(have) }
}
function changedSettingKeys() {
  const want = manifest.settings || {}
  return Object.keys(want).filter(k => JSON.stringify(live[k]) !== JSON.stringify(want[k]))
}
function printPlan() {
  const b = basePlan
  log(`\n\x1b[1mbase\x1b[0m  ${manifest.base?.installer}@${b.want}: ${b.action}${b.reason ? ` (${b.reason})` : ''}`)
  log(`\x1b[1madd\x1b[0m   ${plural(addPlan.length, 'install')}${addPlan.map(s => `\n  + ${s}`).join('')}`)
  log(`\x1b[1mremove\x1b[0m ${plural(removePlan.length, 'remove')}${removePlan.map(s => `\n  - ${s}`).join('')}`)
  log(`\x1b[1msettings\x1b[0m ${settingsChanged.length ? settingsChanged.join(', ') : 'no change'}`)
}

// ── applying ────────────────────────────────────────────────────────────────────────────
function applyBase() {
  if (basePlan.action !== 'run') return
  sh(`npx ${shq(manifest.base.installer)}@${shq(manifest.base.version)}`)
  writeFileSync(markerPath, String(manifest.base.version))
}
function applySettings() {
  if (!settingsChanged.length) return
  const merged = { ...(loadJson(settingsPath) || {}), ...(manifest.settings || {}) }
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n')
  log(`  wrote ${settingsChanged.length} settings key(s) to ${rel(settingsPath)}`)
}

// ── helpers ─────────────────────────────────────────────────────────────────────────────
function pkgName(spec) {
  const body = String(spec).replace(/^(npm|git):/, '')
  const at = body.lastIndexOf('@')
  return at > 0 ? body.slice(0, at) : body
}
function hasPkg(list, spec) { const n = pkgName(spec); return list.some(p => pkgName(p) === n) }
function loadJson(p) { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
function sh(cmd) { log(`  $ ${cmd}`); execSync(cmd, { stdio: 'inherit', cwd: HOME }) }
function shq(s) { return `'${String(s).replace(/'/g, "'\\''")}'` }
function rel(p) { return p.replace(ROOT + '/', '').replace(HOME, '~') }
function plural(n, verb) { return n === 0 ? `nothing to ${verb}` : `${n} to ${verb}:` }
function str(v, d) { return typeof v === 'string' ? v : d }
function log(m) { process.stdout.write(m + '\n') }
function die(m) { process.stderr.write(`ERROR: ${m}\n`); process.exit(1) }
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    out[a.slice(2)] = isValue(argv[i + 1]) ? argv[++i] : true
  }
  return out
}
function isValue(tok) { return tok !== undefined && !tok.startsWith('--') }
