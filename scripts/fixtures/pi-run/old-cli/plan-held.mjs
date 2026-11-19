// The `--approved-prompt` CLI that scripts/plan-held.mjs carried until #3620, kept ONLY so the
// frozen old-step.sh can still run live in scripts/pi-run.test.mjs. pi-run.mjs now calls
// approvedPromptSection() directly. REAL_SCRIPTS is the real scripts/ dir (set by the test).
const { approvedPromptSection } = await import(new URL('plan-held.mjs', process.env.REAL_SCRIPTS).href)
const { readFileSync } = await import('node:fs')
const argv = process.argv.slice(2)
const argValue = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
if (argv.includes('--approved-prompt')) {
  let planText
  try {
    planText = readFileSync(argValue('--plan-file'), 'utf8')
  } catch (e) {
    process.stderr.write(`plan-held: cannot read the plan file: ${e.message}\n`)
    process.exit(1)
  }
  process.stdout.write(approvedPromptSection({ planId: argValue('--plan-id'), planText, issue: argValue('--issue') }))
}
