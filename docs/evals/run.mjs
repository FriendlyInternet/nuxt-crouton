// Ask-Claude eval runner (#3169). Asks each question to Claude with the docs MCP
// connector attached, scores the answers, prints per-question pass/fail.
// Usage: ANTHROPIC_API_KEY=... node docs/evals/run.mjs [--mcp-url URL] [--model ID] [--out file.json]
import { readFileSync, writeFileSync } from 'node:fs'
import { scoreAnswer, summarize } from './score.mjs'

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d }
const mcpUrl = arg('mcp-url', 'https://crouton.pmcp.dev/mcp')
const model = arg('model', 'claude-sonnet-5-5')
const out = arg('out')
const questionsFile = arg('questions', new URL('./questions.json', import.meta.url).pathname)
const key = process.env.ANTHROPIC_API_KEY
if (!key) { console.error('ANTHROPIC_API_KEY is required'); process.exit(2) }

const { questions } = JSON.parse(readFileSync(questionsFile, 'utf8'))

// Real CLI command names, read from the CLI's own `subCommands` map (no hand-kept list).
function realCliCommands() {
  const src = readFileSync(new URL('../../packages/crouton-cli/bin/crouton-generate.js', import.meta.url), 'utf8')
  const block = src.match(/subCommands:\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
  const names = [...block.matchAll(/^\s*(?:'([\w-]+)'|([\w-]+))\s*:/gm)].map(m => m[1] || m[2])
  if (!names.length) throw new Error('could not read CLI subCommands')
  return names
}

// The same validator behind the MCP validate_schema tool (needs `pnpm --filter @fyit/crouton-mcp build`).
const ctx = { cliCommands: realCliCommands() }
if (questions.some(q => q.kind === 'schema')) {
  // Built output, resolved at runtime (dist is not in the static import graph)
  const validator = new URL('../../packages/crouton-mcp/dist/tools/validate-schema.js', import.meta.url).href
  ctx.validateSchema = (await import(validator)).handleValidateSchema
}

async function ask(question) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'mcp-client-2025-04-04', 'content-type': 'application/json' },
    body: JSON.stringify({
      model, max_tokens: 2000,
      mcp_servers: [{ type: 'url', url: mcpUrl, name: 'crouton-docs' }],
      messages: [{ role: 'user', content: question }]
    })
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const body = await res.json()
  return (body.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n')
}

const results = []
for (const q of questions) {
  let r
  try { r = scoreAnswer(q, await ask(q.question), ctx) } catch (e) { r = { id: q.id, pass: false, failures: [String(e)] } }
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${q.id}${r.pass ? '' : ' — ' + r.failures.join('; ')}`)
  results.push(r)
}
const s = summarize(results)
console.log(`\nScore: ${s.passed}/${s.total} (${Math.round(s.score * 100)}%)`)
if (out) writeFileSync(out, JSON.stringify({ model, mcpUrl, date: new Date().toISOString(), ...s, results }, null, 2))
process.exit(s.passed === s.total ? 0 : 1)
