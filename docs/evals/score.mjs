// Pure scoring for the Ask-Claude answer set (#3169). No network.
const has = (text, needle) => text.toLowerCase().includes(String(needle).toLowerCase())

function collectKeys(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach(v => collectKeys(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.add(k); collectKeys(v, out) }
  }
  return out
}

/** Parse every ```json block in an answer; unparseable blocks are skipped. */
export function extractJsonBlocks(text) {
  const blocks = []
  for (const m of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)) {
    try { blocks.push(JSON.parse(m[1])) } catch { /* not JSON */ }
  }
  return blocks
}

/** @returns {{ id: string, pass: boolean, failures: string[] }} */
export function scoreAnswer(q, answer) {
  const failures = []
  for (const n of q.mustMention || []) if (!has(answer, n)) failures.push(`missing: ${n}`)
  for (const n of q.mustNotMention || []) if (has(answer, n)) failures.push(`forbidden: ${n}`)
  if (q.kind === 'schema') {
    const blocks = extractJsonBlocks(answer)
    if (!blocks.length) failures.push('no parseable JSON schema in answer')
    const keys = new Set(blocks.flatMap(b => [...collectKeys(b)]))
    for (const k of q.schemaForbiddenKeys || []) if (keys.has(k)) failures.push(`schema uses forbidden key: ${k}`)
  }
  return { id: q.id, pass: failures.length === 0, failures }
}

export function summarize(results) {
  const passed = results.filter(r => r.pass).length
  return { passed, total: results.length, score: results.length ? passed / results.length : 0 }
}
