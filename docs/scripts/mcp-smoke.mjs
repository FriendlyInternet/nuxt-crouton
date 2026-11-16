// Smoke test for the docs MCP tools. Usage: node scripts/mcp-smoke.mjs [baseUrl]
const base = process.argv[2] || 'http://localhost:3002'
let id = 0
async function call(name, args = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } })
  })
  const raw = await res.text()
  const line = raw.startsWith('{') ? raw : raw.split('\n').find(l => l.startsWith('data:'))?.slice(5)
  const result = JSON.parse(line).result
  return { isError: !!result?.isError, text: (result?.content || []).map(c => c.text).join('\n') }
}
let failed = 0
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` — ${detail.slice(0, 200)}`}`)
  if (!ok) failed++
}
const run = async (label, fn) => { try { await fn() } catch (e) { check(label, false, String(e)) } }

await run('list_sections', async () => {
  const r = await call('list_sections')
  check('list_sections', !r.isError && r.text.includes('## getting-started'), r.text)
})
await run('search_docs', async () => {
  const r = await call('search_docs', { query: 'collection' })
  check('search_docs', !r.isError && r.text.startsWith('Found ') && /\*\*Path:\*\* \//.test(r.text), r.text)
})
await run('get_page', async () => {
  const r = await call('get_page', { path: '/getting-started/installation' })
  check('get_page', !r.isError && r.text.includes('Nuxt 4') && !r.text.includes('Page not found') && !r.text.includes('Content not available'), r.text)
})
await run('search_docs no match', async () => {
  const r = await call('search_docs', { query: 'zzqxnonsense123' })
  check('search_docs no match', !r.isError && r.text.includes('No documentation found'), r.text)
})
await run('llms-full.txt', async () => {
  const res = await fetch(`${base}/llms-full.txt`)
  check('GET /llms-full.txt', res.status === 200, `status ${res.status}`)
})
process.exit(failed ? 1 : 0)
