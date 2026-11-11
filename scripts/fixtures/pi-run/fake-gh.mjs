#!/usr/bin/env node
// A stand-in for the `gh` CLI, answering exactly the calls the pi step's prompt building makes
// (#3620). Used two ways: imported as `fakeGh(data, failRe)` (an injected `gh(args) → stdout`),
// and run as a CLI behind a `gh` shim on PATH, so both today's frozen bash (old-step.sh) and
// `node scripts/pi-run.mjs prompt` hit the same answers. FAKE_GH_DATA = the JSON file,
// FAKE_GH_FAIL = a regex over the joined args that makes the call fail (exit 1).
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const after = (args, flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined }

// One small handler per gh call shape (kept apart so no single function grows past the
// fallow complexity gate). Each returns stdout, or undefined when the call isn't its shape.
const COMMENT_FIELDS = { '.body': (c) => c.body, '.user.type': (c) => c.user.type }

function apiComment(data, id, jq) {
  const c = data.comments[id]
  if (!c) throw new Error(`fake gh: no comment ${id}`)
  const field = COMMENT_FIELDS[jq]
  if (!field) throw new Error(`fake gh: unsupported --jq ${jq}`)
  return `${field(c)}\n`
}

function apiCommentList(data, issue, jq) {
  const list = (data.issues[issue]?.comments || []).map((id) => data.comments[id])
  if (jq === '.[] | @json') return list.map((c) => `${JSON.stringify(c)}\n`).join('')
  return JSON.stringify(list)
}

function api(data, args) {
  const path = args.find((a) => a.startsWith('repos/')) || ''
  const jq = after(args, '--jq')
  let m
  if ((m = /\/issues\/comments\/(\d+)$/.exec(path))) return apiComment(data, m[1], jq)
  if ((m = /\/issues\/(\d+)\/comments(\?.*)?$/.exec(path))) return apiCommentList(data, m[1], jq)
  return undefined
}

function issueView(data, args) {
  const i = data.issues[args[2]]
  if (!i) throw new Error(`fake gh: no issue ${args[2]}`)
  return `${i.body}\n`
}

function prList(data, args) {
  const n = data.prs[after(args, '--head')]
  return n ? `${n}\n` : '\n'
}

const HANDLERS = { api, 'issue view': issueView, 'pr list': prList }

export function fakeGh(data, failRe) {
  return (args) => {
    if (failRe && new RegExp(failRe).test(args.join(' '))) throw Object.assign(new Error(`fake gh: forced failure: ${args.join(' ')}`), { status: 1 })
    const handler = HANDLERS[args[0]] || HANDLERS[`${args[0]} ${args[1]}`]
    const out = handler ? handler(data, args) : undefined
    if (out === undefined) throw new Error(`fake gh: unsupported call: ${args.join(' ')}`)
    return out
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
