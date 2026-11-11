#!/usr/bin/env node
// A stand-in for the `gh` CLI, answering exactly the calls the pi step's prompt building makes
// (#3620). Used two ways: imported as `fakeGh(data, failRe)` (an injected `gh(args) → stdout`),
// and run as a CLI behind a `gh` shim on PATH, so both today's frozen bash (old-step.sh) and
// `node scripts/pi-run.mjs prompt` hit the same answers. FAKE_GH_DATA = the JSON file,
// FAKE_GH_FAIL = a regex over the joined args that makes the call fail (exit 1).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const after = (args, flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }

export function fakeGh(data, failRe) {
  return (args) => {
    if (failRe && new RegExp(failRe).test(args.join(' '))) throw Object.assign(new Error(`fake gh: forced failure: ${args.join(' ')}`), { status: 1 })
    if (args[0] === 'api') {
      const path = args.find((a) => a.startsWith('repos/')) || ''
      const jq = after(args, '--jq')
      let m
      if ((m = /\/issues\/comments\/(\d+)$/.exec(path))) {
        const c = data.comments[m[1]]
        if (!c) throw new Error(`fake gh: no comment ${m[1]}`)
        if (jq === '.body') return `${c.body}\n`
        if (jq === '.user.type') return `${c.user.type}\n`
        throw new Error(`fake gh: unsupported --jq ${jq}`)
      }
      if ((m = /\/issues\/(\d+)\/comments(\?.*)?$/.exec(path))) {
        const list = (data.issues[m[1]]?.comments || []).map((id) => data.comments[id])
        if (jq === '.[] | @json') return list.map((c) => `${JSON.stringify(c)}\n`).join('')
        return JSON.stringify(list)
      }
    }
    if (args[0] === 'issue' && args[1] === 'view') {
      const i = data.issues[args[2]]
      if (!i) throw new Error(`fake gh: no issue ${args[2]}`)
      return `${i.body}\n`
    }
    if (args[0] === 'pr' && args[1] === 'list') {
      const n = data.prs[after(args, '--head')]
      return n ? `${n}\n` : '\n'
    }
    throw new Error(`fake gh: unsupported call: ${args.join(' ')}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const gh = fakeGh(JSON.parse(readFileSync(process.env.FAKE_GH_DATA, 'utf8')), process.env.FAKE_GH_FAIL)
  try {
    process.stdout.write(gh(process.argv.slice(2)))
  } catch (e) {
    process.stderr.write(`${e.message}\n`)
    process.exit(1)
  }
}
